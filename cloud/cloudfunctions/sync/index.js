// sync —— 学习进度的多端在线同步（服务端合并）
//
// 身份：openid 由微信侧下发（cloud.getWXContext()），一个微信用户一条数据。
//      没有账号体系、没有登录界面 —— 换手机只要登录同一个微信，进度自动对上。
//
// 集合：progress，同一集合放两种文档（这样一次查询就能把一个人的全部数据取回来）：
//   { _id: '<openid>',         kind: 'core', owner: <openid>, ...核心进度 }
//   { _id: '<openid>#rs<i>',   kind: 'rs',   owner: <openid>, i: 0..7, stats: { 单词: 复习记录 } }
//
// ⚠️ 复习记录为什么分成 8 片：
//   8000 个单词的复习记录单条约 760KB，超过云开发「单条记录 512KB」的上限，
//   硬塞一条记录迟早会写失败（而且是用了几个月之后才爆，很难查）。
//   按单词哈希分 8 片后每片约 95KB，安全。分片号只由服务端计算，客户端不需要知道分片的存在。
//
// 合并规则（先合并、再写回 —— 避免"后写覆盖先写"把另一台设备的进度抹掉）：
//   打卡 / 取消打卡：按天取更晚的时间戳，晚者胜。取消过就是真取消，不会被另一端的旧打卡复活。
//   收藏 / 取消收藏：按单词取更晚的时间戳，晚者胜。
//   复习记录：     按单词取 lastReviewedAt 更晚的一条（快照语义，不是增量日志，重复同步不会把次数翻倍）。
//   设置项（开始日期 / 语速 / 口音 / 朗读方式）：整组按 settingsAt 更晚者胜。
//
// 客户端每次只上送"自上次同步后变动过的复习记录"（reviewDirty）。
// 服务端用 dotted-path 只原子更新这些单词，不会覆盖同一片里别的单词，也不会因为并发丢数据。
//
// 返回：{ ok, core, reviewFull|null, reviewPatch, reviewRev, serverTime }
//   reviewFull  仅当客户端手里的 reviewRev 落后于服务端时返回 → 换机 / 另一端改过 → 全量对齐
//   reviewPatch 本次上送单词合并后的真值 → 客户端据此纠正本地（服务端更晚时会把它顶回去）
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTION = 'progress';
const RS_SHARDS = 8;              // 复习记录分片数
const DAY_KEY = /^w\d{1,2}d[1-7]$/;
const MAX_CHECKED = 1200;         // 546 个学习日 + 余量
const MAX_STARS = 6000;
const MAX_DIRTY = 400;            // 单次最多合并 400 个单词，超出的留到下次
const MAX_WORD_LEN = 60;
const MAX_REVIEW_TS = 4e12;       // 约 2096 年，防脏数据把排序搞乱

// ---------------- 基础工具 ----------------

// 归一化时间戳：新版存毫秒时间戳；旧版（个人版）存 1（布尔式打卡）。
// 把旧值当成"极早的时间"（=1），这样任何一次显式「取消打卡」都能压过它。
function toTs(v) {
  const n = Math.floor(Number(v) || 0);
  if (n > 1e12) return n;
  return n > 0 ? 1 : 0;
}
function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v) || 0);
  if (!isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function str(v, max) { return String(v == null ? '' : v).slice(0, max); }

// 单词 → 分片号。只由服务端使用；只要算法不变，历史数据的归属就不会漂移。
function shardOf(word) {
  let h = 0;
  for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
  return h % RS_SHARDS;
}

// ---------------- 入参清洗（云函数是公开入口，不能信任任何字段） ----------------

function cleanDayMap(raw, limit) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  Object.keys(raw).forEach(k => {
    if (n >= limit) return;
    if (!DAY_KEY.test(k)) return;
    const ts = toTs(raw[k]);
    if (!ts) return;
    out[k] = ts; n++;
  });
  return out;
}

function cleanStars(raw, limit) {
  const out = [], seen = {};
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < raw.length && out.length < limit; i++) {
    const it = raw[i];
    if (!it || !it.w) continue;
    const w = str(it.w, MAX_WORD_LEN);
    if (!w || seen[w]) continue;
    seen[w] = 1;
    out.push({ w: w, m: str(it.m, 80), p: str(it.p, 20), e: str(it.e, 300), ts: toTs(it.ts) || 1 });
  }
  return out;
}

