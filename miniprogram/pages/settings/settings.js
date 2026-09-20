// pages/settings/settings.js —— 设置：日期 / 语音 / 口音 / 云同步
const plan = require('../../utils/data.js');
const store = require('../../utils/store.js');
const speech = require('../../utils/speech.js');

const ENGINES = ['auto', 'plugin', 'online'];
const ACCENTS = ['us', 'uk'];

Page({
  data: {
    startDate: plan.DEFAULT_START,
    today: '2026-09-19',
    rate: 0.9,
    rateText: '0.90×',
    engine: 'online',
    engineOptions: [
      { value: 'auto', label: '自动（插件优先，失败转在线）' },
      { value: 'plugin', label: '仅微信同声传译插件' },
      { value: 'online', label: '仅在线朗读（需配域名）' },
    ],
    engineIndex: 0,
    accent: 'us',
    accentOptions: [
      { value: 'us', label: '美式发音（默认）' },
      { value: 'uk', label: '英式发音' },
    ],
    accentIndex: 0,
    pluginOk: false,
    cloud: { enabled: false, ready: false, hasDoc: false, error: '' },
    totalChecked: 0,
    starredCount: 0,
    appVersion: '1.0.0',
    // 备份 / 恢复
    backupText: '',
    showBackup: false,
    importText: '',
    showImport: false,
  },

  onLoad() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    this.setData({ today: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) });
    this.setData({ pluginOk: speech.initPlugin() });   // 不再注册空监听器
  },

  onShow() {
    store.onResume();
    this.refresh();
  },

  refresh() {
    const rate = store.get('rate') || 0.9;
    const engine = store.get('engine') || 'auto';
    const accent = store.get('accent') || 'us';
    speech.setRate(rate);
    speech.setEngine(engine);
    speech.setAccent(accent);
    this.setData({
      startDate: store.get('startDate') || plan.DEFAULT_START,
      rate,
      rateText: Number(rate).toFixed(2) + '×',
      engine,
      engineIndex: ENGINES.indexOf(engine),
      accent,
      accentIndex: ACCENTS.indexOf(accent),
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

  // ---- 发音口音（在线朗读通道生效）----
  onAccent(e) {
    const idx = Number(e.detail.value);
    const accent = this.data.accentOptions[idx].value;
    store.set('accent', accent);
    speech.setAccent(accent);
    this.setData({ accent, accentIndex: idx });
  },

  // ---- 云同步 ----
  onSyncNow() {
    wx.showLoading({ title: '同步中' });
    store.syncNow().then(res => {
      wx.hideLoading();
      wx.showToast({ title: res.msg, icon: res.ok ? 'success' : 'none', duration: 2500 });
      this.refresh();
    });
  },

  // ---- 进度备份 / 恢复（不依赖云开发）----
  onExport() {
    let text;
    try { text = store.exportBackup(); }
    catch (e) {
      wx.showToast({ title: '导出失败', icon: 'none' });
      return;
    }
    this.setData({ backupText: text, showBackup: true, showImport: false, importText: '' });
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制，请粘贴到备忘录保存', icon: 'none', duration: 2500 }),
      fail: () => wx.showToast({ title: '复制失败，请长按选中文本手动复制', icon: 'none', duration: 2500 }),
    });
  },

  onCopyBackup() {
    wx.setClipboardData({
      data: this.data.backupText,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    });
  },

  onHideBackup() { this.setData({ showBackup: false }); },

  onShowImport() { this.setData({ showImport: true, showBackup: false, importText: '' }); },
  onHideImport() { this.setData({ showImport: false, importText: '' }); },
  onImportInput(e) { this.setData({ importText: e.detail.value }); },

  // mode: merge 取并集（推荐）| replace 以备份为准
  doImport(mode) {
    const text = (this.data.importText || '').trim();
    if (!text) {
      wx.showToast({ title: '请先粘贴备份内容', icon: 'none' });
      return;
    }
    let r;
    try { r = store.importBackup(text, mode); }
    catch (e) {
      wx.showModal({ title: '导入失败', content: e.message || String(e), showCancel: false });
      return;
    }
    this.setData({ showImport: false, importText: '' });
    this.refresh();
    const head = mode === 'merge' ? '合并完成' : '覆盖完成';
    const detail = mode === 'merge'
      ? ('新增 ' + r.addedDays + ' 天打卡、' + r.addedWords + ' 个重点词\n合并后共 ' + r.totalDays + ' 天、' + r.totalWords + ' 个重点词')
      : ('已替换为备份中的 ' + r.totalDays + ' 天打卡、' + r.totalWords + ' 个重点词');
    wx.showModal({ title: head, content: detail, showCancel: false });
  },
  onImportMerge() { this.doImport('merge'); },
  onImportReplace() { this.doImport('replace'); },

  // ---- 关于 ----
  onAbout() {
    wx.showModal({
      title: '关于雅思365',
      content: '零基础雅思全年学习计划：4阶段、52周、364天、1300个核心词汇。语音使用有道在线朗读；进度可在「进度备份」里导出保存，防止换机丢失。',
      showCancel: false,
    });
  },
});
