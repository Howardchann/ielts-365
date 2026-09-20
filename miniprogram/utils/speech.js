// utils/speech.js —— 语音引擎（微信同声传译插件 + 在线兜底）
// 修复要点（详见变更报告）：
//   1. iOS 静音键无声：播放前 setInnerAudioOption({obeyMuteSwitch:false})
//   2. "仅插件"模式下插件未就绪会 TypeError：任何发声路径前都判空，插件不可用自动降级
//   3. 快速连点导致叠音 / InnerAudioContext 泄漏：播放前彻底销毁旧实例 + playToken 防串音
//   4. 连读期间点单词不会打断队列：对外 speak() 先清空队列（对齐 H5 版行为）
//   5. 连读状态管理：连读与单条互斥，连读结束/中断都会广播 idle
//   6. 监听器只增不减导致内存泄漏：onStateChange 返回取消函数，页面 onUnload 调用
//   7. 新增英音/美音选择（在线兜底通道）

const state = {
  plugin: null,
  pluginOk: false,       // 插件是否可用
  engine: 'auto',        // auto | plugin | online
  rate: 0.9,
  accent: 'us',          // us 美音 | uk 英音（仅在线通道生效）
  audio: null,           // 当前 InnerAudioContext
  playingText: '',       // 正在朗读的文本
  queueMode: false,      // 是否处于整日连读中
  queue: [],
  playing: false,        // 是否正在发声
  paused: false,
  listeners: [],
};

let playToken = 0;       // 播放令牌：旧的音频回调一律作废
let audioOptDone = false;

// iOS 上默认遵守静音键，会把 InnerAudioContext 的声音吞掉 —— 这是"没声音"最常见的原因
function ensureAudioOption() {
  if (audioOptDone) return;
  audioOptDone = true;
  try {
    if (wx.setInnerAudioOption) wx.setInnerAudioOption({ obeyMuteSwitch: false });
  } catch (e) { /* 老版本基础库无此接口 */ }
}

function initPlugin() {
  try {
    const plugin = requirePlugin('WechatSI');
    state.plugin = plugin;
    state.pluginOk = !!(plugin && typeof plugin.textToSpeech === 'function');
  } catch (e) {
    state.plugin = null;
    state.pluginOk = false;
  }
  return state.pluginOk;
}

function setRate(rate) {
  const r = Math.min(1.3, Math.max(0.7, Number(rate) || 0.9));
  state.rate = r;
  return r;
}

function setEngine(engine) {
  if (['auto', 'plugin', 'online'].indexOf(engine) >= 0) state.engine = engine;
}

function setAccent(accent) {
  if (accent === 'uk' || accent === 'us') state.accent = accent;
}

// 广播播放状态：{ text, playing, mode } mode = idle | single | queue
function notify(text, playing, mode) {
  const payload = {
    text: text || '',
    playing: !!playing,
    mode: mode || (state.queueMode ? 'queue' : (playing ? 'single' : 'idle')),
  };
  state.listeners.slice().forEach(fn => {
    try { fn(payload); } catch (e) {}
  });
}

// ---- 在线兜底（有道 TTS，需配置 downloadFile 合法域名 dict.youdao.com）----
// type=2 美式发音，type=1 英式发音
function onlineUrl(text) {
  const type = state.accent === 'uk' ? 1 : 2;
  return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(text) + '&type=' + type;
}

// ---- 插件合成结果缓存 ----
// 官方配额：语音合成 100 次/分钟、2w 次/天；临时文件有效期 3 小时。
// 同一句话重复朗读（尤其整日连读反复练一年）完全没必要重复消耗配额。
const PLUGIN_MAX_LEN = 50;      // 官方文档：textToSpeech 的 content 长度限制 50 字符
const CACHE_MAX_ENTRIES = 300;
const ttsCache = {};

function cacheKey(text) { return 'en_US:' + text; }

