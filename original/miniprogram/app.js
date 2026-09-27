// app.js —— 本地进度版 + 云开发初始化
const store = require('./utils/store.js');
const cloudCfg = require('./utils/cloud.js');

App({
  globalData: { store: store, jumpDay: 0 },
  onLaunch() {
    store.init();
    // 配好 utils/cloud.js 里的 ENV 后，云存储预生成音频自动启用
    if (cloudCfg.ENV && wx.cloud) {
      try { wx.cloud.init({ env: cloudCfg.ENV, traceUser: true }); } catch (e) { console.warn('cloud init failed', e); }
    }
  },
});
