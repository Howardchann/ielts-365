const theme = require('../../utils/theme')

Page({
  data: {
    dark: theme.isDark(),
    pageStyle: theme.pageStyle(),
    navH: theme.navHeight(),
    targetTab: 'random'
  },

  onLoad(options) {
    theme.bind(this)
    this.setData({
      dark: theme.isDark(),
      pageStyle: theme.pageStyle(),
      targetTab: options.tab || 'random'
    })
  },

  onShow() {
    theme.sync(this)
    if (this._started) return
    this._started = true
    const tab = this.data.targetTab || 'random'
    // Give this page one rendered frame before switchTab. The page is an
    // opaque, theme-matched bridge, so the destination Tab is never exposed
    // until the bridge itself has been painted.
    setTimeout(() => {
      wx.switchTab({
        url: `/pages/review/review?tab=${encodeURIComponent(tab)}`
      })
    }, 32)
  }
})
