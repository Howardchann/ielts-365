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
    vocab: [],
    checked: false,
    playingText: '',   // 正在朗读的文本
    playingMode: 'idle', // idle | single | queue
    pluginOk: false,
  },

  onLoad() {
    const ok = speech.initPlugin();
    speech.setRate(store.get('rate'));
    speech.setAccent(store.get('accent') || 'us');
    speech.setEngine(store.get('engine'));
    // 监听器只注册一次，并在页面卸载时注销（旧实现每次调用朗读全部都会多挂一个回调）
    this._offSpeech = speech.onStateChange((payload) => {
      this.setData({
        playingText: payload.playing ? payload.text : '',
        playingMode: payload.mode,
      });
    });
    this.setData({ pluginOk: ok });
  },

  onShow() {
    store.onResume(); // 双端同步：切回前台拉云端
    // 支持从周计划页跳转（switchTab 不支持 query，改由 globalData 传递）
    const jump = getApp().globalData.jumpDay || 0;
    getApp().globalData.jumpDay = 0;
    const todayNum = plan.currentDayFromStart(store.get('startDate'));
    let viewDay = jump || todayNum || 1;
    if (viewDay < 1) viewDay = 1;
    if (viewDay > plan.TOTAL_DAYS) viewDay = plan.TOTAL_DAYS;
    this.setData({ todayNum, preStart: todayNum === 0, daysToStart: this._daysToStart() });
    this.renderDay(viewDay);
  },

  onUnload() {
    speech.stop();                 // 离开页面停止朗读
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
    const vocab = (raw && raw.v ? raw.v : []).map(v => Object.assign({}, v, { starred: store.isStarred(v.w) }));
    this.setData({
      viewDay: day,
      dayNum: day,
      dowText: plan.DOW[info.k - 1],
      phaseName: plan.PHASE_NAMES[week.p] || '',
      theme: week.theme,
      weekNum: week.w,
      dayData,
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
    const text = e.currentTarget.dataset.example || e.currentTarget.dataset.word;
    if (!text) return;
    if (this.data.playingText === text) {
      const r = speech.togglePause();
      this.setData({ playingText: r === 'paused' ? '' : text });
      return;
    }
    speech.speak(text);   // 引擎内部会打断整日连读，状态由监听器回传
  },

  onSpeakAll() {
    if (!this.data.vocab.length) return;
    if (this.data.playingMode === 'queue') { speech.stop(); return; }
    const texts = [];
    this.data.vocab.forEach(v => { texts.push(v.w); texts.push(v.e); });
    speech.speakQueue(texts);
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
