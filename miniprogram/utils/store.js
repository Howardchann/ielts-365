// utils/store.js —— 学习进度：本地存储 + 云端多端同步 + 备份导出 / 导入
//
// 三层关系：
//   ① 本地存储（wx.setStorageSync）永远是第一现场 —— 写入立刻落本地，断网照样能用。
//   ② 云端同步是可选的加速层：本地变更防抖后推云；启动 / 切回前台时与云端合并。
//   ③ 备份导出 / 导入是最后的自救手段（云端出事、换微信号时仍能救回进度）。
//
// ⚠️ 合并规则必须与云函数 cloudfunctions/sync/index.js 保持一致，改一处就要改两处：
//   打卡 / 取消打卡：按天取更晚的时间戳 —— 取消过就是真取消，不会被另一台设备的旧记录复活。
//   收藏 / 取消收藏：按单词取更晚的时间戳。
//   复习记录：按单词取 lastReviewedAt 更晚的一条（快照语义，重复同步不会把复习次数翻倍）。
//   设置项（开始日期 / 语速 / 口音 / 朗读方式）：整组按 settingsAt 更晚者胜。
//
// 同步失败不影响学习：本地永远是完整的，界面用 cloudStatus() 展示状态，可在设置页手动重试。

const KEY = 'ielts-365-store';
const SYNC_FN = 'sync';
const plan = require('./data.js');
const DEFAULT_INTERVALS = [1, 2, 4, 7, 14, 30, 60, 120];
const DAY_KEY = /^w\d{1,2}d[1-7]$/;
const BACKUP_TAG = 'ielts-365';
const BACKUP_VERSION = 3;
const PUSH_DELAY = 2500;        // 本地写入后多久推云（防抖，避免连点打卡触发多次请求）
const DRAIN_DELAY = 300;        // 上送量超过单次上限时，补推下一批的间隔（要快，别让积压慢慢爬）
const RESUME_GAP = 20000;       // 切回前台至少间隔多久才拉一次
const RETRY_GAP = 60000;        // 失败后多久内不自动重试（避免弱网下反复请求）
const MAX_DIRTY_PER_SYNC = 400; // 单次最多上送多少个单词的复习记录（与云函数上限一致）
const SETTINGS_KEYS = { startDate: 1, rate: 1, accent: 1, engineMode: 1 };

const defaults = () => ({
  startDate: plan.DEFAULT_START,   // 计划开始日（周一）
  checkedDays: {},                 // { 'w1d1': 打卡时间戳 }   ← 旧版值是 1，两个都能用
  uncheckedDays: {},               // { 'w1d1': 取消打卡时间戳 } 防止另一端把取消掉的打卡复活
  starredWords: [],                // [ { w, m, p, e, ts } ]
  unstarredWords: {},              // { 单词: 取消收藏时间戳 }
  reviewStats: {},                 // { 单词: { correct, wrong, level, nextReviewAt, lastReviewedAt } }
  rate: 0.9,                       // 朗读语速
  accent: 'us',                    // 美音 | 英音
  engine: 'online',                // 朗读引擎（预生成音频不可用时的兜底）
  engineMode: 'auto',              // auto | pregen | online
  settingsAt: 0,                   // 设置项最后改动时间（同步冲突时用它决定听谁的）
  updatedAt: 0,
  // ——— 以下只在本地，不上云 ———
  syncEnabled: true,               // 云同步开关（默认开）
  reviewRev: 0,                    // 已知的云端复习记录版本号（落后时云端回全量）
  reviewDirty: {},                 // 自上次同步后变动过的单词，下次只推这些
  lastSyncAt: 0,
});

let data = defaults();
let listeners = [];
let pushTimer = null;
let syncing = null;
let syncError = '';
let lastFailAt = 0;

// ---------------- 本地读写 ----------------

function loadLocal() {
  try { const saved = wx.getStorageSync(KEY); if (saved && typeof saved === 'object') data = Object.assign(defaults(), saved); } catch (e) {}
}
function saveLocal() { try { wx.setStorageSync(KEY, data); } catch (e) {} }
function emit() { listeners.slice().forEach(fn => { try { fn(data); } catch (e) {} }); }

