// pages/weeks/weeks.js —— 学习计划总览（78 周 / 18 个月 / 四阶段）
const plan = require('../../utils/data.js');
const store = require('../../utils/store.js');
const theme = require('../../utils/theme.js');

Page({
  data: {
    // 主题 data 初始化（与 tabBar 同款）：首帧即正确深浅，见 today.js 注释
    dark: theme.isDark(),
    pageStyle: theme.isDark() ? 'background-color:#0E1618;' : '',
    pressed: '',   // 手动按压态：当前按下的磁贴 pk（见 onTileDown）
    phases: [],       // [{p, name, shortName, range, doneCount, totalWeeks, percent, isCurrentPhase, weeks:[...]}]
    todayNum: 0,
    currentWeek: 0,
    daysToStart: 0,       // 准备期横幅（todayNum=0 时显示）
    startDateText: '',
    totalChecked: 0,
    totalDays: plan.TOTAL_DAYS,
    totalPercent: '0.0',  // WXML 的 {{}} 不支持函数调用（如 toFixed），必须在 JS 算好再传入
    openPhase: 0,     // 当前展开的阶段（0=全部折叠）
  },

  applyTheme() { theme.applyPage(this); theme.syncTabBar(this); },
  onLoad() { theme.applyPage(this); theme.syncTabBar(this); },
  onShow() {
    theme.syncTabBar(this, 1);
    this.applyTheme();
    store.onResume();
    // 标题兜底：今日页动态设过「Day N · 周X」后，未设过标题的 tab 页原生标题可能为空
    try { wx.setNavigationBarTitle({ title: '18个月计划总览' }); } catch (e) {}
    // 按压态兜底清零：switchTab 跳转时 touchend 可能不触发，返回后残留按压底色
    if (this.data.pressed) this.setData({ pressed: '' });
    this.refresh();
  },

  refresh() {
    const todayNum = plan.currentDayFromStart(store.get('startDate'));
    const currentWeek = todayNum > 0 ? Math.ceil(todayNum / 7) : 0;
    // 准备期（todayNum=0）：顶部横幅需要开始日期与倒计时天数
    const startDate = store.get('startDate') || plan.DEFAULT_START;
    let daysToStart = 0, startDateText = '';
    if (todayNum === 0) {
      const sd = new Date(startDate + 'T00:00:00');
      const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      daysToStart = Math.max(0, Math.ceil((sd - today) / 86400000));
      startDateText = (sd.getMonth() + 1) + ' 月 ' + sd.getDate() + ' 日';
    }
    // 默认只展开当前周所属阶段，避免一次性渲染 546 个节点
    const currentPhase = currentWeek > 0 ? (plan.WEEKS[currentWeek - 1] || {}).p || 1 : 1;
    const phases = [];
    for (let p = 1; p <= 4; p++) {
      const weeks = plan.WEEKS.filter(w => w.p === p).map(w => {
        const map = store.weekCheckedMap(w.w - 1);
        return {
          w: w.w,
          theme: w.theme,
          perDay: plan.RAMP[w.w - 1],
          weekTotal: plan.RAMP[w.w - 1] * 5,
          checked: store.weekCheckedCount(w.w - 1),
          days: [1, 2, 3, 4, 5, 6, 7].map(k => ({ k: k, done: !!map[k] })),
          isCurrent: w.w === currentWeek,
          isPast: currentWeek > 0 && w.w < currentWeek,
        };
      });
      phases.push({
        p: p,
        name: plan.PHASE_NAMES[p],
        weeks,
        shortName: (plan.PHASE_NAMES[p].split('：')[1]) || plan.PHASE_NAMES[p],
        range: weeks.length ? weeks[0].w + '-' + weeks[weeks.length - 1].w : '',
        doneCount: weeks.filter(w => w.checked >= 7).length,
        totalWeeks: weeks.length,
        percent: weeks.length
          ? Math.round(weeks.reduce((s, w) => s + w.checked, 0) * 100 / (weeks.length * 7))
          : 0,
        isCurrentPhase: weeks.some(w => w.isCurrent),
      });
    }
    const totalChecked = store.checkedCount();
    const totalPercent = totalChecked >= plan.TOTAL_DAYS
      ? '100.0'
      : (totalChecked * 100 / plan.TOTAL_DAYS).toFixed(1);
    // 同值守卫：周表全部状态由 checkedDays 派生，无变化就不再整树 setData（切 tab 闪屏根源）
    const sig = [totalChecked, (store.get('checkedDays') || []).length, todayNum, startDate].join('|');
    if (sig === this._weeksSig) return;
    this._weeksSig = sig;
    this.setData({
      phases,
      todayNum,
      currentWeek,
      daysToStart,
      startDateText,
      totalChecked,
      totalDays: plan.TOTAL_DAYS,
      totalPercent,
      openPhase: this.data.openPhase || currentPhase,
    });
  },

  // 磁贴按压：手动管理（替代原生 hover-class，v1.1.19）。原因有二：
  // ① 原生 hover 会沿节点链激活——点日格连父级周卡一起亮（「整个周磁贴按压反馈」）；
  // ② switchTab 跳转时 hover 清理不可靠，返回周计划后按压底色残留（实机翻车）。
  // touchmove 也清：在磁贴上起手滑动（滚动列表）时不该亮按压态。
  onTileDown(e) {
    const k = e.currentTarget.dataset.pk;
    if (this.data.pressed !== k) this.setData({ pressed: k });
  },
  onTileUp() {
    if (this.data.pressed) this.setData({ pressed: '' });
  },

  // 展开/收起阶段列表
  onPhaseTap(e) {
    const p = Number(e.currentTarget.dataset.p);
    this.setData({ openPhase: this.data.openPhase === p ? 0 : p });
  },

  // 跳转到某一天：today 是 tabBar 页面，必须用 switchTab（旧实现用 navigateTo，必然失败）
  jumpToDay(day) {
    const app = getApp();
    if (app && app.globalData) app.globalData.jumpDay = day;
    wx.switchTab({ url: '/pages/today/today' });
  },

  // 点某周 → 查看该周周一（Day = (w-1)*7+1）
  onWeekTap(e) {
    const w = Number(e.currentTarget.dataset.w);
    this.jumpToDay((w - 1) * 7 + 1);
  },

  // 点某周的某天
  onDayTap(e) {
    const w = Number(e.currentTarget.dataset.w);
    const k = Number(e.currentTarget.dataset.k);
    this.jumpToDay((w - 1) * 7 + k);
  },
});
