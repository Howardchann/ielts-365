// pages/review/review.js —— 复习：随机抽查 + 重点词
const plan = require('../../utils/data.js');
const store = require('../../utils/store.js');
const speech = require('../../utils/speech.js');

Page({
  data: {
    // 随机复习
    poolSize: 0,
    current: null,      // {w, m, p, e}
    showZh: false,
    // 重点词
    starred: [],
    playingWord: '',
    tab: 'random',      // random | starred
  },

  onLoad() {
    // 朗读状态回调：结束后清掉高亮
    speech.onStateChange((text, playing) => {
      this.setData({ playingWord: playing ? text : '' });
    });
  },

  onShow() {
    store.onResume();
    this.refreshPool();
    this.setData({ starred: store.get('starredWords') || [] });
  },

  refreshPool() {
    this.pool = plan.learnedWords(store.get('checkedDays'));
    this.setData({ poolSize: this.pool.length });
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  // ---- 随机复习 ----
  onNext() {
    this.refreshPool();
    if (!this.pool.length) {
      this.setData({ current: null });
      wx.showToast({ title: '先去打卡几天，词汇池才有内容', icon: 'none' });
      return;
    }
    // 优先抽重点词（30% 概率），否则从已学词汇随机
    let item = null;
    const starred = store.get('starredWords') || [];
    if (starred.length && Math.random() < 0.3) {
      item = starred[Math.floor(Math.random() * starred.length)];
    } else {
      item = this.pool[Math.floor(Math.random() * this.pool.length)];
    }
    this.setData({ current: item, showZh: false });
    speech.speak(item.w);
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
    speech.speak(c.w);
    this.setData({ playingWord: c.w });
  },

  onSpeakExample() {
    const c = this.data.current;
    if (!c || !c.e) return;
    speech.speak(c.e);
  },

  onStarCurrent() {
    const c = this.data.current;
    if (!c) return;
    const starred = store.toggleStar(c);
    this.setData({ starred: store.get('starredWords') || [], 'current.starred': starred });
  },

  // ---- 重点词列表 ----
  onSpeakStarred(e) {
    const w = e.currentTarget.dataset.word;
    if (this.data.playingWord === w) {
      const r = speech.togglePause();
      this.setData({ playingWord: r === 'paused' ? '' : w });
      return;
    }
    speech.speak(w);
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