function init() {
  loadLocal();
  if (data.engine === 'plugin' || data.engine === 'auto') data.engine = 'online';
  if (!data.checkedDays) data.checkedDays = {};
  if (!data.uncheckedDays) data.uncheckedDays = {};
  if (!data.starredWords) data.starredWords = [];
  if (!data.unstarredWords) data.unstarredWords = {};
  if (!data.reviewStats) data.reviewStats = {};
  if (!data.reviewDirty) data.reviewDirty = {};
  if (typeof data.syncEnabled !== 'boolean') data.syncEnabled = true;
  if (typeof data.reviewRev !== 'number') data.reviewRev = 0;
  saveLocal(); emit();
  if (data.syncEnabled) sync();     // 启动即与云端对齐
}

// 页面 onShow 会调这里（今日 / 周计划 / 复习三个页面都调），必须节流
function onResume() {
  if (!data.syncEnabled || !cloudSupported()) return;
  if (syncing) return;
  if (Date.now() - (data.lastSyncAt || 0) < RESUME_GAP) return;
  if (lastFailAt && Date.now() - lastFailAt < RETRY_GAP) return;
  sync();
}

// 小程序切后台 / 关闭前把待推的改动推出去（不 await，尽力而为）
function flush() {
  if (!data.syncEnabled || !cloudSupported()) return;
  if (!pendingPush() && !pushTimer) return;
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  sync(true);
}

function onChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}
function get(key) { return key ? data[key] : data; }
function set(key, value) {
  data[key] = value;
  data.updatedAt = Date.now();
  if (SETTINGS_KEYS[key]) data.settingsAt = data.updatedAt;
  saveLocal(); schedulePush(); emit();
  return value;
}

// ---------------- 打卡 ----------------

function checkKey(w, k) { return 'w' + w + 'd' + k; }
function isChecked(w, k) { return !!data.checkedDays[checkKey(w, k)]; }

// 打卡 / 取消打卡都记时间戳：同步时按更晚的一方胜，取消不会被旧记录复活
function toggleCheck(w, k) {
  const key = checkKey(w, k), now = Date.now();
  let checked;
  if (data.checkedDays[key]) {
    delete data.checkedDays[key];
    data.uncheckedDays[key] = now;
    checked = false;
  } else {
    data.checkedDays[key] = now;
    delete data.uncheckedDays[key];
    checked = true;
  }
  data.updatedAt = now; saveLocal(); schedulePush(); emit();
  return checked;
}
function checkedCount() { return Object.keys(data.checkedDays || {}).length; }

// 进度游标：第一个「需要打卡且未打卡」的学习日。
// 没学 / 没学完，第二天打开仍停在这一天 —— 进度由打卡驱动，不由自然日驱动
// （自然日只作「回到今天 Day N」的参照，见 today 页）。
// 周六弹性日（type='sat'）没有打卡按钮，跳过；无内容的天也跳过。
// 返回 0 = 全部完成，由调用方回退自然日。
function firstUnfinishedDay() {
  for (let day = 1; day <= plan.TOTAL_DAYS; day++) {
    const raw = plan.getDay(day);
    if (!raw || raw.type === 'sat') continue;
    const info = plan.dayInfo(day);
    if (!data.checkedDays[checkKey(info.wIdx + 1, info.k)]) return day;
  }
  return 0;
}
function weekCheckedMap(wIdx) {
  const map = {}; for (let k = 1; k <= 7; k++) map[k] = !!data.checkedDays[checkKey(wIdx + 1, k)]; return map;
}
function weekCheckedCount(wIdx) {
  let n = 0; for (let k = 1; k <= 7; k++) if (data.checkedDays[checkKey(wIdx + 1, k)]) n++; return n;
}

// ---------------- 重点词 ----------------

