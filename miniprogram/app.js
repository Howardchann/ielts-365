// app.js：云开发初始化 + 全局进度管理
const store = require('./utils/store.js');

App({
  globalData: {
    // 同步后回调通知各页面刷新
    store: store,
  },

  onLaunch() {
    // 云开发初始化：环境 ID 需替换为你自己的（首次开通后可在云开发控制台查看）
    if (!wx.cloud) {
      console.error('基础库版本过低，无法使用云开发');
    } else {
      wx.cloud.init({
        // env 留空则使用默认环境；建议填你的环境 ID，如 'ielts-xxxx'
        env: undefined,
        traceUser: true,
      });
    }
    // 启动时：加载本地进度 → 拉取云端进度（多端同步的关键一步）
    store.init();
  },
});
