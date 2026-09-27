// custom-tab-bar/index.js —— 四个 tab 的选中态与主题状态
// 主题在组件 data 初始化阶段就确定，避免首帧先亮后暗；active/dark 在 attached 阶段一次 setData，避免两次重绘。
const theme = require('../utils/theme.js');

Component({
  data: {
    active: 0,
    dark: theme.isDark(),
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
  methods: {
    syncActive() {
      const pages = getCurrentPages();
      const page = pages[pages.length - 1];
      const route = page ? (page.route || '') : '';
      const active = this.data.list.findIndex(item => item.pagePath === route);
      const dark = theme.isDark();
      const patch = {};
      if (active >= 0 && active !== this.data.active) patch.active = active;
      if (dark !== this.data.dark) patch.dark = dark;
      // active + dark 合并成一次更新，避免首次进入页面先亮/先高亮错误项再二次修正。
      if (Object.keys(patch).length) this.setData(patch);
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