function isStarred(word) { return (data.starredWords || []).some(v => v.w === word); }
function toggleStar(item) {
  const list = data.starredWords || (data.starredWords = []);
  const w = item.w, now = Date.now();
  const i = list.findIndex(v => v.w === w);
  let added;
  if (i >= 0) { list.splice(i, 1); data.unstarredWords[w] = now; added = false; }
  else { list.push({ w: item.w, m: item.m, p: item.p, e: item.e, ts: now }); delete data.unstarredWords[w]; added = true; }
  data.updatedAt = now; saveLocal(); schedulePush(); emit();
  return added;
}

// ---------------- 间隔复习（轻量 SRS） ----------------
// 正确：1/2/4/7/14/30/60/120 天逐级延长；错误：等级归零并立即可复习。
function reviewWord(word, remembered) {
  if (!word) return null;
  const now = Date.now();
  const old = data.reviewStats[word] || { correct: 0, wrong: 0, level: 0, nextReviewAt: 0, lastReviewedAt: 0 };
  let level, nextReviewAt;
  if (remembered) {
    level = Math.min((Number(old.level) || 0) + 1, DEFAULT_INTERVALS.length);
    nextReviewAt = now + DEFAULT_INTERVALS[level - 1] * 86400000;
  } else {
    level = 0; nextReviewAt = now;
  }
  data.reviewStats[word] = {
    correct: (old.correct || 0) + (remembered ? 1 : 0), wrong: (old.wrong || 0) + (remembered ? 0 : 1),
    level, nextReviewAt, lastReviewedAt: now
  };
  data.reviewDirty[word] = 1;      // 只推变动过的单词，不必每次上送 8000 条
  data.updatedAt = now; saveLocal(); schedulePush(); emit();
  return data.reviewStats[word];
}
function getReviewStats(word) {
  return (data.reviewStats || {})[word] || { correct: 0, wrong: 0, level: 0, nextReviewAt: 0, lastReviewedAt: 0 };
}
function dueWords(words) {
  const now = Date.now();
  return (words || []).filter(v => { const s = getReviewStats(v.w); return !s.nextReviewAt || s.nextReviewAt <= now; });
}

// ================= 云同步 =================

function cloudSupported() { return !!(wx.cloud && wx.cloud.callFunction); }

// 时间戳归一化：旧版打卡存的是 1（无时间），当成"极早"处理，任何一次显式取消都能压过它
function toTs(v) {
  const n = Math.floor(Number(v) || 0);
  if (n > 1e12) return n;
  return n > 0 ? 1 : 0;
}

function explainError(err) {
  const msg = (err && (err.errMsg || err.message)) || '';
  if (/-501000|FunctionName|function not found/i.test(msg)) return '云函数 sync 还没部署：请在开发者工具里右键 cloudfunctions/sync → 上传并部署';
  if (/collection|not exist|-502005/i.test(msg)) return '云端集合 progress 不存在：请在云开发控制台「数据库」里新建集合 progress';
  if (/permission|auth|-502003/i.test(msg)) return '云端权限不足：请在云开发控制台把 progress 的权限设为「仅创建者可读写」';
  if (/timeout|network|fail|ERR_|ECONN/i.test(msg)) return '网络不可用，稍后会自动重试';
  if (/env|环境|DYNAMIC/i.test(msg)) return '云开发环境未就绪，请先在开发者工具里开通云开发';
  return msg ? ('云同步失败：' + msg) : '云同步失败';
}

function pendingPush() { return Object.keys(data.reviewDirty || {}).length > 0; }

function schedulePush() {
  if (!data.syncEnabled) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; sync(); }, PUSH_DELAY);
}

