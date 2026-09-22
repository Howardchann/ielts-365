// utils/speech.js —— 朗读引擎
//
// 朗读优先级
// ──────────
//   ① 预生成音频（本地缓存）—— 微软 Azure 语音，音色自然，零延迟
//   ② 预生成音频（云函数签名临时链接 → 播放 + 后台落本地缓存）
//   ③ 在线兜底：有道整句 → 有道逐词连播 → 百度整句
//
// 音频文件命名（预生成时用「词表序号」而非文本哈希 —— 8000 词的哈希映射表会
// 膨胀到 1MB+ 直接吃掉 2MB 主包，序号命名让运行时靠 ai 字段直接拼路径，零映射表）：
//   w/0001.mp3    单词 正常速        s/0001.mp3    例句 正常速
//   w/0001s.mp3   单词 慢速(-30%)    s/0001s.mp3   例句 慢速
// 每 1000 个分一个子目录，避免单目录上万文件。
//
// 为什么走云函数签名而不是 wx.cloud.downloadFile：见 utils/cloud.js 顶部注释
// （免费期存储权限锁定为「仅创建者可读写」，客户端云 API 被安全规则拒绝）。
//
// 慢速策略：rate ≤ 0.85 用慢速音频（Azure 自然放慢、音高不变），playbackRate=1；
//           rate > 0.85 用正常音频并按 rate 变速。
const cloudCfg = require('./cloud.js');

const state = {
  engine: 'pregen', engineMode: 'auto',   // engineMode: auto=预生成优先 | pregen=仅预生成 | online=仅在线TTS
  rate: 0.9, accent: 'us', audio: null,
  playingText: '', queueMode: false, queue: [], playing: false, paused: false, listeners: [],
};
let playToken = 0, audioTimeout = null, audioOptDone = false;

const CACHE_ROOT = (wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : '') + '/au';
const CACHE_MAX = 2000;      // 缓存文件数上限，超出按最久未用淘汰
const SLOW_GATE = 0.85;      // ≤ 此速率使用慢速音频
const URL_TTL = 60 * 60 * 1000;   // 签名链接按 2 小时有效估算，取一半留余量
const SIGN_BATCH = 50;            // 云函数单次最多签 50 条

function ensureAudioOption() {
  if (audioOptDone) return;
  audioOptDone = true;
  try { if (wx.setInnerAudioOption) wx.setInnerAudioOption({ obeyMuteSwitch: false }); } catch (e) {}
}
function initPlugin() { return false; }
function setRate(rate) { const r = Math.min(1.3, Math.max(0.7, Number(rate) || 0.9)); state.rate = r; return r; }
function setEngine() { state.engine = 'pregen'; }   // 兼容旧调用点；实际音源由 engineMode 控制
function setEngineMode(m) {
  if (m === 'auto' || m === 'pregen' || m === 'online') state.engineMode = m;
  return state.engineMode;
}
function setAccent(accent) { if (accent === 'uk' || accent === 'us') state.accent = accent; }
function notify(text, playing, mode) {
  const p = { text: text || '', playing: !!playing, source: usedSource || '', mode: mode || (state.queueMode ? 'queue' : (playing ? 'single' : 'idle')) };
  state.listeners.slice().forEach(fn => { try { fn(p); } catch (e) {} });
}

// ---------- 预生成音频路径 ----------
function shard(n) { return Math.floor(n / 1000); }
function fname(ai, slow) { return ('0000' + ai).slice(-4) + (slow ? 's' : '') + '.mp3'; }
function relPath(kind, ai, slow) { return kind + '/' + shard(ai) + '/' + fname(ai, slow); }
function localPath(kind, ai, slow) { return CACHE_ROOT + '/' + relPath(kind, ai, slow); }

function fs() { return wx.getFileSystemManager(); }
function exists(p) { try { fs().accessSync(p); return true; } catch (e) { return false; } }

