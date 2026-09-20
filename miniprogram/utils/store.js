// utils/store.js —— 进度管理：本地缓存 + 云数据库同步
// 多端同步：写入先落本地（秒级），防抖 3 秒后推云；启动/切回前台从云端拉取较新版本。
// 修复要点（详见变更报告）：
//   1. 原实现一旦某次拉取失败就把 cloudEnabled 永久置 false，网络恢复也无法自愈 → 改为失败计数 + 手动同步强制重试
//   2. syncNow 原为"推完等 1.5 秒猜结果" → 改为真实 Promise 链，成功/失败如实上报
//   3. pull / push 并发会互相覆盖 → 引入 pullInFlight + pendingPush，保证先拉后推串行
//   4. 错误信息只打 console → 现在翻译成可操作的中文提示

const KEY = 'ielts-365-store';
const COLLECTION = 'progress';
const MAX_FAILS = 3;        // 连续失败达到此次数才进入"冷却"，期间仅手动同步重试

const plan = require('./data.js');

const defaults = () => ({
  startDate: plan.DEFAULT_START,   // 计划开始日（周一）
  checkedDays: {},           // { 'w1d1': 1, 'w12d3': 1, ... }
  starredWords: [],          // [ {w,m,p,e} ]
  reviewStats: {},            // { word: { correct, wrong, level, nextReviewAt, lastReviewedAt } }
  rate: 0.9,                 // 朗读语速
  accent: 'us',              // us 美音 | uk 英音
  engine: 'online',          // 个人主体无法添加插件时的默认通道
  updatedAt: 0,
  cloudDocId: '',            // 云端记录 _id（首次同步后缓存）
});

let data = defaults();
let cloudReady = false;
let cloudAvailable = null;   // null=尚未检测；true/false=云开发是否可用
let cloudFailCount = 0;
let cloudErrorMsg = '';
let pushTimer = null;
let listeners = [];
let pullInFlight = null;     // 正在进行的拉取，避免并发
let pendingPush = false;     // 拉取期间产生的推送请求，拉取结束后补推

function loadLocal() {
  try {
    const saved = wx.getStorageSync(KEY);
    if (saved && typeof saved === 'object') {
      data = Object.assign(defaults(), saved);
    }
  } catch (e) { /* 存储损坏时回到默认 */ }
}

function saveLocal() {
  try { wx.setStorageSync(KEY, data); } catch (e) {}
}

function emit() {
  listeners.slice().forEach(fn => { try { fn(data); } catch (e) {} });
}

// ============ 云同步 ============
function db() {
  if (!wx.cloud) return null;
  try { return wx.cloud.database(); } catch (e) { return null; }
}

// 把云开发报错翻译成用户看得懂的提示
function explainError(err) {
  const msg = (err && (err.errMsg || err.message)) || '';
  if (/collection|not exists|-502005/i.test(msg)) return '未找到 progress 集合，请在云开发控制台创建';
  if (/permission|auth|-502003/i.test(msg)) return '集合权限不对，请改为「仅创建者可读写」';
  if (/network|timeout|fail/i.test(msg)) return '网络不可用，稍后重试';
  if (/-501000|获.*环境|env/i.test(msg)) return '云开发环境未就绪，请先在开发者工具开通云开发';
  return msg ? ('云同步失败：' + msg) : '云同步失败';
}