// 本轮要上送的单词（云函数单次有上限，超出的留到下一轮）
function buildPayload() {
  const all = Object.keys(data.reviewDirty || {});
  const sent = all.slice(0, MAX_DIRTY_PER_SYNC);
  const reviewDirty = {};
  const sentVersions = {};
  sent.forEach(w => { const s = data.reviewStats[w]; if (s) { reviewDirty[w] = s; sentVersions[w] = Number(s.lastReviewedAt) || 0; } });
  return {
    sentWords: sent,
    sentVersions: sentVersions,
    payload: {
      action: 'merge',
      core: {
        startDate: data.startDate, rate: data.rate, accent: data.accent,
        engineMode: data.engineMode || 'auto',
        checkedDays: data.checkedDays || {}, uncheckedDays: data.uncheckedDays || {},
        starredWords: data.starredWords || [], unstarredWords: data.unstarredWords || {},
        settingsAt: data.settingsAt || 0,
      },
      reviewDirty: reviewDirty,
      reviewRev: data.reviewRev || 0,
    },
  };
}

// 把云端结果合进本地。
// ⚠️ 这里不直接覆盖本地，而是再合并一次（用同一套时间戳规则）：
//    同步请求来回有几百毫秒，期间用户可能刚好点了打卡，直接覆盖会把这个操作吞掉。
function applyMerged(r, sentWords, sentVersions) {
  // 记录请求飞行期间本地是否又产生了更新；后面的云端回包不能覆盖这些新操作。
  const inFlightLocal = {};
  (sentWords || []).forEach(w => {
    const sentAt = Number(sentVersions && sentVersions[w]) || 0;
    const current = data.reviewStats && data.reviewStats[w];
    const currentAt = Number(current && current.lastReviewedAt) || 0;
    if (current && currentAt > sentAt) inFlightLocal[w] = current;
  });
  const c = r.core || {};

  const dm = mergeFlagMaps(data.checkedDays, data.uncheckedDays, c.checkedDays, c.uncheckedDays);
  data.checkedDays = dm.checked;
  data.uncheckedDays = dm.unchecked;

  const sm = mergeStarMaps(data.starredWords, data.unstarredWords, c.starredWords, c.unstarredWords);
  data.starredWords = sm.starredWords;
  data.unstarredWords = sm.unstarredWords;

  if (c.startDate) data.startDate = c.startDate;
  if (c.rate) data.rate = c.rate;
  if (c.accent) data.accent = c.accent;
  if (c.engineMode) data.engineMode = c.engineMode;
  if (c.settingsAt) data.settingsAt = Math.max(Number(data.settingsAt) || 0, Number(c.settingsAt) || 0);

  // 复习记录：云端落后（换机 / 另一端改过）时回全量；否则用本轮上送单词的合并真值纠正
  if (r.reviewFull && typeof r.reviewFull === 'object') {
    const out = {};
    Object.keys(r.reviewFull).forEach(w => { const e = r.reviewFull[w]; if (e) out[w] = e; });
    data.reviewStats = out;
  } else if (r.reviewPatch && typeof r.reviewPatch === 'object') {
    Object.keys(r.reviewPatch).forEach(w => {
      const e = r.reviewPatch[w];
      if (e) data.reviewStats[w] = e;
    });
  }

  // 只清理“发出时的那一版”。如果请求飞行期间用户又复习了同一个词，
  // lastReviewedAt 已经变化，必须保留 dirty，让下一轮继续同步，不能把新操作误删。
  (sentWords || []).forEach(w => {
    const sentAt = Number(sentVersions && sentVersions[w]) || 0;
    if (inFlightLocal[w]) {
      // 请求期间的新版本必须恢复到本地，并保留 dirty，下一轮继续推云。
      data.reviewStats[w] = inFlightLocal[w];
      data.reviewDirty[w] = 1;
      return;
    }
    const current = data.reviewStats && data.reviewStats[w];
    const currentAt = Number(current && current.lastReviewedAt) || 0;
    if (currentAt === sentAt) delete data.reviewDirty[w];
  });
  data.reviewRev = Number(r.reviewRev) || 0;
  data.lastSyncAt = Date.now();
  data.updatedAt = data.lastSyncAt;
  saveLocal();
}

