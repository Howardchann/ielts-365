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
    // 按压态兜底清零放最前：万一 DOM 随旧帧带回 tint，这里的清除渲染越早发出闪现越短
    if (this.data.pressed) this.setData({ pressed: '' });
    theme.syncTabBar(this, 1);
    this.applyTheme();
    store.onResume();
    // 标题兜底：今日页动态设过「Day N · 周X」后，未设过标题的 tab 页原生标题可能为空
    try { wx.setNavigationBarTitle({ title: '18个月计划总览' }); } catch (e) {}
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
  // v1.1.21 补（真机仍残留的根因）：
  // ④ touchend 的清除 setData 可能来不及在页面隐藏前刷到渲染层，回来时 webview 恢复旧 DOM
  //    （数据已清、DOM 还带 tint）→ onShow 兜底清除异步生效 = 「先看到残留再弹起」的竞态。
  //    修 = 跳转前同步清 pressed + 延迟 100ms 再 switchTab（保证清除渲染先落），onHide 再兜底一次。
  // v1.1.22 收口（用户定稿）：周卡整块退化为纯展示、不再跳转——日格已覆盖一周每一天，
  //    整卡跳转多余。这同时让冒泡覆盖（③：子级 touch 冒泡把 pressed 覆盖成父级 pk）从
  //    结构上根除：周卡不再绑 touch handler，日格恢复 bindtouch*（v1.1.21 曾改 catchtouch*
  //    断冒泡，但 catch 会吞掉派生的 tap——日格点不动，已回退）。现仅阶段磁贴+日格有按压态。
  onTileDown(e) {
    const k = e.currentTarget.dataset.pk;
    if (this.data.pressed !== k) this.setData({ pressed: k });
  },
  onTileUp() {
    if (this.data.pressed) this.setData({ pressed: '' });
  },
  // —— 日格「按压-确认」模式（v1.1.24 引入，v1.1.25 简化）——
  // 按住亮按压色、松手才跳转；touchend 不灭灯（与阶段磁贴的松手即灭分开）——tint 一直保持
  // 到 jumpToDay 主动清掉（tap→清→100ms 后切页），观感=「按住保持、松手跳转」且切页前
  // DOM 已清干净、返回无残留闪现。
  // v1.1.25 移除「移动=取消」（用户裁定：触屏上从磁贴起手滑动=滚动列表意图，不是取消操作，
  // 那是桌面逻辑）：touchmove 仅灭灯（滚动不拖着亮块走）；小幅移动后松手仍是一次正常 tap
  // （微信自身有位移判定），照常跳转；大幅滑动则 tap 不派发，由 onChipEnd 的 350ms 兜底灭灯。
  onChipDown(e) {
    const k = e.currentTarget.dataset.pk;
    if (this.data.pressed !== k) this.setData({ pressed: k });
  },
  onChipMove() {
    if (this.data.pressed) this.setData({ pressed: '' });
  },
  onChipEnd() {
    // 不灭灯：tap 紧随其后触发跳转（jumpToDay 清态）。兜底：tap 未派发（大幅滑动）350ms 后灭灯
    clearTimeout(this._chipTimer);
    this._chipTimer = setTimeout(() => { if (this.data.pressed) this.setData({ pressed: '' }); }, 350);
  },
  onChipCancel() {
    clearTimeout(this._chipTimer);
    if (this.data.pressed) this.setData({ pressed: '' });
  },
  onHide() {
    // 离开本页即清按压态：switchTab 期间 touchend 可能没跑，数据层不留脏状态
    if (this.data.pressed) this.setData({ pressed: '' });
  },

  // 展开/收起阶段列表
  onPhaseTap(e) {
    const p = Number(e.currentTarget.dataset.p);
    this.setData({ openPhase: this.data.openPhase === p ? 0 : p });
  },

  // 跳转到某一天：today 是 tabBar 页面，必须用 switchTab（旧实现用 navigateTo，必然失败）。
  // 跳转前同步清 pressed + 延迟 100ms 再 switchTab（v1.1.21 铁律；v1.1.24 曾移除导致返回时
  // 残留闪现回归，v1.1.25 恢复）——保证「清除 tint」的渲染先于页面隐藏落到渲染层。
  // 因 touchend 不灭灯（按压-确认模式），tint 实际显示 = 按住时长 + 松手后 100ms，反馈仍闭环。
  // onHide/onShow 双兜底保留。
  jumpToDay(day) {
    const app = getApp();
    if (this.data.pressed) this.setData({ pressed: '' });
    if (app && app.globalData) app.globalData.jumpDay = day;
    setTimeout(() => { wx.switchTab({ url: '/pages/today/today' }); }, 100);
  },

  // 点某周的某天（v1.1.22：周卡整块不再跳转，日格是唯一跳转入口）
  onDayTap(e) {
    const w = Number(e.currentTarget.dataset.w);
    const k = Number(e.currentTarget.dataset.k);
    this.jumpToDay((w - 1) * 7 + k);
  },
});
