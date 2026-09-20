// pages/weeks/weeks.js —— 52 周计划总览（四阶段）
const plan = require('../../utils/data.js');
const store = require('../../utils/store.js');

Page({
  data: {
    phases: [],       // [{name, weeks:[{w, theme, checked, today, isCurrent}]}]
    todayNum: 0,
    currentWeek: 0,
    totalChecked: 0,
    totalDays: 364,
  },

  onShow() {
    store.onResume();
    this.refresh();
  },

  refresh() {
    const todayNum = plan.currentDayFromStart(store.get('startDate'));
    const currentWeek = todayNum > 0 ? Math.ceil(todayNum / 7) : 0;
    const phases = [];
    for (let p = 1; p <= 4; p++) {
      const weeks = plan.WEEKS.filter(w => w.p === p).map(w => ({
        w: w.w,
        theme: w.theme,
        checked: store.weekCheckedCount(w.w - 1),
        isCurrent: w.w === currentWeek,
        isPast: currentWeek > 0 && w.w < currentWeek,
      }));
      phases.push({ name: plan.PHASE_NAMES[p], weeks });
    }
    this.setData({
      phases,
      todayNum,
      currentWeek,
      totalChecked: store.checkedCount(),
    });
  },

  // 点某周 → 查看该周周一（Day = (w-1)*7+1）
  onWeekTap(e) {
    const w = e.currentTarget.dataset.w;
    const day = (w - 1) * 7 + 1;
    wx.navigateTo({ url: '/pages/today/today?day=' + day });
  },

  // 点某周的某天
  onDayTap(e) {
    const w = e.currentTarget.dataset.w;
    const k = e.currentTarget.dataset.k;
    const day = (w - 1) * 7 + k;
    wx.navigateTo({ url: '/pages/today/today?day=' + day });
  },
});
