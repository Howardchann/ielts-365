// pages/today/today.js —— 今日学习计划
const plan = require('../../utils/data.js');
const store = require('../../utils/store.js');
const speech = require('../../utils/speech.js');

Page({
  data: {
    viewDay: 1,
    todayNum: 0,
    preStart: false,
    daysToStart: 0,
    dayNum: 1,
    dowText: '',
    phaseName: '',
    theme: '',
    weekNum: 0,
    dayData: null,
    vocab: [],
    extraStart: -1,   // 扩展词在 vocab 中的起始下标（-1 表示全是核心词）
    coreCount: 0,
    extraCount: 0,
    checked: false,
    playingText: '',
    playingMode: 'idle',
    pluginOk: false,
  },

  onLoad() {
    const ok = speech.initPlugin();
    speech.setRate(store.get('rate'));
    speech.setAccent(store.get('accent') || 'us');
    speech.setEngine(store.get('engine'));
    speech.setEngineMode(store.get('engineMode') || 'auto');
    this._offSpeech = speech.onStateChange((payload) => {
      this.setData({ playingText: payload.playing ? payload.text : '', playingMode: payload.mode });
    });
    this.setData({ pluginOk: ok });
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ active: 0 });
    store.onResume();
    const jump = getApp().globalData.jumpDay || 0;
    getApp().globalData.jumpDay = 0;
    const todayNum = plan.currentDayFromStart(store.get('startDate'));
    // 默认落点 = 第一个未完成的学习日（打卡驱动）：没学/没学完，第二天仍停在这一天；
    // 全部完成时回退自然日 todayNum。从周表跳转（jump）或手动翻页不受影响。
    let viewDay = jump || store.firstUnfinishedDay() || todayNum || 1;
    if (viewDay < 1) viewDay = 1;
    if (viewDay > plan.TOTAL_DAYS) viewDay = plan.TOTAL_DAYS;
    this.setData({ todayNum, preStart: todayNum === 0, daysToStart: this._daysToStart() });
    this.renderDay(viewDay);
  },

  onUnload() {
    speech.stop();
    if (this._offSpeech) this._offSpeech();
    this._offSpeech = null;
  },

  _daysToStart() {
    const sd = new Date((store.get('startDate') || plan.DEFAULT_START) + 'T00:00:00');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.ceil((sd - today) / 86400000);
  },

  renderDay(day) {
    const info = plan.dayInfo(day);
    const week = plan.WEEKS[info.wIdx];
    const raw = plan.getDay(day);
    // dayData 里剔除词汇数组 v，避免与 vocab 重复 setData 两份（传输量翻倍）
    const dayData = raw ? Object.assign({}, raw) : null;
    if (dayData) delete dayData.v;
    const list = (raw && raw.v ? raw.v : []).map(v => Object.assign({}, v, { starred: store.isStarred(v.w) }));
    const coreCount = dayData ? dayData.coreCount || 0 : 0;
    // 练习任务按 "1) 2) 3)" 编号拆行（数据源里是一整段，无换行符）
    const prLines = dayData && dayData.pr ? String(dayData.pr).split(/(?=\d\)\s)/) : [];
    this.setData({
      viewDay: day,
      dayNum: day,
      dowText: plan.DOW[info.k - 1],
      phaseName: plan.PHASE_NAMES[week.p] || '',
      theme: week.theme,
      weekNum: week.w,
      dayData,
      prLines,
      vocab: list,
      extraStart: coreCount < list.length ? coreCount : -1,
      coreCount: coreCount,
      extraCount: list.length - coreCount,
      checked: store.isChecked(info.wIdx + 1, info.k),
    });
    wx.setNavigationBarTitle({ title: 'Day ' + day + ' · ' + plan.DOW[info.k - 1] });
    // 后台把当天音频预拉进本地缓存（静默，失败不影响播放）
    if (list.length) {
      const items = [];
      list.forEach(v => { items.push({ ai: v.ai, kind: 'w' }); items.push({ ai: v.ai, kind: 's' }); });
      speech.prefetch(items.slice(0, 40));
    }
  },

  prevDay() { if (this.data.viewDay > 1) { speech.stop(); this.renderDay(this.data.viewDay - 1); } },
  nextDay() {
    if (this.data.viewDay < plan.TOTAL_DAYS) { speech.stop(); this.renderDay(this.data.viewDay + 1); }
  },
  backToToday() {
    const t = this.data.todayNum || 1;
    speech.stop();
    this.renderDay(t);
  },

  onCheckin() {
    const info = plan.dayInfo(this.data.viewDay);
    const now = store.toggleCheck(info.wIdx + 1, info.k);
    this.setData({ checked: now });
    if (now) wx.showToast({ title: '打卡成功', icon: 'success' });
  },

  // ---- 朗读 ----
  onSpeakWord(e) {
    const ds = e.currentTarget.dataset;
    const text = ds.text || ds.example || ds.word;
    if (!text) return;
    if (this.data.playingText === text) {
      const r = speech.togglePause();
      this.setData({ playingText: r === 'paused' ? '' : text });
      return;
    }
    speech.speak(text, { ai: Number(ds.ai) || 0, kind: ds.kind || 's' });
  },

  onSpeakAll() {
    if (!this.data.vocab.length) return;
    if (this.data.playingMode === 'queue') { speech.stop(); return; }
    const items = [];
    this.data.vocab.forEach(v => {
      items.push({ text: v.w, ai: v.ai, kind: 'w' });
      if (v.e) items.push({ text: v.e, ai: v.ai, kind: 's' });
    });
    speech.speakQueue(items);
  },

  onStar(e) {
    const i = e.currentTarget.dataset.index;
    const v = this.data.vocab[i];
    if (!v) return;
    const starred = store.toggleStar(v);
    const patch = {};
    patch['vocab[' + i + '].starred'] = starred;
    this.setData(patch);
  },
});
