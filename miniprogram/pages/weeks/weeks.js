// pages/weeks/weeks.js —— 学习计划总览（78 周 / 18 个月 / 四阶段）
const plan = require('../../utils/data.js');
const store = require('../../utils/store.js');
const theme = require('../../utils/theme.js');

Page({
  data: {
    phases: [],       // [{p, name, shortName, range, doneCount, totalWeeks, percent, isCurrentPhase, weeks:[...]}]
    todayNum: 0,
    currentWeek: 0,
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
    this.refresh();
  },

  refresh() {
    const todayNum = plan.currentDayFromStart(store.get('startDate'));
    const currentWeek = todayNum > 0 ? Math.ceil(todayNum / 7) : 0;
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
    const sig = [totalChecked, (store.get('checkedDays') || []).length, todayNum].join('|');
    if (sig === this._weeksSig) return;
    this._weeksSig = sig;
    this.setData({
      phases,
      todayNum,
      currentWeek,
      totalChecked,
      totalDays: plan.TOTAL_DAYS,
      totalPercent,
      openPhase: this.data.openPhase || currentPhase,
    });
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