function cleanWordTs(raw, limit) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  Object.keys(raw).forEach(k => {
    if (n >= limit) return;
    const w = str(k, MAX_WORD_LEN);
    if (!w) return;
    const ts = toTs(raw[k]);
    if (!ts) return;
    out[w] = ts; n++;
  });
  return out;
}

function sameReviewEntry(a, b) {
  if (!a || !b) return false;
  return Number(a.correct) === Number(b.correct) &&
    Number(a.wrong) === Number(b.wrong) &&
    Number(a.level) === Number(b.level) &&
    Number(a.nextReviewAt) === Number(b.nextReviewAt) &&
    Number(a.lastReviewedAt) === Number(b.lastReviewedAt);
}

function cleanEntry(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    correct: clampInt(s.correct, 0, 999999),
    wrong: clampInt(s.wrong, 0, 999999),
    level: clampInt(s.level, 0, 8),
    nextReviewAt: clampInt(s.nextReviewAt, 0, MAX_REVIEW_TS),
    lastReviewedAt: clampInt(s.lastReviewedAt, 0, MAX_REVIEW_TS),
  };
}

// 客户端上送的"变动过的复习记录"
function cleanDirty(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  Object.keys(raw).forEach(k => {
    if (n >= MAX_DIRTY) return;
    const w = str(k, MAX_WORD_LEN);
    if (!w) return;
    const e = cleanEntry(raw[k]);
    if (!e) return;
    out[w] = e; n++;
  });
  return out;
}

function cleanCore(raw) {
  const c = (raw && typeof raw === 'object') ? raw : {};
  return {
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(c.startDate) ? c.startDate : '',
    rate: (Number(c.rate) >= 0.5 && Number(c.rate) <= 2) ? Number(c.rate) : 0,
    accent: (c.accent === 'us' || c.accent === 'uk') ? c.accent : '',
    engineMode: str(c.engineMode, 20),
    checkedDays: cleanDayMap(c.checkedDays, MAX_CHECKED),
    uncheckedDays: cleanDayMap(c.uncheckedDays, MAX_CHECKED),
    starredWords: cleanStars(c.starredWords, MAX_STARS),
    unstarredWords: cleanWordTs(c.unstarredWords, MAX_STARS),
    settingsAt: clampInt(c.settingsAt, 0, MAX_REVIEW_TS),
  };
}

// ---------------- 合并 ----------------

// 打卡 / 取消打卡：同一个 key 取更晚的时间戳，谁晚听谁的
function mergeDays(a, b) {
  const A = a || {}, B = b || {};
  const checked = {}, unchecked = {};
  const keys = {};
  [A.checkedDays, A.uncheckedDays, B.checkedDays, B.uncheckedDays].forEach(m => {
    if (m) Object.keys(m).forEach(k => { keys[k] = 1; });
  });
  Object.keys(keys).forEach(k => {
    const cA = toTs(A.checkedDays && A.checkedDays[k]);
    const cB = toTs(B.checkedDays && B.checkedDays[k]);
    const uA = toTs(A.uncheckedDays && A.uncheckedDays[k]);
    const uB = toTs(B.uncheckedDays && B.uncheckedDays[k]);
    const ct = Math.max(cA, cB);
    const ut = Math.max(uA, uB);
    if (ct > 0 && ct >= ut) checked[k] = ct;
    else if (ut > 0) unchecked[k] = ut;
  });
  return { checkedDays: checked, uncheckedDays: unchecked };
}

// 收藏 / 取消收藏：按单词取更晚的时间戳
function mergeStars(a, b) {
  const A = a || {}, B = b || {};
  const best = {};   // word -> { ts, del, item }
  const put = (w, ts, del, item) => {
    if (!w || !ts) return;
    const cur = best[w];
    if (!cur || ts > cur.ts) best[w] = { ts: ts, del: del, item: item };
  };
  (A.starredWords || []).forEach(it => put(it && it.w, toTs(it && it.ts), false, it));
  (B.starredWords || []).forEach(it => put(it && it.w, toTs(it && it.ts), false, it));
  Object.keys(A.unstarredWords || {}).forEach(w => put(w, toTs(A.unstarredWords[w]), true, null));
  Object.keys(B.unstarredWords || {}).forEach(w => put(w, toTs(B.unstarredWords[w]), true, null));

  const starredWords = [], unstarredWords = {};
  Object.keys(best).forEach(w => {
    const e = best[w];
    if (e.del) unstarredWords[w] = e.ts;
    else if (e.item) {
      starredWords.push({
        w: str(e.item.w, MAX_WORD_LEN), m: str(e.item.m, 80),
        p: str(e.item.p, 20), e: str(e.item.e, 300), ts: e.ts,
      });
    }
  });
  return { starredWords: starredWords, unstarredWords: unstarredWords };
}