// ---------- 云存储签名链接 ----------
// 免费期存储权限锁定 → 由云函数签发临时链接（有效期约 2h），客户端缓存复用
const urlCache = {};        // relPath -> { url, exp }
const cacheTried = {};      // relPath -> true：本会话内已尝试过落盘（避免反复失败请求）
let signQueue = Promise.resolve();   // 签名串行队列（保证不并发、不漏签）

function urlOf(rel) { const c = urlCache[rel]; return c && c.exp > Date.now() ? c.url : ''; }
function storeSignResult(items) {
  const exp = Date.now() + URL_TTL;
  (items || []).forEach(it => {
    if (it && it.path && it.url) urlCache[it.path] = { url: it.url, exp: exp };
  });
}
// 批量签名（最多 SIGN_BATCH 条/次，超出部分由调用方分片）；返回 Promise<boolean>
function signPaths(paths) {
  const need = [];
  (paths || []).forEach(p => { if (p && !urlOf(p) && need.indexOf(p) < 0) need.push(p); });
  if (!need.length) return Promise.resolve(true);
  if (!cloudCfg.ready()) return Promise.resolve(false);
  const batch = need.slice(0, SIGN_BATCH);
  signQueue = signQueue.then(() => {
    const still = batch.filter(p => !urlOf(p));      // 队列里前面的调用可能已经签过
    if (!still.length) return true;
    return wx.cloud.callFunction({ name: cloudCfg.SIGN_FN, data: { paths: still } })
      .then(res => {
        const r = res && res.result;
        if (r && r.ok) { storeSignResult(r.items); return true; }
        failNotes.push('签名失败(' + ((r && r.error) || 'unknown') + ')');
        return false;
      })
      .catch(e => { failNotes.push('云函数调用失败(' + shortErr(e) + ')'); return false; });
  });
  return signQueue;
}
// 后台把链接内容落本地缓存（需要把云存储域名加入 downloadFile 合法域名；失败静默）
function cacheInBackground(url, rel, lp) {
  if (cacheTried[rel] || !wx.downloadFile) return;
  cacheTried[rel] = true;
  try {
    wx.downloadFile({
      url: url, timeout: 15000,
      success: res => { if (res.statusCode === 200) saveCache(res.tempFilePath, lp); },
      fail: () => {},
    });
  } catch (e) {}
}

// 缓存淘汰：按 mtime 从旧到新删，直到低于上限的 80%
let saveCount = 0, evicting = false;
function evict() {
  if (evicting) return;
  evicting = true;
  try {
    const all = [];
    ['w', 's'].forEach(kind => {
      for (let sh = 0; sh <= 8; sh++) {
        const dir = CACHE_ROOT + '/' + kind + '/' + sh;
        let names = [];
        try { names = fs().readdirSync(dir); } catch (e) { continue; }
        names.forEach(n => {
          const p = dir + '/' + n;
          try { const st = fs().statSync(p); all.push({ p: p, t: st.lastModifiedTime || 0 }); } catch (e) {}
        });
      }
    });
    if (all.length <= CACHE_MAX) { evicting = false; return; }
    all.sort((a, b) => a.t - b.t);
    const target = Math.floor(CACHE_MAX * 0.8);
    for (let i = 0; i < all.length - target; i++) {
      try { fs().unlinkSync(all[i].p); } catch (e) {}
    }
  } catch (e) {}
  evicting = false;
}

function saveCache(tempPath, dest) {
  try {
    const dir = dest.slice(0, dest.lastIndexOf('/'));
    try { fs().mkdirSync(dir, true); } catch (e) {}
    fs().copyFileSync(tempPath, dest);
    if (++saveCount % 50 === 0) evict();
    return true;
  } catch (e) { return false; }
}

