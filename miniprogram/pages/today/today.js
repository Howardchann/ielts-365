// pages/today/today.js —— 今日学习计划
const plan = require('../../utils/data.js');
const store = require('../../utils/store.js');
const speech = require('../../utils/speech.js');

Page({
  data: {
    viewDay: 1,        // 当前查看的计划第几天（1-364）
    todayNum: 0,       // 今天对应的计划天数（0=尚未开始）
    preStart: false,   // 准备期
    daysToStart: 0,
    dayNum: 1,
    dowText: '',
    phaseName: '',
    theme: '',
    weekNum: 0,
    dayData: null,
    checked: false,
    playingWord: '',   // 正在朗读的文本
    pluginOk: false,
  },

  onLoad(options) {
    // 语音初始化（同声传译插件）
    const ok = speech.initPlugin();
    this.setData({ pluginOk: ok });
    speech.setRate(store.get('rate'));
    speech.setEngine(store.get('engine'));
    speech.onStateChange((text, playing) => {
      this.setData({ playingWord: playing ? text : '' });
    });
    // 支持从周计划页跳转：?day=N
    if (options && options.day) this._jumpDay = parseInt(options.day, 10);
  },

  onShow() {
    store.onResume(); // 双端同步：切回前台拉云端
    const todayNum = plan.currentDayFromStart(store.get('startDate'));
    let viewDay = this._jumpDay || todayNum || 1;
    this._jumpDay = null;
    if (viewDay < 1) viewDay = 1;
    if (viewDay > plan.TOTAL_DAYS) viewDay = plan.TOTAL_DAYS;
    this.setData({ todayNum, preStart: todayNum === 0, daysToStart: this._daysToStart() });
    this.renderDay(viewDay);
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
    const d = plan.getDay(day);
    // 词汇加星标状态
    let vocab = [];
    if (d && d.v) {
      vocab = d.v.map(v => Object.assign({}, v, { starred: store.isStarred(v.w) }));
    }
    this.setData({
      viewDay: day,
      dayNum: day,
      dowText: plan.DOW[info.k - 1],
      phaseName: plan.PHASE_NAMES[week.p] || '',
      theme: week.theme,
      weekNum: week.w,
      dayData: d,
      vocab,
      checked: store.isChecked(info.wIdx + 1, info.k),
    });
    wx.setNavigationBarTitle({ title: 'Day ' + day + ' · ' + plan.DOW[info.k - 1] });
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
    const word = e.currentTarget.dataset.word;
    const example = e.currentTarget.dataset.example;
    const text = example || word;
    if (this.data.playingWord === text) {
      // 正在播这条 → 暂停/恢复
      const r = speech.togglePause();
      this.setData({ playingWord: r === 'paused' ? '' : text });
      return;
    }
    speech.speak(text);
  },

  onSpeakAll() {
    const d = this.data.dayData;
    if (!d || !d.v) return;
    if (this.data.playingWord === '__all__') { speech.stop(); this.setData({ playingWord: '' }); return; }
    const texts = [];
    d.v.forEach(v => { texts.push(v.w); texts.push(v.e); });
    this.setData({ playingWord: '__all__' });
    speech.speakQueue(texts);
    // 连读结束后复位按钮
    speech.onStateChange((text, playing) => {
      if (!playing && this.data.playingWord === '__all__') this.setData({ playingWord: '' });
    });
  },

  onStopSpeak() { speech.stop(); this.setData({ playingWord: '' }); },

  onStar(e) {
    const i = e.currentTarget.dataset.index;
    const v = this.data.vocab[i];
    if (!v) return;
    const starred = store.toggleStar(v);
    const key = 'vocab[' + i + '].starred';
    const patch = {};
    patch[key] = starred;
    this.setData(patch);
  },
});