// 拉取云端：远端 updatedAt 较新则整体覆盖本地并广播
function pullCloud(opts) {
  opts = opts || {};
  const database = db();
  if (!database) return Promise.reject(new Error('当前环境不支持云开发'));
  if (pullInFlight) return pullInFlight;   // 去重：同一时刻只允许一次拉取

  pullInFlight = new Promise((resolve, reject) => {
    database.collection(COLLECTION).limit(1).get().then(res => {
      cloudReady = true;
      cloudFailCount = 0;
      cloudErrorMsg = '';
      const rows = res.data || [];
      if (rows.length) {
        const remote = rows[0];
        data.cloudDocId = remote._id;
        const remoteTime = remote.updatedAt || 0;
        if (remoteTime > (data.updatedAt || 0)) {
          data.startDate = remote.startDate || data.startDate;
          data.checkedDays = remote.checkedDays || data.checkedDays;
          data.starredWords = remote.starredWords || data.starredWords;
          data.reviewStats = remote.reviewStats || data.reviewStats || {};
          data.rate = remote.rate != null ? remote.rate : data.rate;
          data.accent = remote.accent || data.accent;
          data.engine = remote.engine || data.engine;
          data.updatedAt = remoteTime;
          saveLocal();
          emit();
        }
      } else if (opts.create) {
        data.cloudDocId = '';
        return pushCloud().then(resolve, reject);
      } else {
        data.cloudDocId = '';
      }
      resolve(true);
    }).catch(err => {
      cloudReady = false;
      cloudFailCount++;
      cloudErrorMsg = explainError(err);
      reject(err);
    });
  });

  return pullInFlight.then(
    r => { pullInFlight = null; if (pendingPush) { pendingPush = false; schedulePush(0); } return r; },
    e => { pullInFlight = null; pendingPush = false; return Promise.reject(e); }
  );
}

// 推送云端（last-write-wins）
function pushCloud() {
  if (cloudFailCount >= MAX_FAILS) {
    return Promise.reject(new Error(cloudErrorMsg || '云同步暂时不可用，请点「立即同步」重试'));
  }
  const database = db();
  if (!database) return Promise.reject(new Error('当前环境不支持云开发'));
  if (pullInFlight) { pendingPush = true; return Promise.resolve(false); } // 等拉取结束再推

  const payload = {
    startDate: data.startDate,
    checkedDays: data.checkedDays,
    starredWords: data.starredWords,
    rate: data.rate,
    accent: data.accent,
    engine: data.engine,
    reviewStats: data.reviewStats || {},
    updatedAt: Date.now(),
  };
  const finish = (docId) => {
    data.cloudDocId = docId;
    data.updatedAt = payload.updatedAt;
    cloudReady = true;
    cloudFailCount = 0;
    cloudErrorMsg = '';
    saveLocal();
    return true;
  };

  const task = data.cloudDocId
    ? database.collection(COLLECTION).doc(data.cloudDocId).update({ data: payload }).then(() => finish(data.cloudDocId))
    : database.collection(COLLECTION).add({ data: payload }).then(res => finish(res._id));

  return task.catch(err => {
    cloudReady = false;
    cloudFailCount++;
    cloudErrorMsg = explainError(err);
    return Promise.reject(err);
  });
}

function schedulePush(delay) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushCloud().catch(() => {}); }, delay == null ? 3000 : delay);
}

// ============ 进度备份 / 恢复（不依赖云开发）============
// 目的：本地存储是唯一副本时提供自救手段。导出为一段 JSON 文本，用户自行保存到备忘录。
const BACKUP_TAG = 'ielts-365';
const BACKUP_VERSION = 1;
const DAY_KEY = /^w\d{1,2}d[1-7]$/;   // 只认 'w3d5' 这类格式

// 导出：返回一段可复制的 JSON 文本
function exportBackup() {
  return JSON.stringify({
    app: BACKUP_TAG,
    v: BACKUP_VERSION,
    exportedAt: Date.now(),
    data: {
      startDate: data.startDate,
      checkedDays: data.checkedDays || {},
      starredWords: data.starredWords || [],
      rate: data.rate,
      accent: data.accent,
      engine: data.engine,
      reviewStats: data.reviewStats || {},
    },
  });
}