// ---------- 播放 ----------
function killAudio(audio) { if (!audio) return; try { audio.stop(); } catch (e) {} try { audio.destroy(); } catch (e) {} }
function cleanup() {
  if (audioTimeout) { clearTimeout(audioTimeout); audioTimeout = null; }
  if (state.audio) { killAudio(state.audio); state.audio = null; }
  state.playingText = '';
  state.paused = false;
}
function playSrc(src, isFile, onResult, timeoutMs, rate) {
  const token = ++playToken, host = isFile ? '本地文件' : String(src).split('/')[2];
  if (state.audio) killAudio(state.audio);
  const audio = wx.createInnerAudioContext();
  state.audio = audio; state.paused = false; audio.src = src;
  audio.playbackRate = rate;
  let started = false;
  audioTimeout = setTimeout(() => {
    if (token !== playToken || started) return;
    failNotes.push(host + ' 未出声'); cleanup(); state.playing = false; onResult(false);
  }, timeoutMs || 6000);
  audio.onPlay(() => { if (token !== playToken) return; started = true; state.playing = true; });
  audio.onEnded(() => { if (token !== playToken) return; cleanup(); state.playing = false; onResult(true); });
  audio.onError(err => {
    if (token !== playToken) return;
    failNotes.push(host + ' 播放报错' + (err && err.errCode ? ('(' + err.errCode + ')') : ''));
    cleanup(); state.playing = false; onResult(false);
  });
  audio.play();
}

// ① / ② 预生成音频：本地缓存 → 云存储（云函数签名链接）
function playSigned(url, lp, rel, onResult, slow) {
  usedSource = '预生成·云端';
  playSrc(url, false, ok => {
    if (ok) { cacheInBackground(url, rel, lp); onResult(true); return; }
    delete urlCache[rel];        // 链接可能已过期/被撤销 → 丢弃，下次重新签
    onResult(false);
  }, 6000, slow ? 1 : state.rate);
}

function tryPregenRel(rel, lp, onResult) {
  const slow = state.rate <= SLOW_GATE;
  if (exists(lp)) { usedSource = '预生成·本地'; playSrc(lp, true, onResult, 5000, slow ? 1 : state.rate); return; }
  if (!cloudCfg.ready()) { onResult(false); return; }

  const hit = urlOf(rel);
  if (hit) { playSigned(hit, lp, rel, onResult, slow); return; }

  const token = ++playToken;
  signPaths([rel]).then(ok => {
    if (token !== playToken) return;          // 期间用户已切到别的朗读
    const url = urlOf(rel);
    if (!ok || !url) { onResult(false); return; }
    playSigned(url, lp, rel, onResult, slow);
  });
}

function tryPregen(kind, ai, onResult) {
  if (!ai) { onResult(false); return; }
  const slow = state.rate <= SLOW_GATE;
  tryPregenRel(relPath(kind, ai, slow), localPath(kind, ai, slow), onResult);
}

// 语法例句预生成：按「文本 djb2 哈希」命名（g/{hash%10}/{hash8}.mp3 + s 慢速），
// 数据文件零改动，与生成脚本 gen_grammar.py 的哈希算法必须保持一致。
// 中文条目未预生成 → 哈希命中不到自然降级在线朗读。
function hashName(t) {
  let h = 5381;
  // 必须 >>> 0 转无符号：& 0xFFFFFFFF 会得到 int32，>2^31 时为负 → 文件名带负号
  for (let i = 0; i < t.length; i++) h = (h * 33 + t.charCodeAt(i)) >>> 0;
  return ('0000000' + h.toString(16)).slice(-8);
}
function gRel(text, slow) {
  const h = hashName(text);
  return 'g/' + (parseInt(h, 16) % 10) + '/' + h + (slow ? 's' : '') + '.mp3';
}
function tryPregenG(text, onResult) {
  // 中文条目（记忆法说明）没有预生成音频 → 直接走在线，省一次无效的云函数调用与播放报错
  if (/[^\x20-\x7E]/.test(text)) { onResult(false); return; }
  const slow = state.rate <= SLOW_GATE;
  const rel = gRel(text, slow);
  tryPregenRel(rel, CACHE_ROOT + '/' + rel, onResult);
}

