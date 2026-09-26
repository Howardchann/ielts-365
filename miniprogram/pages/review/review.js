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
    poolSize: 0,
    dueCount: 0,
    current: null,      // {w, m, p, e, starred}
    showZh: false,
    starred: [],
    playingWord: '',
    tab: 'random',      // random | due | starred
  },

  onLoad() {
    // 同值守卫：data 已初始化为主题值，此处通常 0 次 setData
    theme.applyPage(this); theme.syncTabBar(this);
    // 监听器返回取消函数，页面卸载时注销（旧实现会永久堆积回调）
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
  onShow() {
    theme.syncTabBar(this, 2);
    this.applyTheme();
    store.onResume();
    this._pool = null;
    this.refreshPool();
    // 收藏列表同值守卫（新数组实例同值也会触发重渲染）
    const starred = store.get('starredWords') || [];
    const sj = JSON.stringify(starred);
    if (sj !== this._starredJson) { this._starredJson = sj; this.setData({ starred }); }
  },

  refreshPool() {
    if (!this._pool) this._pool = plan.learnedWords(store.get('checkedDays'));
    // 同值不 setData（setData 无 diff，同值也整树重渲染 → 切 tab 闪屏）
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
    // 长文字 toast 在快速连按时反复弹出，像整个模块在闪 —— 改短文案+短时长
    this.fb().toast(remembered ? '已记住' : '稍后再来', 800);
    // 到期 tab：先算好下一词、一次 setData 直接切换。
    // 旧写法先 setData({current:null}) 再 onNextDue()，中间会渲染一帧
    // 「目前没有到期复习词」空状态 —— 连按闪现整个模块的真凶就是它。
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
    // 真正没有下一词（到期答完 / 随机 tab）才显示空状态卡片
    this.setData({ current: null, showZh: false });
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
      this.fb().toast('先去打卡几天，词汇池才有内容');
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
      this.fb().toast('已移除');
    }
  },
});