function cacheGet(text) {
  const hit = ttsCache[cacheKey(text)];
  if (!hit) return '';
  if (hit.expiredAt <= Date.now()) { delete ttsCache[cacheKey(text)]; return ''; }
  return hit.filename;
}

function cacheSet(text, filename, expiredTime) {
  if (Object.keys(ttsCache).length >= CACHE_MAX_ENTRIES) {
    Object.keys(ttsCache).forEach(k => { delete ttsCache[k]; });
  }
  const ttl = expiredTime ? Number(expiredTime) * 1000 - Date.now() : 3 * 3600 * 1000;
  ttsCache[cacheKey(text)] = {
    filename,
    expiredAt: Date.now() + Math.min(Math.max(ttl, 60 * 1000), 3 * 3600 * 1000),
  };
}

// 插件错误码 → 人话（官方文档 fail 回调错误码）
function explainPluginError(retcode) {
  switch (Number(retcode)) {
    case -20002: return '文本超出插件限制（50 字符），已转在线朗读';
    case -20003: return '语音服务繁忙，请再点一次';
    case -20005: return '网络异常，朗读失败';
    case -40001: return '朗读次数太频繁，休息一分钟再试';
    case -20001: return '该内容不支持朗读';
    default: return '朗读失败（' + retcode + '）';
  }
}

function killAudio(audio) {
  if (!audio) return;
  try { audio.stop(); } catch (e) {}
  try { audio.destroy(); } catch (e) {}
}

function cleanup() {
  if (state.audio) {
    killAudio(state.audio);
    state.audio = null;
  }
  state.playingText = '';
  state.paused = false;
}

// 真正创建/复用播放器前，把上一个实例连根拔掉，避免叠音与泄漏
function playAudio(src, onDone) {
  ensureAudioOption();
  if (state.audio) killAudio(state.audio);

  const audio = wx.createInnerAudioContext();
  const token = ++playToken;
  state.audio = audio;
  state.paused = false;

  audio.src = src;
  audio.playbackRate = state.rate;

  audio.onPlay(() => {
    if (token !== playToken) return;
    state.playing = true;
    if (audio.playbackRate !== state.rate) audio.playbackRate = state.rate;
  });
  audio.onEnded(() => {
    if (token !== playToken) return;   // 已被新播放取代，旧回调作废
    const text = state.playingText;
    cleanup();
    state.playing = false;
    if (onDone) onDone(true, text);
  });
  audio.onError(() => {
    if (token !== playToken) return;
    const text = state.playingText;
    cleanup();
    state.playing = false;
    if (onDone) onDone(false, text);
  });

  audio.play();
}

// ---- 停止一切（连读也一并终止）----
function stop() {
  playToken++;              // 让所有在飞回调失效
  state.queue = [];
  state.queueMode = false;
  cleanup();
  state.playing = false;
  notify('', false, 'idle');
}

// ---- 暂停 / 恢复（点击正在朗读的内容时触发）----
function togglePause() {
  const audio = state.audio;
  if (!audio) return 'none';
  if (state.paused) {
    audio.play();
    state.paused = false;
    state.playing = true;
    notify(state.playingText, true);
    return 'resumed';
  }
  audio.pause();
  state.paused = true;
  state.playing = false;
  notify(state.playingText, false);
  return 'paused';
}

// 播放插件合成的本地临时文件
function playPluginFile(text, filename, onDone) {
  state.playingText = text;
  state.playing = true;
  playAudio(filename, (ok) => {
    if (state.queueMode) return onDone && onDone(ok);
    if (!ok) { stop(); onDone && onDone(false); }
    else { onDone && onDone(true); notify('', false, 'idle'); }
  });
  notify(text, true);
}

