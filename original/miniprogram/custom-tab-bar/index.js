Component({
  data: {
    active: 0,
    list: [
      { pagePath: 'pages/today/today', text: '今日', iconPath: '/images/today.png', selectedIconPath: '/images/today-active.png' },
      { pagePath: 'pages/weeks/weeks', text: '周计划', iconPath: '/images/weeks.png', selectedIconPath: '/images/weeks-active.png' },
      { pagePath: 'pages/review/review', text: '复习', iconPath: '/images/review.png', selectedIconPath: '/images/review-active.png' },
      { pagePath: 'pages/settings/settings', text: '设置', iconPath: '/images/settings.png', selectedIconPath: '/images/settings-active.png' }
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