// 外部数据不可信：逐字段校验、取值域收敛、字符串截断，防止脏数据把存储写坏
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('不是有效的备份数据');
  if (raw.app && raw.app !== BACKUP_TAG) throw new Error('这不是「开溜6.5」的备份');
  const d = (raw.data && typeof raw.data === 'object') ? raw.data : raw;

  const out = { checkedDays: {}, starredWords: [], startDate: '', rate: 0, accent: '', engine: '' };

  const cd = d.checkedDays;
  if (cd && typeof cd === 'object') {
    Object.keys(cd).forEach(k => {
      if (DAY_KEY.test(k) && cd[k]) out.checkedDays[k] = 1;
    });
  }

  if (Array.isArray(d.starredWords)) {
    const seen = {};
    d.starredWords.forEach(item => {
      if (!item || !item.w) return;
      const w = String(item.w).slice(0, 60);
      if (seen[w]) return;
      seen[w] = 1;
      out.starredWords.push({
        w,
        m: String(item.m || '').slice(0, 80),
        p: String(item.p || '').slice(0, 20),
        e: String(item.e || '').slice(0, 300),
      });
    });
  }

  if (typeof d.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.startDate)) out.startDate = d.startDate;
  const rate = Number(d.rate);
  if (rate >= 0.5 && rate <= 2) out.rate = rate;
  if (d.accent === 'us' || d.accent === 'uk') out.accent = d.accent;
  if (d.engine === 'auto' || d.engine === 'plugin' || d.engine === 'online') out.engine = d.engine;

  return out;
}

// 导入：mode = 'merge'（取并集，推荐）| 'replace'（以备份为准）
function importBackup(text, mode) {
  const str = String(text == null ? '' : text).trim();
  if (!str) throw new Error('内容为空，请先粘贴备份文本');

  let raw;
  try { raw = JSON.parse(str); }
  catch (e) { throw new Error('解析失败：不是完整的备份文本，请重新复制一次'); }

  const inc = sanitize(raw);
  const replace = mode === 'replace';

  let addedDays = 0, addedWords = 0;

  if (replace) {
    data.checkedDays = inc.checkedDays;
    data.starredWords = inc.starredWords;
    addedDays = Object.keys(inc.checkedDays).length;
    addedWords = data.starredWords.length;
  } else {
    // 合并：打卡取并集；重点词按单词去重，保留本地已有的解释
    const merged = Object.assign({}, data.checkedDays || {});
    Object.keys(inc.checkedDays).forEach(k => {
      if (!merged[k]) { merged[k] = 1; addedDays++; }
    });
    data.checkedDays = merged;

    const map = {};
    const list = (data.starredWords || []).slice();
    list.forEach(v => { if (v && v.w) map[v.w] = 1; });
    inc.starredWords.forEach(v => {
      if (!map[v.w]) { map[v.w] = 1; list.push(v); addedWords++; }
    });
    data.starredWords = list;
  }

  if (inc.startDate) data.startDate = inc.startDate;
  if (inc.rate) data.rate = inc.rate;
  if (inc.accent) data.accent = inc.accent;
  if (inc.engine) data.engine = inc.engine;
  if (inc.reviewStats && typeof inc.reviewStats === 'object') data.reviewStats = inc.reviewStats;

  data.updatedAt = Date.now();
  saveLocal();
  emit();
  schedulePush(0);      // 云同步可用时顺带推上去，保持一致

  return {
    addedDays,
    addedWords,
    totalDays: Object.keys(data.checkedDays).length,
    totalWords: data.starredWords.length,
  };
}

// ============ 对外 API ============
function init() {
  loadLocal();
  // 先探明云开发是否真的可用。原实现缺这一步，导致未开通云开发时也显示"稍后会自动创建"。
  cloudAvailable = !!db();
  pullCloud({ create: true }).catch(() => {});
}

// 页面切回前台：重新拉一次，保证双端及时同步
function onResume() {
  if (cloudFailCount >= MAX_FAILS) return;  // 冷却期不做自动重试，避免持续失败请求
  pullCloud().catch(() => {});
}

function onChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}

function get(key) {
  return key ? data[key] : data;
}

function set(key, value) {
  data[key] = value;
  saveLocal();
  schedulePush();
  emit();
  return value;
}

// ---- 打卡 ----
function checkKey(w, k) { return 'w' + w + 'd' + k; }