function mergeFlagMaps(localC, localU, remoteC, remoteU) {
  const checked = {}, unchecked = {}, keys = {};
  [localC, localU, remoteC, remoteU].forEach(m => { if (m) Object.keys(m).forEach(k => { keys[k] = 1; }); });
  Object.keys(keys).forEach(k => {
    const ct = Math.max(toTs(localC && localC[k]), toTs(remoteC && remoteC[k]));
    const ut = Math.max(toTs(localU && localU[k]), toTs(remoteU && remoteU[k]));
    if (ct > 0 && ct >= ut) checked[k] = ct;
    else if (ut > 0) unchecked[k] = ut;
  });
  return { checked: checked, unchecked: unchecked };
}

function mergeStarMaps(localList, localUn, remoteList, remoteUn) {
  const best = {};
  const put = (w, ts, del, item) => {
    if (!w || !ts) return;
    const cur = best[w];
    if (!cur || ts > cur.ts) best[w] = { ts: ts, del: del, item: item };
  };
  (localList || []).forEach(it => put(it && it.w, toTs(it && it.ts), false, it));
  (remoteList || []).forEach(it => put(it && it.w, toTs(it && it.ts), false, it));
  Object.keys(localUn || {}).forEach(w => put(w, toTs(localUn[w]), true, null));
  Object.keys(remoteUn || {}).forEach(w => put(w, toTs(remoteUn[w]), true, null));
  const starredWords = [], unstarredWords = {};
  Object.keys(best).forEach(w => {
    const e = best[w];
    if (e.del) unstarredWords[w] = e.ts;
    else if (e.item) starredWords.push(Object.assign({}, e.item, { ts: e.ts }));
  });
  return { starredWords: starredWords, unstarredWords: unstarredWords };
}

// 与云端合并。force = true 时忽略启动/失败节流（设置页「立即同步」用）
function sync(force) {
  if (!data.syncEnabled) return Promise.resolve({ ok: false, msg: '云同步已关闭，进度只保存在本机' });
  if (!cloudSupported()) { syncError = '当前基础库不支持云开发，请升级微信后重试'; return Promise.resolve({ ok: false, msg: syncError }); }
  if (syncing) return syncing;                                   // 并发调用直接复用同一次请求
  if (!force && lastFailAt && Date.now() - lastFailAt < RETRY_GAP) {
    return Promise.resolve({ ok: false, msg: syncError || '云同步暂时不可用' });
  }
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }

  const built = buildPayload();
  syncing = new Promise((resolve) => {
    wx.cloud.callFunction({ name: SYNC_FN, data: built.payload }).then(res => {
      const r = (res && res.result) || {};
      if (!r.ok) throw new Error(r.error || '云端返回失败');
      applyMerged(r, built.sentWords, built.sentVersions);
      syncError = ''; lastFailAt = 0;
      resolve({ ok: true, msg: '已同步' });
    }).catch(err => {
      syncError = explainError(err);
      lastFailAt = Date.now();
      resolve({ ok: false, msg: syncError });
    });
  }).then(r => {
    syncing = null;
    emit();
    // 还有没推完的（超过单次上限）→ 立刻接着推，别用 PUSH_DELAY 那种慢节拍
    if (r.ok && pendingPush()) {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => { pushTimer = null; sync(); }, DRAIN_DELAY);
    }
    return r;
  });
  return syncing;
}

// 设置页「立即同步」：真等结果，允许强行重试
function syncNow() {
  if (!data.syncEnabled) return Promise.resolve({ ok: false, msg: '云同步已关闭' });
  lastFailAt = 0;
  return sync(true);
}

function setSyncEnabled(on) {
  data.syncEnabled = !!on;
  data.updatedAt = Date.now();
  if (!data.syncEnabled) { syncError = ''; if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; } }
  saveLocal(); emit();
  if (data.syncEnabled) return syncNow();
  return Promise.resolve({ ok: true, msg: '已关闭云同步，进度只保存在本机' });
}

