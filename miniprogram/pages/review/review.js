// pages/review/review.js —— 复习：随机抽查 + 重点词
const plan = require('../../utils/data.js');
const store = require('../../utils/store.js');
const theme = require('../../utils/theme.js');
const speech = require('../../utils/speech.js');

Page({
  data: {
    // 主题 data 初始化（与 tabBar 同款）：首帧即正确深浅，见 today.js 注释
    dark: theme.isDark(),
    pageStyle: theme.isDark() ? 'background-color:#0E1618;' : '',
    // 自定义导航栏（v1.1.34）：标题走 data 绑定 <nav-bar title>
    navTitle: '复习巩固',
    poolSize: 0,
    dueCount: 0,
    current: null,
    showZh: false,
    starred: [],
    playingWord: '',
    tab: 'random',
  },

  onLoad() {
    theme.applyPage(this); theme.syncTabBar(this);
    this._offSpeech = speech.onStateChange((payload) => {
      const upd = { playingWord: payload.playing ? payload.text : '' };
      if (payload.playing && payload.text) {
        const lit = Math.round((payload.progress || 0) * payload.text.length);
        upd.karaLit = payload.text.slice(0, lit);
        upd.karaRest = payload.text.slice(lit);
      } else { upd.karaLit = ''; upd.karaRest = ''; }
      this.setData(upd);
    });
  },

  onUnload() {
    speech.stop();
    if (this._offSpeech) this._offSpeech();
    this._offSpeech = null;
  },

  applyTheme() { theme.applyPage(this); theme.syncTabBar(this); },
  onHide() {
    if (!this.data.veil) this.setData({ veil: true });
  },

  onShow() {
    const app = getApp();
    // Transition bridge writes the target before switchTab. Consume it before
    // touching the visible page so the first restored frame is the final tab.
    let flag = null;
    try {
      flag = wx.getStorageSync('__reviewDeepLinkTab') || null;
      if (flag) wx.removeStorageSync('__reviewDeepLinkTab');
    } catch (e) {}
    if (!flag && app && app.globalData) flag = app.globalData.reviewTab || null;
    if (app && app.globalData && app.globalData.reviewTab) app.globalData.reviewTab = null;

    if (flag && flag !== this.data.tab) {
      this.setData({ tab: flag, veil: false });
      if (flag === 'due') this.onNextDue();
    } else if (this.data.veil) {
      this.setData({ veil: false });
    }

    if (app && app.globalData) app.globalData._reviewPage = this;
    theme.syncTabBar(this, 2);
    this.applyTheme();
    store.onResume();
    this._pool = null;
    this.refreshPool();
    const starred = store.get('starredWords') || [];
    const sj = JSON.stringify(starred);
    if (sj !== this._starredJson) { this._starredJson = sj; this.setData({ starred }); }
  },

  refreshPool() {
    if (!this._pool) this._pool = plan.learnedWords(store.get('checkedDays'));
    const p = this._pool.length, d = store.dueWords(this._pool).length;
    if (p !== this.data.poolSize || d !== this.data.dueCount) this.setData({ poolSize: p, dueCount: d });
    return this._pool;
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    if (e.currentTarget.dataset.tab === 'due') this.onNextDue();
  },

  fb() { return this.selectComponent('#fb'); },

  onNextDue() {
    const pool = store.dueWords(this.refreshPool());
    if (!pool.length) {
      this.setData({ current: null });
      this.fb().toast('今天没有到期词，继续学习即可');
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
    this.fb().toast(remembered ? '已记住' : '稍后再来', 800);
    if (this.data.tab === 'due') {
      const pool = store.dueWords(this.refreshPool());
      if (pool.length) {
        const item = pool[Math.floor(Math.random() * pool.length)];
        const next = Object.assign({}, item, { starred: store.isStarred(item.w) });
        this._lastWord = item.w;
        this.setData({ current: next, showZh: false });
        speech.speak(next.w, { ai: next.ai, kind: 'w' });
        return;
      }
    }
    this.setData({ current: null, showZh: false });
  },

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

  onNext() {
    const pool = this.refreshPool();
    if (!pool.length) {
      this.setData({ current: null });
      this.fb().toast('先去打卡几天，词汇池才有内容');
      return;
    }
    const starred = store.get('starredWords') || [];
    const item = this.pickItem(pool, starred, this._lastWord);
    this._lastWord = item.w;
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

  onSpeakStarred(e) {
    const w = e.currentTarget.dataset.word;
    if (this.data.playingWord === w) {
      const r = speech.togglePause();
      this.setData({ playingWord: r === 'paused' ? '' : w });
      return;
    }
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
      this.fb().toast('已移除');
    }
  },
});