// 核心发声：不做任何队列处理，由外部调用方决定
function speakCore(text, onDone) {
  const forcedPlugin = state.engine === 'plugin';
  const useOnlineOnly = state.engine === 'online' || (state.engine === 'auto' && !state.pluginOk);
  // 插件 content 上限 50 字符（官方文档），超长的范文例句直接走在线，别浪费一次必然失败的调用
  const tooLong = text.length > PLUGIN_MAX_LEN;
  const pluginReady = state.pluginOk && !tooLong;

  const startOnline = () => {
    state.playingText = text;
    state.playing = true;
    playAudio(onlineUrl(text), (ok) => {
      if (state.queueMode) return onDone && onDone(ok);
      if (!ok) { stop(); onDone && onDone(false); }
      else { onDone && onDone(true); notify('', false, 'idle'); }
    });
    notify(text, true);
  };

  if (useOnlineOnly) { startOnline(); return; }

  if (!pluginReady) {
    // 插件不可用／未就绪（旧版本在此处直接 TypeError 崩溃）
    if (forcedPlugin) {
      const tip = !state.pluginOk ? '插件未就绪，请在设置页切换朗读引擎' : '文本过长，插件仅支持 50 字符以内';
      wx.showToast({ title: tip, icon: 'none' });
      onDone && onDone(false);
      notify('', false, 'idle');
      return;
    }
    startOnline();
    return;
  }

  // 命中缓存：直接用上次的临时文件，零网络请求、零配额
  const cached = cacheGet(text);
  if (cached) { playPluginFile(text, cached, onDone); return; }

  state.plugin.textToSpeech({
    lang: 'en_US',
    tts: true,
    content: text,
    success: (res) => {
      // 官方规定 retcode 必须为 0 才算合成成功
      if (res && Number(res.retcode) === 0 && res.filename) {
        cacheSet(text, res.filename, res.expired_time);
        playPluginFile(text, res.filename, onDone);
      } else {
        if (forcedPlugin) {
          wx.showToast({ title: explainPluginError(res && res.retcode), icon: 'none' });
          onDone && onDone(false);
          notify('', false, 'idle');
        } else {
          startOnline();
        }
      }
    },
    fail: (err) => {
      const msg = explainPluginError(err && err.retcode);
      if (forcedPlugin) {
        wx.showToast({ title: msg, icon: 'none' });
        onDone && onDone(false);
        notify('', false, 'idle');
      } else {
        startOnline();   // 自动模式：插件失败静默转在线
      }
    },
  });
}

// ---- 单次朗读（对齐 H5：点任意单词都会打断整日连读）----
function speak(text, onDone) {
  text = String(text || '').trim();
  if (!text) { if (onDone) onDone(false); return; }
  if (state.queueMode) {
    state.queue = [];
    state.queueMode = false;
  }
  speakCore(text, onDone);
}

// ---- 整日连读：队列依次朗读，任何手动 speak() 会打断 ----
function speakQueue(texts) {
  stop();
  state.queue = (texts || []).slice();
  if (!state.queue.length) return;
  state.queueMode = true;
  next();
}

function next() {
  if (!state.queueMode || !state.queue.length) {
    state.queueMode = false;
    notify('', false, 'idle');
    return;
  }
  const text = state.queue.shift();
  speakCore(text, () => {
    if (!state.queueMode) return;     // 已被打断
    setTimeout(next, 250);
  });
}

function isPlayingText(text) {
  return !!(state.audio && state.playingText === text);
}

module.exports = {
  initPlugin,
  setRate,
  setEngine,
  setAccent,
  speak,
  speakQueue,
  stop,
  togglePause,
  isPlayingText,
  isQueueActive: () => state.queueMode,
  getEngineInfo: () => ({ pluginOk: state.pluginOk, engine: state.engine, rate: state.rate, accent: state.accent }),
  // 注册监听并返回取消函数，页面 onUnload 必须调用，否则监听器会永久堆积
  onStateChange: (fn) => {
    if (typeof fn !== 'function') return () => {};
    state.listeners.push(fn);
    return () => {
      const i = state.listeners.indexOf(fn);
      if (i >= 0) state.listeners.splice(i, 1);
    };
  },
};
