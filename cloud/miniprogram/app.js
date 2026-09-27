// app.js —— 本地进度 + 云开发初始化（音频签名 + 进度同步）
const store = require('./utils/store.js');
const cloudCfg = require('./utils/cloud.js');

App({
  globalData: { store: store, jumpDay: 0 },

  onLaunch() {
    // ⚠️ 顺序不能反：store.init() 会立刻发起一次进度同步，走的是 wx.cloud.callFunction，
    //    必须先把云环境初始化好，否则第一次同步必然报「云开发环境未就绪」。
    if (cloudCfg.ENV && wx.cloud) {
      try { wx.cloud.init({ env: cloudCfg.ENV, traceUser: true }); } catch (e) { console.warn('cloud init failed', e); }
    }
    store.init();
    // 系统深浅色切换（跟随系统模式下实时换肤）：通知栈内所有页面重新应用主题
    if (wx.onThemeChange) {
      wx.onThemeChange(() => {
        getCurrentPages().forEach(p => { if (p.applyTheme) p.applyTheme(); });
      });
    }
  },

  // 切回前台：与云端对齐一次（store 内部按 RESUME_GAP 节流，不会每次切页面都请求）
  onShow() { store.onResume(); },

  // 切后台 / 退出：把待推的进度推出去
  onHide() { store.flush(); },
});