// ---------------- 读写 ----------------

let collReady = false;

async function ensureCollection() {
  if (collReady) return;
  try { await db.createCollection(COLLECTION); } catch (e) { /* 已存在会报错，忽略即可 */ }
  collReady = true;
}

async function readAll(openid) {
  const run = () => db.collection(COLLECTION).where({ owner: openid }).limit(RS_SHARDS + 2).get();
  try {
    const r = await run();
    collReady = true;
    return r.data || [];
  } catch (e) {
    const msg = String((e && (e.errMsg || e.message)) || e);
    // -502005 / collection not exists：第一次使用时集合还不存在，自动建一次再重试
    if (/collection|not exist|502005/i.test(msg)) {
      collReady = false;
      await ensureCollection();
      const r = await run();
      return r.data || [];
    }
    throw e;
  }
}

// 只在文档不存在时创建的 set；已存在则用 dotted-path 原子更新，绝不整条覆盖
async function upsertDoc(id, createData, patch) {
  try {
    const r = await db.collection(COLLECTION).doc(id).update({ data: patch });
    const updated = r && r.stats && r.stats.updated;
    if (updated) return 'updated';
  } catch (e) { /* 文档不存在会抛错，走下面的创建 */ }
  try {
    await db.collection(COLLECTION).doc(id).set({ data: createData });
    return 'created';
  } catch (e2) {
    // 并发下可能刚被别人创建：再试一次原子更新
    await db.collection(COLLECTION).doc(id).update({ data: patch });
    return 'updated';
  }
}

// ---------------- 入口 ----------------

