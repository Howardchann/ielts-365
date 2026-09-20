// utils/speech.js —— 微信同声传译插件 TTS 封装
// 主引擎：WechatSI（官方插件，免域名白名单）；插件不可用时兜底有道 TTS（需在后台配置合法域名）。
// 支持：单词/例句朗读、整日连读队列、暂停/恢复、语速（playbackRate）。

const state = {
  plugin: null,
  pluginOk: false,       // 插件是否可用
  engine: 'auto',       // auto | plugin | online
  rate: 0.9,
  audio: null,          // 当前 InnerAudioContext
  playingText: '',      // 正在朗读的文本（暂停/恢复判断）
  queue: [],            // 连读队列
  queueActive: false,
  listeners: [],         // 播放状态回调（多页面监听）
};

function initPlugin() {
  try {
    const plugin = requirePlugin('WechatSI');
    state.plugin = plugin;
    // 探测插件接口
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

function notify(text, playing) {
  state.listeners.forEach(fn => { try { fn(text, playing); } catch (e) {} });
}

// ---- 在线兜底（有道 TTS，需配置 downloadFile 合法域名） ----
function onlineUrl(text) {
  return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(text) + '&type=2';
}

function playAudio(src, localFile, onDone) {
  const audio = wx.createInnerAudioContext();
  if (localFile) audio.src = src;           // 插件返回的本地临时文件
  else audio.src = src;                      // 在线 URL
  audio.playbackRate = state.rate;            // 语速 0.5-2.0
  state.audio = audio;
  audio.onPlay(() => { if (audio.playbackRate !== state.rate) audio.playbackRate = state.rate; });
  audio.onEnded(() => { cleanup(); if (onDone) onDone(true); });
  audio.onError(() => { cleanup(); if (onDone) onDone(false); });
  audio.play();
}

function cleanup() {
  if (state.audio) {
    try { state.audio.destroy(); } catch (e) {}
    state.audio = null;
  }
  state.playingText = '';
}

// ---- 停止一切 ----
function stop() {
  state.queue = [];
  state.queueActive = false;
  if (state.audio) {
    try { state.audio.stop(); } catch (e) {}
    cleanup();
  }
  notify('', false);
}

// ---- 暂停 / 恢复（点击正在朗读的内容时触发） ----
function togglePause() {
  const audio = state.audio;
  if (!audio) return 'none';
  if (audio.paused) {
    audio.play();
    notify(state.playingText, true);
    return 'resumed';
  }
  audio.pause();
  notify(state.playingText, false);
  return 'paused';
}

// ---- 单次朗读（自动选择引擎） ----
function speak(text, onDone) {
  text = String(text || '').trim();
  if (!text) { if (onDone) onDone(false); return; }

  const useOnlineOnly = state.engine === 'online' || (state.engine === 'auto' && !state.pluginOk);
  const usePlugin = state.engine === 'plugin' || (state.engine === 'auto' && state.pluginOk);

  const startOnline = () => {
    playAudio(onlineUrl(text), false, (ok) => {
      if (!ok) { stop(); if (onDone) onDone(false); }
      else if (onDone) onDone(true);
    });
    notify(text, true);
  };

  if (useOnlineOnly) { startOnline(); return; }
  if (!usePlugin) { if (onDone) onDone(false); return; }

  state.plugin.textToSpeech({
    lang: 'en_US',
    tts: true,
    content: text,
    success: (res) => {
      if (res && res.filename) {
        playAudio(res.filename, true, (ok) => { if (onDone) onDone(ok); });
        notify(text, true);
      } else {
        startOnline();
      }
    },
    fail: () => {
      // 插件失败：自动模式转在线；插件模式直接结束
      if (state.engine === 'plugin') { if (onDone) onDone(false); }
      else startOnline();
    },
  });
}

// ---- 整日连读：队列依次朗读，任何手动 speak() 会打断 ----
function speakQueue(texts) {
  stop();
  state.queue = (texts || []).slice();
  state.queueActive = true;
  next();
}

function next() {
  if (!state.queueActive || !state.queue.length) {
    state.queueActive = false;
    notify('', false);
    return;
  }
  const text = state.queue.shift();
  speak(text, () => {
    if (!state.queueActive) return;
    setTimeout(next, 250);
  });
}

// ---- 查询状态 ----
function isPlayingText(text) {
  return !!(state.audio && state.playingText === text);
}

module.exports = {
  initPlugin,
  setRate,
  setEngine,
  speak,
  speakQueue,
  stop,
  togglePause,
  isPlayingText,
  getEngineInfo: () => ({ pluginOk: state.pluginOk, engine: state.engine, rate: state.rate }),
  onStateChange: (fn) => { if (typeof fn === 'function') state.listeners.push(fn); },
};