function cloudStatus() {
  return {
    supported: cloudSupported(),
    enabled: !!data.syncEnabled,
    syncing: !!syncing,
    lastSyncAt: data.lastSyncAt || 0,
    rev: data.reviewRev || 0,
    pending: Object.keys(data.reviewDirty || {}).length,
    error: syncError,
  };
}

// ================= 进度备份 / 恢复 =================
// 云端同步之外的第二道保险：导出成一段 JSON 文本，用户自己存到备忘录 / 文件。

function exportBackup() {
  return JSON.stringify({
    app: BACKUP_TAG, v: BACKUP_VERSION, exportedAt: Date.now(),
    data: {
      startDate: data.startDate, checkedDays: data.checkedDays || {},
      uncheckedDays: data.uncheckedDays || {}, starredWords: data.starredWords || [],
      unstarredWords: data.unstarredWords || {}, reviewStats: data.reviewStats || {},
      rate: data.rate, accent: data.accent, engine: 'online',
      engineMode: data.engineMode || 'auto', settingsAt: data.settingsAt || 0
    }
  });
}

function cleanDayMap(raw, limit) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  Object.keys(raw).forEach(k => {
    if (n >= (limit || 1200) || !DAY_KEY.test(k)) return;
    const ts = toTs(raw[k]);
    if (!ts) return;
    out[k] = ts; n++;
  });
  return out;
}

// ⚠️ fallbackTs：老备份（v2 及更早）与手工写的备份里收藏词没有 ts 字段，
//    这时必须给一个时间戳，否则会被合并逻辑当成"不存在"直接丢掉（备份恢复会静默丢收藏词）。
//    取备份的 exportedAt：这份快照导出时它确实是收藏状态；真有空档时，晚于它的取消收藏仍能压过它。
function cleanStars(raw, limit, fallbackTs) {
  const out = [], seen = {};
  const fb = toTs(fallbackTs) || 1;
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < raw.length && out.length < (limit || 6000); i++) {
    const it = raw[i];
    if (!it || !it.w) continue;
    const w = String(it.w).slice(0, 60);
    if (!w || seen[w]) continue;
    seen[w] = 1;
    out.push({ w: w, m: String(it.m || '').slice(0, 80), p: String(it.p || '').slice(0, 20), e: String(it.e || '').slice(0, 300), ts: toTs(it.ts) || fb });
  }
  return out;
}

function sanitizeReviewStats(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(word => {
    if (!word || word.length > 100) return;
    const s = raw[word];
    if (!s || typeof s !== 'object') return;
    out[String(word).slice(0, 100)] = {
      correct: Math.max(0, Math.min(999999, Number(s.correct) || 0)),
      wrong: Math.max(0, Math.min(999999, Number(s.wrong) || 0)),
      level: Math.max(0, Math.min(DEFAULT_INTERVALS.length, Math.floor(Number(s.level) || 0))),
      nextReviewAt: Math.max(0, Number(s.nextReviewAt) || 0),
      lastReviewedAt: Math.max(0, Number(s.lastReviewedAt) || 0)
    };
  });
  return out;
}

function sanitize(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('不是有效的备份数据');
  if (raw.app && raw.app !== BACKUP_TAG) throw new Error('这不是「开溜」的备份');
  const d = (raw.data && typeof raw.data === 'object') ? raw.data : raw;
  const out = {
    checkedDays: {}, uncheckedDays: {}, starredWords: [], unstarredWords: {},
    reviewStats: {}, startDate: '', rate: 0, accent: '', engineMode: '', settingsAt: 0
  };
  out.checkedDays = cleanDayMap(d.checkedDays);
  out.uncheckedDays = cleanDayMap(d.uncheckedDays);
  out.starredWords = cleanStars(d.starredWords, 6000, raw.exportedAt);
  const unstar = {};
  if (d.unstarredWords && typeof d.unstarredWords === 'object' && !Array.isArray(d.unstarredWords)) {
    Object.keys(d.unstarredWords).forEach(w => { const ts = toTs(d.unstarredWords[w]); if (ts) unstar[String(w).slice(0, 60)] = ts; });
  }
  out.unstarredWords = unstar;
  out.reviewStats = sanitizeReviewStats(d.reviewStats);
  if (typeof d.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.startDate)) out.startDate = d.startDate;
  const rate = Number(d.rate); if (rate >= 0.5 && rate <= 2) out.rate = rate;
  if (d.accent === 'us' || d.accent === 'uk') out.accent = d.accent;
  if (d.engineMode === 'auto' || d.engineMode === 'pregen' || d.engineMode === 'online') out.engineMode = d.engineMode;
  out.settingsAt = Math.max(0, Number(d.settingsAt) || 0);
  return out;
}

