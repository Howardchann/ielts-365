Component({
  data: {
    active: 0,
    dark: false,
    list: [
      { pagePath: 'pages/today/today', text: '今日', key: 'clock' },
      { pagePath: 'pages/weeks/weeks', text: '周计划', key: 'cal' },
      { pagePath: 'pages/review/review', text: '复习', key: 'review' },
      { pagePath: 'pages/settings/settings', text: '设置', key: 'set' }
    ]
  },
  lifetimes: {
    attached() {
      this.syncActive();
    }
  },
  pageLifetimes: {
    show() {
      this.syncActive();
    }
  },
  methods: {
    syncActive() {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      if (!page) return;
      const route = page.route || '';
      const active = this.data.list.findIndex(item => item.pagePath === route);
      if (active >= 0 && active !== this.data.active) {
        this.setData({ active });
      }
      // 深色模式跟随页面主题（theme.js 在页面 onShow / 系统换色时调用 applyTheme 链到这里）
      try {
        const theme = require('../utils/theme.js');
        if (theme.isDark() !== this.data.dark) this.setData({ dark: theme.isDark() });
      } catch (e) {}
    },
    onTap(e) {
      const index = Number(e.currentTarget.dataset.index);
      const item = this.data.list[index];
      if (!item || index === this.data.active) return;
      wx.switchTab({
        url: '/' + item.pagePath
      });
    }
  }
});
