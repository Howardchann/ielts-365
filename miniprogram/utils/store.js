// utils/store.js —— 进度管理：本地缓存 + 云数据库同步
// 多端同步原理：手机和电脑登录同一微信，云端记录天然按用户隔离；
// 写入先落本地（秒级），防抖 3 秒后推云；切回前台/启动时从云端拉取较新版本。

const KEY = 'ielts-365-store';
const COLLECTION = 'progress';

const defaults = () => ({
  startDate: '2026-09-21',   // 计划开始日（周一）
  checkedDays: {},           // { 'w1d1': 1, 'w12d3': 1, ... }
  starredWords: [],          // [ {w,m,p,e} ]
  rate: 0.9,                 // 朗读语速
  engine: 'auto',            // auto | plugin | online
  updatedAt: 0,
  cloudDocId: '',            // 云端记录 _id（首次同步后缓存）
});

let data = defaults();
let cloudReady = false;
let cloudEnabled = true;     // 云开发未开通时自动降级为纯本地
let pushTimer = null;
let listeners = [];

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
  listeners.forEach(fn => { try { fn(data); } catch (e) {} });
}

// ============ 云同步 ============
function db() {
  if (!wx.cloud) return null;
  try { return wx.cloud.database(); } catch (e) { return null; }
}

// 拉取云端：若云端 updatedAt 更新，覆盖本地并广播
function pullCloud() {
  const database = db();
  if (!database) return;
  database.collection(COLLECTION).limit(1).get().then(res => {
    cloudReady = true;
    const rows = res.data || [];
    if (rows.length) {
      data.cloudDocId = rows[0]._id;
      const remote = rows[0];
      const remoteTime = remote.updatedAt || 0;
      if (remoteTime > data.updatedAt) {
        data.startDate = remote.startDate || data.startDate;
        data.checkedDays = remote.checkedDays || data.checkedDays;
        data.starredWords = remote.starredWords || data.starredWords;
        data.rate = remote.rate || data.rate;
        data.engine = remote.engine || data.engine;
        data.updatedAt = remoteTime;
        saveLocal();
        emit();
      }
    } else {
      data.cloudDocId = '';
      pushCloud(); // 首次使用：把本地进度建为云端记录
    }
  }).catch(err => {
    // 常见原因：未开通云开发 / 集合不存在 / 无网络
    cloudEnabled = false;
    console.warn('云同步不可用（可先在设置页创建集合）：', err && err.errMsg);
  });
}

// 推送云端（last-write-wins）
function pushCloud() {
  if (!cloudEnabled) return;
  const database = db();
  if (!database) return;
  const payload = {
    startDate: data.startDate,
    checkedDays: data.checkedDays,
    starredWords: data.starredWords,
    rate: data.rate,
    engine: data.engine,
    updatedAt: Date.now(),
  };
  const finish = (docId) => {
    data.cloudDocId = docId;
    data.updatedAt = payload.updatedAt;
    saveLocal();
  };
  if (data.cloudDocId) {
    database.collection(COLLECTION).doc(data.cloudDocId).update({ data: payload })
      .then(() => finish(data.cloudDocId))
      .catch(() => { pullCloud(); });
  } else {
    database.collection(COLLECTION).add({ data: payload })
      .then(res => finish(res._id))
      .catch(() => { pullCloud(); });
  }
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(pushCloud, 3000);
}

// ============ 对外 API ============
function init() {
  loadLocal();
  pullCloud();
}

// 页面切回前台：重新拉一次，保证双端及时同步
function onResume() {
  pullCloud();
}

function onChange(fn) {
  if (typeof fn === 'function') listeners.push(fn);
}

function get(key) {
  return key ? data[key] : data;
}

function set(key, value) {
  data[key] = value;
  saveLocal();
  schedulePush();
  emit();
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

// ---- 手动全量同步（设置页按钮） ----
function syncNow() {
  return new Promise((resolve) => {
    const database = db();
    if (!database) { resolve({ ok: false, msg: '基础库不支持云开发' }); return; }
    pushCloud();
    setTimeout(() => resolve({ ok: cloudReady, msg: cloudReady ? '已同步' : '云同步不可用，请检查云开发设置' }), 1500);
  });
}

function cloudStatus() {
  return { enabled: cloudEnabled, ready: cloudReady, hasDoc: !!data.cloudDocId };
}

module.exports = {
  init, onResume, onChange,
  get, set,
  isChecked, toggleCheck, checkedCount, weekCheckedCount,
  isStarred, toggleStar,
  syncNow, cloudStatus,
};
