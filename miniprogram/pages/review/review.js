// pages/review/review.js —— 复习：随机抽查 + 重点词
const plan = require('../../utils/data.js');
const store = require('../../utils/store.js');
const speech = require('../../utils/speech.js');

Page({
  data: {
    poolSize: 0,
    dueCount: 0,
    current: null,      // {w, m, p, e, starred}
    showZh: false,
    starred: [],
    playingWord: '',
    tab: 'random',      // random | due | starred
  },

  onLoad() {
    // 监听器返回取消函数，页面卸载时注销（旧实现会永久堆积回调）
    this._offSpeech = speech.onStateChange((payload) => {
      this.setData({ playingWord: payload.playing ? payload.text : '' });
    });
  },

  onUnload() {
    speech.stop();
    if (this._offSpeech) this._offSpeech();
    this._offSpeech = null;
  },

  onShow() {
    store.onResume();
    this._pool = null;
    this.refreshPool();
    this.setData({ starred: store.get('starredWords') || [] });
  },

  refreshPool() {
    if (!this._pool) this._pool = plan.learnedWords(store.get('checkedDays'));
    this.setData({ poolSize: this._pool.length, dueCount: store.dueWords(this._pool).length });
    return this._pool;
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    if (e.currentTarget.dataset.tab === 'due') this.onNextDue();
  },

  onNextDue() {
    const pool = store.dueWords(this.refreshPool());
    if (!pool.length) {
      this.setData({ current: null });
      wx.showToast({ title: '今天没有到期词，继续学习即可', icon: 'none' });
      return;
    }
    const item = pool[Math.floor(Math.random() * pool.length)];
    const current = Object.assign({}, item, { starred: store.isStarred(item.w) });
    this._lastWord = item.w;
    this.setData({ current, showZh: false });
    speech.speak(current.w, { ai: current.ai, kind: 'w' });
  },

  onReviewResult(e) {
    const remembered = e.currentTarget.dataset.result === 'remember';
    const c = this.data.current;
    if (!c) return;
    store.reviewWord(c.w, remembered);
    wx.showToast({ title: remembered ? '记得，下一次会更晚复习' : '记不牢，稍后再来', icon: 'none' });
    this.setData({ current: null, showZh: false });
    if (this.data.tab === 'due') this.onNextDue();
  },

  // 抽一个词：优先重点词（30%），并尽量避开上一次抽到的词
  pickItem(pool, starred, avoidWord) {
    let item = null;
    for (let tries = 0; tries < 4; tries++) {
      if (starred.length && Math.random() < 0.3) {
        item = starred[Math.floor(Math.random() * starred.length)];
      } else {
        item = pool[Math.floor(Math.random() * pool.length)];
      }
      if (!avoidWord || item.w !== avoidWord || pool.length < 2) break;
    }
    return item;
  },

  // ---- 随机复习 ----
  onNext() {
    const pool = this.refreshPool();
    if (!pool.length) {
      this.setData({ current: null });
      wx.showToast({ title: '先去打卡几天，词汇池才有内容', icon: 'none' });
      return;
    }
    const starred = store.get('starredWords') || [];
    const item = this.pickItem(pool, starred, this._lastWord);
    this._lastWord = item.w;
    // 重点词池里的对象是副本，没有 starred 字段 —— 必须按单词实际状态回填，否则已收藏的词永远显示"未收藏"
    const current = Object.assign({}, item, { starred: store.isStarred(item.w) });
    this.setData({ current, showZh: false });
    speech.speak(current.w, { ai: current.ai, kind: 'w' });
  },

  onShowZh() { this.setData({ showZh: true }); },

  onSpeakCurrent() {
    const c = this.data.current;
    if (!c) return;
    if (this.data.playingWord === c.w) {
      const r = speech.togglePause();
      this.setData({ playingWord: r === 'paused' ? '' : c.w });
      return;
    }
    speech.speak(c.w, { ai: c.ai, kind: 'w' });
    this.setData({ playingWord: c.w });
  },

  onSpeakExample() {
    const c = this.data.current;
    if (!c || !c.e) return;
    speech.speak(c.e, { ai: c.ai, kind: 's' });
  },

  onStarCurrent() {
    const c = this.data.current;
    if (!c) return;
    const starred = store.toggleStar(c);
    this.setData({
      starred: store.get('starredWords') || [],
      'current.starred': starred,
    });
  },

  // ---- 重点词列表 ----
  onSpeakStarred(e) {
    const w = e.currentTarget.dataset.word;
    if (this.data.playingWord === w) {
      const r = speech.togglePause();
      this.setData({ playingWord: r === 'paused' ? '' : w });
      return;
    }
    // 重点词列表只传了单词文本，需从收藏数组里取回音频编号
    const it = (this.data.starred || []).filter(x => x && x.w === w)[0];
    speech.speak(w, { ai: it && it.ai, kind: 'w' });
    this.setData({ playingWord: w });
  },

  onRemoveStarred(e) {
    const i = e.currentTarget.dataset.index;
    const starred = store.get('starredWords') || [];
    if (i >= 0 && i < starred.length) {
      store.toggleStar(starred[i]);
      this.setData({ starred: store.get('starredWords') || [] });
      wx.showToast({ title: '已移除', icon: 'none' });
    }
  },
});