// 备份是"快照"而不是增量日志：合并时取最近一次复习记录，重复导入同一备份不会把次数重复累加。
function mergeReviewStats(localStats, incomingStats) {
  const result = Object.assign({}, localStats || {});
  Object.keys(incomingStats || {}).forEach(word => {
    const incoming = incomingStats[word], local = result[word];
    if (!local) { result[word] = incoming; return; }
    const lt = Number(local.lastReviewedAt) || 0, it = Number(incoming.lastReviewedAt) || 0;
    if (it >= lt) result[word] = incoming;
  });
  return result;
}

function importBackup(text, mode) {
  const str = String(text == null ? '' : text).trim();
  if (!str) throw new Error('内容为空，请先粘贴备份文本');
  let raw; try { raw = JSON.parse(str); } catch (e) { throw new Error('解析失败：不是完整的备份文本，请重新复制一次'); }
  const inc = sanitize(raw), replace = mode === 'replace';
  let addedDays = 0, addedWords = 0;

  if (replace) {
    data.checkedDays = inc.checkedDays;
    data.uncheckedDays = inc.uncheckedDays;
    data.starredWords = inc.starredWords;
    data.unstarredWords = inc.unstarredWords;
    data.reviewStats = inc.reviewStats;
    addedDays = Object.keys(inc.checkedDays).length;
    addedWords = data.starredWords.length;
  } else {
    const before = Object.keys(data.checkedDays || {}).length;
    const dm = mergeFlagMaps(data.checkedDays, data.uncheckedDays, inc.checkedDays, inc.uncheckedDays);
    data.checkedDays = dm.checked; data.uncheckedDays = dm.unchecked;
    addedDays = Object.keys(dm.checked).length - before;
    const beforeW = (data.starredWords || []).length;
    const sm = mergeStarMaps(data.starredWords, data.unstarredWords, inc.starredWords, inc.unstarredWords);
    data.starredWords = sm.starredWords; data.unstarredWords = sm.unstarredWords;
    addedWords = data.starredWords.length - beforeW;
    data.reviewStats = mergeReviewStats(data.reviewStats, inc.reviewStats);
  }
  if (inc.startDate) data.startDate = inc.startDate;
  if (inc.rate) data.rate = inc.rate;
  if (inc.accent) data.accent = inc.accent;
  if (inc.engineMode) data.engineMode = inc.engineMode;
  data.settingsAt = Math.max(Number(data.settingsAt) || 0, inc.settingsAt || 0);

  // 导入进来的复习记录要全部推给云端，否则下次同步会被云端旧值顶回去
  Object.keys(inc.reviewStats).forEach(w => { data.reviewDirty[w] = 1; });
  data.engine = 'online'; data.updatedAt = Date.now();
  saveLocal(); schedulePush(); emit();
  return {
    addedDays: addedDays, addedWords: addedWords,
    totalDays: Object.keys(data.checkedDays || {}).length,
    totalWords: (data.starredWords || []).length,
    reviewWords: Object.keys(data.reviewStats || {}).length
  };
}

module.exports = {
  init, onResume, flush, onChange, get, set,
  isChecked, toggleCheck, checkedCount, firstUnfinishedDay, weekCheckedCount, weekCheckedMap,
  isStarred, toggleStar, reviewWord, getReviewStats, dueWords,
  sync, syncNow, setSyncEnabled, cloudStatus,
  exportBackup, importBackup
};
