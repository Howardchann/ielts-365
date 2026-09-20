// pages/settings/settings.js —— 设置：日期 / 语音 / 云同步
const plan = require('../../utils/data.js');
const store = require('../../utils/store.js');
const speech = require('../../utils/speech.js');

Page({
  data: {
    startDate: '2026-09-21',
    today: '2026-09-19',
    rate: 0.9,
    rateText: '0.90×',
    engine: 'auto',
    engineOptions: [
      { value: 'auto', label: '自动（插件优先，失败转在线）' },
      { value: 'plugin', label: '仅微信同声传译插件' },
      { value: 'online', label: '仅在线朗读（需配域名）' },
    ],
    engineIndex: 0,
    pluginOk: false,
    cloud: { enabled: false, ready: false, hasDoc: false },
    totalChecked: 0,
    starredCount: 0,
    appVersion: '1.0.0',
  },

  onLoad() {
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    this.setData({ today });
    const ok = speech.initPlugin();
    speech.onStateChange((text, playing) => { /* 高亮交给使用页 */ });
    this.setData({ pluginOk: ok });
  },

  onShow() {
    store.onResume();
    this.refresh();
  },

  refresh() {
    const rate = store.get('rate') || 0.9;
    const engine = store.get('engine') || 'auto';
    speech.setRate(rate);
    speech.setEngine(engine);
    this.setData({
      startDate: store.get('startDate') || plan.DEFAULT_START,
      rate,
      rateText: Number(rate).toFixed(2) + '×',
      engine,
      engineIndex: ['auto', 'plugin', 'online'].indexOf(engine),
      pluginOk: speech.getEngineInfo().pluginOk,
      cloud: store.cloudStatus(),
      totalChecked: store.checkedCount(),
      starredCount: (store.get('starredWords') || []).length,
    });
  },

  // ---- 开始日期 ----
  onStartDate(e) {
    store.set('startDate', e.detail.value);
    this.refresh();
    wx.showToast({ title: '开始日期已更新', icon: 'success' });
  },

  // ---- 语速 ----
  onRate(e) {
    const rate = Number(e.detail.value);
    speech.setRate(rate);
    store.set('rate', rate);
    this.setData({ rate, rateText: rate.toFixed(2) + '×' });
  },

  onTestVoice() {
    speech.speak('Hello. Nice to meet you. This is your daily learning voice.');
  },

  // ---- 引擎 ----
  onEngine(e) {
    const idx = Number(e.detail.value);
    const engine = this.data.engineOptions[idx].value;
    store.set('engine', engine);
    speech.setEngine(engine);
    this.setData({ engine, engineIndex: idx });
  },

  // ---- 云同步 ----
  onSyncNow() {
    wx.showLoading({ title: '同步中' });
    store.syncNow().then(res => {
      wx.hideLoading();
      wx.showToast({ title: res.msg, icon: res.ok ? 'success' : 'none', duration: 2000 });
      this.refresh();
    });
  },

  // ---- 关于 ----
  onAbout() {
    wx.showModal({
      title: '关于雅思365',
      content: '零基础雅思全年学习计划：4阶段、52周、364天、1300个核心词汇。语音由微信同声传译插件提供；进度通过云开发在手机与电脑间自动同步。',
      showCancel: false,
    });
  },
});
