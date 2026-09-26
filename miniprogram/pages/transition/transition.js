const theme = require('../../utils/theme')

Page({
  data: {
    dark: theme.isDark(),
    pageStyle: theme.pageStyle(),
    navH: theme.navHeight(),
    targetTab: 'random'
  },

  onLoad(options) {
    const dark = theme.isDark()
    const pageStyle = theme.pageStyle()
    const targetTab = options.tab || 'random'

    // 过渡页必须先把窗口露底色设成当前主题，避免深色模式进入桥页时先露白。
    try {
      wx.setBackgroundColor({ backgroundColor: dark ? '#0E1618' : '#F3F8EF' })
    } catch (e) {}

    wx.setStorageSync('__reviewDeepLinkTab', targetTab)
    this.setData({ dark, pageStyle, targetTab })
  },

  onShow() {
    if (this._started) return
    this._started = true

    const dark = theme.isDark()
    const pageStyle = theme.pageStyle()
    const pages = getCurrentPages()
    const review = pages.find(p => p && p.route === 'pages/review/review')

    // 在 switchTab 之前，把已经缓存的 Review 页直接准备成“目标主题 + 目标 tab + 安全帧”。
    // 这样不再依赖 Review.onShow() 才第一次改主题，减少深色模式下旧窗口/旧主题露出的机会。
    if (review) {
      try {
        review.setData({ dark, pageStyle, tab: this.data.targetTab, veil: true })
      } catch (e) {}
    }

    // 给桥页一个最小绘制窗口；不再调用 theme.bind/sync，避免额外 setData/主题监听造成按钮迟滞。
    setTimeout(() => {
      wx.switchTab({ url: '/pages/review/review' })
    }, 16)
  }
})
