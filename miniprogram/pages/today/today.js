// pages/today/today.js —— 今日学习计划
const plan = require('../../utils/data.js');
const store = require('../../utils/store.js');
const theme = require('../../utils/theme.js');
const speech = require('../../utils/speech.js');

Page({
  data: {
    // 主题在 data 初始化阶段就确定（与 tabBar v1.1.7 同款）：首帧即正确深浅，
    // onLoad 的 setData 实测晚 1-3 帧才上屏（09-26 录屏 f103/116/128 白光根因）
    dark: theme.isDark(),
    pageStyle: theme.isDark() ? 'background-color:#0E1618;' : '',
    // 自定义导航栏（v1.1.33）：标题走 data 绑定 <nav-bar title>，不再调 setNavigationBarTitle；
    // navCustom=true 让 theme.js 手动模式跳过 setNavigationBarColor（栏色由 CSS 变量管）
    navCustom: true,
    navTitle: '今日计划',
    // ⚠️ 必须初始化为 0（falsy）：首次 onShow 才会走「默认落点」分支（准备期倒计时卡/
    // 第一个未完成日）。若是 1，冷启动直接命中「保持浏览位置」分支，准备期用户永远
    // 看到 Day 1——09-26 用户实测清除记录/改日期后仍显示 Day 1 的根因之一
    viewDay: 0,
    totalDays: plan.TOTAL_DAYS,
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
    // 同值守卫：data 已初始化为主题值，此处通常 0 次 setData
    theme.applyPage(this); theme.syncTabBar(this);
    const ok = speech.initPlugin();
    speech.setRate(store.get('rate'));
    speech.setAccent(store.get('accent') || 'us');
    speech.setEngine(store.get('engine'));
    speech.setEngineMode(store.get('engineMode') || 'auto');
    this._offSpeech = speech.onStateChange((payload) => {
      const upd = { playingText: payload.playing ? payload.text : '', playingMode: payload.mode };
      // 歌词式进度：按朗读进度把当前文本切成「已读/未读」两段，已读染绿
      if (payload.playing && payload.text) {
        const lit = Math.round((payload.progress || 0) * payload.text.length);
        upd.karaLit = payload.text.slice(0, lit);
        upd.karaRest = payload.text.slice(lit);
      } else { upd.karaLit = ''; upd.karaRest = ''; }
      this.setData(upd);
    });
    this.setData({ pluginOk: ok });
  },

  applyTheme() { theme.applyPage(this); theme.syncTabBar(this); },
  onShow() {
    theme.syncTabBar(this, 0);
    this.applyTheme();
    store.onResume();
    const jump = getApp().globalData.jumpDay || 0;
    getApp().globalData.jumpDay = 0;
    const todayNum = plan.currentDayFromStart(store.get('startDate'));
    // 切 tab 返回（无 jump 且页面未销毁）：保持离开时的浏览位置与准备期预览态，仅刷新打卡/同步数据。
    // 重新冷启动小程序才回到默认落点（第一个未完成日 / 准备期卡片）。
    if (!jump && this.data.viewDay) {
      // 同值守卫：todayNum/daysToStart 多数时候没变，裸 setData 会整树重渲染（切 tab 闪屏）
      theme.sameSet(this, { todayNum, daysToStart: this._daysToStart() });
      this.renderDay(this.data.viewDay);
      return;
    }
    // 默认落点 = 第一个未完成的学习日（打卡驱动）：没学/没学完，第二天仍停在这一天；
    // 全部完成时回退自然日 todayNum。从周表跳转（jump）或手动翻页不受影响。
    const preStart = todayNum === 0 && !jump;
    theme.sameSet(this, { todayNum, preStart, daysToStart: this._daysToStart() });
    // 准备期不渲染日内容：renderDay 会把标题改成「Day N · 周X」，
    // 准备期标题应保持「今日计划」；日数据由「先看看 Day 1」入口按需渲染
    if (preStart) { this._setTitle(null); return; }
    let viewDay = jump || store.firstUnfinishedDay() || todayNum || 1;
    if (viewDay < 1) viewDay = 1;
    if (viewDay > plan.TOTAL_DAYS) viewDay = plan.TOTAL_DAYS;
    this.renderDay(viewDay);
  },

  onUnload() {
    speech.stop();
    if (this._offSpeech) this._offSpeech();
    this._offSpeech = null;
  },

  // 导航标题统一出口（v1.1.33 起为自定义导航栏）：day=null → 「今日计划」（准备期）；
  // 否则「Day N · 周X」。标题是 data 字段，经 sameSet 同值守卫绑定到 <nav-bar>，
  // 换 tab 不会串（旧「原生标题为空」防御只对仍在用原生栏的 weeks/review 有意义）。
  _setTitle(day) {
    const t = day ? 'Day ' + day + ' · ' + plan.DOW[plan.dayInfo(day).k - 1] : '今日计划';
    theme.sameSet(this, { navTitle: t });
  },

  _daysToStart() {
    const sd = new Date((store.get('startDate') || plan.DEFAULT_START) + 'T00:00:00');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(0, Math.ceil((sd - today) / 86400000));
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
    const prLines = dayData && dayData.pr ? String(dayData.pr).split(/(?=\d\)\s)/).map(s => { const m = s.match(/^(\d+)\)\s*/); return { no: m ? m[1] : '', text: m ? s.slice(m[0].length) : s }; }) : [];
    // 同日同状态（打卡/收藏位未变）直接跳过整页 setData：
    // 微信 setData 不做深度 diff，同值也会整树重渲染 —— 这就是切 tab 回页「闪一下像重新渲染」的根源
    const sig = [day, store.isChecked(info.wIdx + 1, info.k) ? 1 : 0, list.map(v => v.starred ? 1 : 0).join('')].join('|');
    if (sig === this._daySig) {
      this._setTitle(day);
      return;
    }
    this._daySig = sig;
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
    this._setTitle(day);
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
    // 准备期（preStart）点「先看看 Day 1」：必须退出准备期卡片，否则 renderDay 渲染了也被 wx:if 盖住
    this.setData({ preStart: false });
    this.renderDay(t);
  },

  resetView() {
    // 清除记录/改开始日期后由设置页调用：丢弃浏览位置，下次 onShow 走默认落点
    // （startDate 已重置为下一个周一 → todayNum=0 → 自动进准备期倒计时卡片）
    this._daySig = null;
    this.setData({ viewDay: 0 });
  },

  backToPrep() {
    // 准备期浏览某天后返回倒计时卡（todayNum=0 时今日页顶部「回到准备期」入口）
    speech.stop();
    this._daySig = null;
    this.setData({ preStart: true, viewDay: 0 });
    this._setTitle(null); // 标题同步回「今日计划」，否则残留「Day N · 周X」
  },

  fb() { return this.selectComponent('#fb'); },

  onCheckin() {
    // 准备期只预览不打卡：打卡会把「还没开学的日子」记成已完成，进度与云同步全乱
    if (this.data.todayNum === 0) { this.fb().toast('开学后才能打卡', 1200); return; }
    const info = plan.dayInfo(this.data.viewDay);
    const now = store.toggleCheck(info.wIdx + 1, info.k);
    this.setData({ checked: now });
    // 反馈统一走 feedback 组件白卡轻提示（原生黑块已废除）
    if (now) this.fb().toast('打卡成功', 900);
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