function isChecked(w, k) {
  return !!data.checkedDays[checkKey(w, k)];
}

function toggleCheck(w, k) {
  const key = checkKey(w, k);
  if (data.checkedDays[key]) delete data.checkedDays[key];
  else data.checkedDays[key] = 1;
  saveLocal();
  schedulePush();
  emit();
  return !!data.checkedDays[key];
}

// 已完成天数统计
function checkedCount() {
  return Object.keys(data.checkedDays).length;
}

// 某周每天是否完成：[1..7] → boolean（修复：原先由页面用"完成数量"推断，跳天打卡会全错）
function weekCheckedMap(wIdx) {
  const map = {};
  for (let k = 1; k <= 7; k++) map[k] = !!data.checkedDays[checkKey(wIdx + 1, k)];
  return map;
}

// 某周完成天数（0-7）
function weekCheckedCount(wIdx) {
  let n = 0;
  for (let k = 1; k <= 7; k++) if (data.checkedDays[checkKey(wIdx + 1, k)]) n++;
  return n;
}

// ---- 重点词 ----
function isStarred(word) {
  return data.starredWords.some(v => v.w === word);
}

function toggleStar(item) {
  const i = data.starredWords.findIndex(v => v.w === item.w);
  if (i >= 0) data.starredWords.splice(i, 1);
  else data.starredWords.push({ w: item.w, m: item.m, p: item.p, e: item.e });
  saveLocal();
  schedulePush();
  emit();
  return i < 0;
}

// ---- 间隔复习（轻量 SRS） ----
function reviewWord(word, remembered) {
  if (!word) return null;
  const now = Date.now();
  const old = data.reviewStats[word] || { correct: 0, wrong: 0, level: 0, nextReviewAt: 0, lastReviewedAt: 0 };
  const level = remembered ? Math.min((old.level || 0) + 1, 6) : 0;
  const intervals = [0, 1, 2, 4, 7, 14, 30];
  const days = intervals[level];
  const next = now + days * 86400000;
  data.reviewStats[word] = {
    correct: (old.correct || 0) + (remembered ? 1 : 0),
    wrong: (old.wrong || 0) + (remembered ? 0 : 1),
    level,
    nextReviewAt: next,
    lastReviewedAt: now,
  };
  saveLocal(); schedulePush(); emit();
  return data.reviewStats[word];
}
function getReviewStats(word) { return (data.reviewStats || {})[word] || { correct:0, wrong:0, level:0, nextReviewAt:0, lastReviewedAt:0 }; }
function dueWords(words) {
  const now = Date.now();
  return (words || []).filter(v => {
    const s = getReviewStats(v.w);
    return !s.nextReviewAt || s.nextReviewAt <= now;
  });
}

// ---- 手动全量同步（设置页按钮）：真实等待结果，且允许强制重试 ----
function syncNow() {
  const database = db();
  cloudAvailable = !!database;
  if (!database) return Promise.resolve({ ok: false, msg: '未开通云开发，进度仅保存在本机' });
  cloudFailCount = 0;
  cloudErrorMsg = '';
  return pullCloud({ create: true })
    .then(() => pushCloud())
    .then(() => ({ ok: true, msg: '已同步' }))
    .catch(() => ({ ok: false, msg: cloudErrorMsg || '云同步失败，请检查云开发设置' }));
}

function cloudStatus() {
  return {
    // cloudAvailable === false 表示从未开通云开发，此时不该再显示"稍后自动创建"
    enabled: cloudAvailable !== false && (cloudReady || cloudFailCount < MAX_FAILS),
    ready: cloudReady,
    hasDoc: !!data.cloudDocId,
    error: cloudReady ? '' : cloudErrorMsg,
  };
}

module.exports = {
  init, onResume, onChange,
  get, set,
  isChecked, toggleCheck, checkedCount, weekCheckedCount, weekCheckedMap,
  isStarred, toggleStar,
  reviewWord, getReviewStats, dueWords,
  syncNow, cloudStatus,
  exportBackup, importBackup,
};