exports.main = async (event) => {
  const wx = cloud.getWXContext();
  const openid = wx && wx.OPENID;
  if (!openid) return { ok: false, error: '无法识别用户身份（OPENID 为空）' };
  const action = str((event && event.action) || 'merge', 20);
  if (action !== 'merge') return { ok: false, error: '不支持的操作：' + action };

  const income = cleanCore(event.core);
  const dirty = cleanDirty(event.reviewDirty);
  const clientRev = clampInt(event.reviewRev, 0, 1e9);

  // 1) 取回该用户的全部文档（core + 8 个分片，一次查询）
  let docs = [];
  try {
    docs = await readAll(openid);
  } catch (e) {
    return { ok: false, error: '读取云端进度失败：' + String((e && e.message) || e) };
  }

  let coreDoc = null;
  const shards = {};               // i -> stats 对象
  docs.forEach(d => {
    if (!d) return;
    if (d.kind === 'rs') shards[clampInt(d.i, 0, RS_SHARDS - 1)] = (d.stats && typeof d.stats === 'object') ? d.stats : {};
    else if (d.kind === 'core') coreDoc = d;
    else if (!d.kind && (d.checkedDays || d.reviewStats)) coreDoc = d;   // 兼容早期无 kind 字段的文档
  });

  const serverRev = clampInt(coreDoc && coreDoc.reviewRev, 0, 1e9);
  const remoteCore = cleanCore(coreDoc || {});
  const needFull = clientRev !== serverRev;   // 客户端落后（换机 / 另一端改过）→ 回全量

  // 2) 合并核心进度
  const dm = mergeDays(remoteCore, income);
  const sm = mergeStars(remoteCore, income);
  const remoteSettingsAt = clampInt(remoteCore.settingsAt, 0, MAX_REVIEW_TS);
  const incomeSettingsAt = clampInt(income.settingsAt, 0, MAX_REVIEW_TS);
  const settingsFromClient = incomeSettingsAt > remoteSettingsAt;

  const mergedCore = {
    startDate: (settingsFromClient && income.startDate) || remoteCore.startDate || income.startDate || '',
    rate: (settingsFromClient && income.rate) || remoteCore.rate || income.rate || 0,
    accent: (settingsFromClient && income.accent) || remoteCore.accent || income.accent || '',
    engineMode: (settingsFromClient && income.engineMode) || remoteCore.engineMode || income.engineMode || '',
    settingsAt: Math.max(remoteSettingsAt, incomeSettingsAt),
    checkedDays: dm.checkedDays,
    uncheckedDays: dm.uncheckedDays,
    starredWords: sm.starredWords,
    unstarredWords: sm.unstarredWords,
  };

  // 3) 合并复习记录：只处理本次上送的单词，取 lastReviewedAt 更晚的一条
  const patchByShard = {};         // i -> { word: entry }
  const reviewPatch = {};
  Object.keys(dirty).forEach(w => {
    const i = shardOf(w);
    if (!shards[i]) shards[i] = {};
    const cur = shards[i];
    const old = cur[w];
    const inc = dirty[w];
    const merged = (!old || (inc.lastReviewedAt || 0) >= (old.lastReviewedAt || 0)) ? inc : cleanEntry(old);
    if (!merged) return;

    // 只有服务端最终值真的发生变化，才进入 patch / 写库 / reviewRev +1。
    // 旧设备重复上传同一快照、或上传比云端更旧的记录，都不应制造“虚假的新版本”。
    const changed = !old || !sameReviewEntry(merged, old);
    cur[w] = merged;                 // 同步更新内存快照，needFull 时才能把本次合并结果一起回给客户端
    if (!changed) return;
    if (!patchByShard[i]) patchByShard[i] = {};
    patchByShard[i][w] = merged;
    reviewPatch[w] = merged;
  });
  const rsChanged = Object.keys(patchByShard).length > 0;
  const reviewRev = serverRev + (rsChanged ? 1 : 0);

  // 4) 写回（先合并后写；只在内容真变化时写，省资源点）
  const coreChanged =
    JSON.stringify(mergedCore.checkedDays) !== JSON.stringify(remoteCore.checkedDays) ||
    JSON.stringify(mergedCore.uncheckedDays) !== JSON.stringify(remoteCore.uncheckedDays) ||
    JSON.stringify(mergedCore.starredWords) !== JSON.stringify(remoteCore.starredWords) ||
    JSON.stringify(mergedCore.unstarredWords) !== JSON.stringify(remoteCore.unstarredWords) ||
    mergedCore.startDate !== remoteCore.startDate ||
    mergedCore.rate !== remoteCore.rate ||
    mergedCore.accent !== remoteCore.accent ||
    mergedCore.engineMode !== remoteCore.engineMode;

  const coreData = Object.assign({}, mergedCore, {
    owner: openid, kind: 'core', reviewRev: reviewRev, updatedAt: Date.now(),
  });

  let wrote = 0;
  try {
    if (coreChanged || !coreDoc || rsChanged) {
      await upsertDoc(openid, coreData, Object.assign({}, mergedCore, { reviewRev: reviewRev, updatedAt: coreData.updatedAt }));
      wrote++;
    }
    const shardIds = Object.keys(patchByShard);
    for (let k = 0; k < shardIds.length; k++) {
      const i = Number(shardIds[k]);
      const id = openid + '#rs' + i;
      const patch = {};
      Object.keys(patchByShard[i]).forEach(w => { patch['stats.' + w] = patchByShard[i][w]; });
      await upsertDoc(id, { owner: openid, kind: 'rs', i: i, stats: patchByShard[i] }, patch);
      wrote++;
    }
  } catch (e) {
    return { ok: false, error: '写入云端失败：' + String((e && e.message) || e) };
  }

  // 5) 组装返回
  let reviewFull = null;
  if (needFull) {
    reviewFull = {};
    Object.keys(shards).forEach(i => {
      const s = shards[i] || {};
      Object.keys(s).forEach(w => { reviewFull[w] = cleanEntry(s[w]); });
    });
  }

  return {
    ok: true,
    openid: openid.slice(0, 6) + '***',        // 只回一个可辨识前缀，不回完整 openid
    core: mergedCore,
    reviewFull: reviewFull,
    reviewPatch: reviewPatch,
    reviewRev: reviewRev,
    reviewTotal: needFull ? Object.keys(reviewFull || {}).length : undefined,
    wrote: wrote,
    serverTime: Date.now(),
  };
};
