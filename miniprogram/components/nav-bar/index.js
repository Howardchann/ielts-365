// components/nav-bar —— 自定义导航栏（v1.1.33）
// 来源：官方 wechat-miniprogram/awesome-skyline 的 navigation-bar 组件裁剪版
//       （examples/address-book，194 行 → 本项目裁到 tabBar 页形态：无返回键、无 slot、标题直传）
// 为什么做这个：app.json darkmode:true + theme.json 跟随系统主题，与 theme.js 手动
// setNavigationBarColor 相互打架 —— 系统≠应用主题时每个原生栏页面首帧必闪白。
// 自定义导航栏 = 零 setNavigationBarColor，颜色走 CSS 变量 var(--nav-bg/--nav-fg)，
// 与页面 .theme-dark 换肤同帧渲染，主题切换闪白的土壤被结构性清除。
//
// 与官方版的关键差异（都是刻意的，别"优化"回去）：
// 1. 几何计算放在**模块加载期同步执行**（官方放 attached + wx.getSystemInfo 异步回调，
//    首帧可能拿到 undefined 高度导致内容跳动；同步算好进 data，首帧即正确，零 setData）；
// 2. 背景固定在 .nav-bar 外层节点（官方在内层）—— 状态栏区域也要有底色；
// 3. 左侧留一个与右 padding 等宽的空 view（官方 leftWidth 原本给返回键用），
//    保证标题在「左区 | 胶囊区」之间真正居中；
// 4. 颜色不写死、不跟 prefers-color-scheme（本项目是三态主题，手切深色时系统可能仍是浅色，
//    媒体查询会错）—— 一律 var()，继承页面根节点 .theme-dark 的 token 组。
let statusBarHeight = 20;
let navBarHeight = 64;
let innerPaddingRight = '';
let leftWidth = '';
try {
  const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const rect = wx.getMenuButtonBoundingClientRect();
  if (win && win.statusBarHeight) statusBarHeight = win.statusBarHeight;
  if (rect && rect.top && rect.bottom && rect.height && win && win.windowWidth) {
    // 官方公式：导航行高 = 胶囊底 + 胶囊顶 - 状态栏高（= 状态栏下移量*2 + 胶囊高，
    // 即上下留白对称、行内高度与胶囊等高的那一行）
    navBarHeight = rect.bottom + rect.top - statusBarHeight;
    innerPaddingRight = 'padding-right:' + (win.windowWidth - rect.left) + 'px;';
    leftWidth = 'width:' + (win.windowWidth - rect.left) + 'px;';
  } else {
    navBarHeight = statusBarHeight + 44; // 兜底：拿不到胶囊几何时按原生栏默认高度
  }
} catch (e) {
  navBarHeight = statusBarHeight + 44;
}

Component({
  options: { multipleSlots: false },
  properties: {
    title: { type: String, value: '' },
    extClass: { type: String, value: '' }
  },
  data: { statusBarHeight, navBarHeight, innerPaddingRight, leftWidth }
});