// ---------- ③ 在线兜底链 ----------
function onlineUrl(text) { return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(text) + '&type=' + (state.accent === 'uk' ? 1 : 2); }
function fallbackUrl(text) { return 'https://fanyi.baidu.com/gettts?lan=en&spd=3&source=web&text=' + encodeURIComponent(text); }
function shortErr(e) { return String((e && (e.errMsg || e.errmsg || e.errCode)) || e || '').replace(/^[^:]*:fail\s*/, '').slice(0, 50); }

function precheck(url, onPass, onFail) {
  const token = ++playToken, host = String(url).split('/')[2];
  wx.downloadFile({
    url: url, timeout: 8000,
    success: res => {
      if (token !== playToken) return;
      if (res.statusCode !== 200) { failNotes.push(host + ' HTTP ' + res.statusCode); onFail(); return; }
      onPass(res.tempFilePath);
    },
    fail: err => { if (token !== playToken) return; failNotes.push(host + ' 下载被拦(' + shortErr(err) + ')'); onFail(); },
  });
}
function tryUrl(url, onResult, ms) {
  const t = ms || 6000;
  precheck(url, file => {
    // 预检通过：先直连播，失败再播已落盘的临时文件
    playSrc(url, false, ok => { if (ok) { onResult(true); return; } playSrc(file, true, onResult, t); }, t, state.rate);
  }, () => {
    // 预检被拦（域名未配 / 网络抖动）→ 仍直连再试一次：
    // media 通道播放 https 链接不受 downloadFile 合法域名限制（真机上实测有效）
    playSrc(url, false, onResult, t, state.rate);
  });
}
function trySentence(text, onResult) { usedSource = '有道整句'; tryUrl(onlineUrl(text), onResult, 6000); }
function tryWords(text, onResult) {
  const words = String(text).replace(/[^A-Za-z0-9'\-\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length < 2) { onResult(false); return; }
  usedSource = '有道逐词';
  let i = 0, okAny = false;
  const next = () => {
    if (i >= words.length) { onResult(okAny); return; }
    playSrc(onlineUrl(words[i++]), false, ok => { if (ok) okAny = true; next(); }, 3500, state.rate);
  };
  next();
}
function tryBaidu(text, onResult) { usedSource = '百度'; tryUrl(fallbackUrl(text), onResult, 7000); }

// ---------- 统一入口 ----------
let failNotes = [], usedSource = '';
const DEBUG_FAIL = true;   // 诊断期弹明细；稳定后改 false 即恢复一行 toast

// item: 字符串 | {text, ai, kind}  kind: 'w' 单词 / 's' 例句
function playItem(item, onDone) {
  ensureAudioOption();
  failNotes = []; usedSource = '';
  const isObj = item && typeof item === 'object';
  const text = isObj ? String(item.text || '') : String(item || '');
  if (!text) { if (onDone) onDone(false); return; }
  const ai = isObj ? item.ai : 0;
  const kind = (isObj && item.kind) || 's';
  const useG = (kind === 'g') || (kind === 's' && !ai);   // 无编号的句子 = 语法例句（文本哈希预生成）

  // 朗读链按 engineMode 组装：
  //   auto    → 预生成 → 有道整句 → 百度整句
  //   pregen  → 仅预生成
  //   online  → 有道整句 → 百度整句
  // 「逐词连播」只保留给单词（kind='w'）——句子逐词蹦体验差，宁可用百度整句兜底。
  const chain = [];
  if (state.engineMode !== 'online') {
    chain.push(useG ? { run: cb => tryPregenG(text, cb) } : { run: cb => tryPregen(kind, ai, cb) });
  }
  if (state.engineMode !== 'pregen') {
    chain.push({ run: cb => trySentence(text, cb) });
    if (kind === 'w') chain.push({ run: cb => tryWords(text, cb) });
    chain.push({ run: cb => tryBaidu(text, cb) });
  }
  let i = 0;
  const step = ok => {
    if (ok) { notify(state.playingText, true); if (onDone) onDone(true); return; }
    i++;
    if (i < chain.length) { chain[i].run(step); return; }
    const detail = [...new Set(failNotes)].join('\n');
    console.warn('[speech] 朗读失败：\n' + detail);
    if (DEBUG_FAIL && detail) wx.showModal({ title: '朗读失败（诊断）', content: detail, showCancel: false, confirmText: '知道了' });
    else wx.showToast({ title: '朗读失败，请检查网络', icon: 'none' });
    if (onDone) onDone(false);
  };
  chain[0].run(step);
}

// 预热：把某天要用的音频链接提前签好（后台静默执行，失败不影响播放）
function prefetch(items) {
  if (!cloudCfg.ready()) return;
  const slow = state.rate <= SLOW_GATE;
  const need = [];
  (items || []).forEach(it => {
    const ai = it && it.ai;
    if (!ai) return;
    const kind = it.kind || 's';
    const rel = relPath(kind, ai, slow);
    if (exists(localPath(kind, ai, slow))) return;
    if (urlOf(rel)) return;
    if (need.indexOf(rel) < 0) need.push(rel);
  });
  if (!need.length) return;
  for (let i = 0; i < need.length; i += SIGN_BATCH) {
    const chunk = need.slice(i, i + SIGN_BATCH);
    signPaths(chunk).then(ok => {
      if (!ok) return;
      // 顺手把前几条落盘，减少下次播放的网络请求（失败静默）
      chunk.slice(0, 10).forEach(rel => {
        const url = urlOf(rel);
        if (url) cacheInBackground(url, rel, CACHE_ROOT + '/' + rel);
      });
    });
  }
}

function stop() { playToken++; state.queue = []; state.queueMode = false; cleanup(); state.playing = false; notify('', false, 'idle'); }
function togglePause() {
  const audio = state.audio;
  if (!audio) return 'none';
  if (state.paused) { audio.play(); state.paused = false; state.playing = true; notify(state.playingText, true); return 'resumed'; }
  audio.pause(); state.paused = true; state.playing = false; notify(state.playingText, false); return 'paused';
}
function speakCore(item, onDone) {
  const text = item && typeof item === 'object' ? item.text : item;
  state.playingText = text; state.playing = true;
  playItem(item, ok => {
    if (state.queueMode) { if (onDone) onDone(ok); return; }
    if (!ok) { stop(); if (onDone) onDone(false); }
    else { if (onDone) onDone(true); notify('', false, 'idle'); }
  });
  notify(text, true);
}
function speak(text, opts) {
  const t = String(text || '').trim();
  if (!t) return;
  const item = opts && opts.ai ? { text: t, ai: opts.ai, kind: opts.kind || 's' } : t;
  if (state.queueMode) { state.queue = []; state.queueMode = false; }
  speakCore(item);
}
function speakQueue(items) {
  stop();
  state.queue = (items || []).filter(Boolean);
  if (!state.queue.length) return;
  state.queueMode = true;
  next();
}
function next() {
  if (!state.queueMode || !state.queue.length) { state.queueMode = false; notify('', false, 'idle'); return; }
  const item = state.queue.shift();
  speakCore(item, () => { if (!state.queueMode) return; setTimeout(next, 250); });
}
function isPlayingText(text) { return !!(state.audio && state.playingText === text); }

module.exports = {
  initPlugin, setRate, setEngine, setEngineMode, setAccent, speak, speakQueue, prefetch, stop, togglePause, isPlayingText,
  isQueueActive: () => state.queueMode,
  getEngineInfo: () => ({ pluginOk: false, engine: cloudCfg.ready() ? 'pregen' : 'online', engineMode: state.engineMode, rate: state.rate, accent: state.accent }),
  onStateChange: (fn) => {
    if (typeof fn !== 'function') return () => {};
    state.listeners.push(fn);
    return () => { const i = state.listeners.indexOf(fn); if (i >= 0) state.listeners.splice(i, 1); };
  },
};
