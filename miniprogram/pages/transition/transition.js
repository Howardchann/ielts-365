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
    const targetTab = options.tab || 'random'
    wx.setStorageSync('__reviewDeepLinkTab', targetTab)
    this.setData({
      dark: theme.isDark(),
      pageStyle: theme.pageStyle(),
      targetTab
    })
  },

  onShow() {
    theme.sync(this)
    if (this._started) return
    this._started = true
    // Give the opaque bridge one frame to paint before switchTab.
    setTimeout(() => {
      wx.switchTab({ url: '/pages/review/review' })
    }, 32)
  }
})
