// utils/theme.js —— 外观三态：跟随系统(auto，默认) / 浅色(light) / 深色(dark)
// 页面内容换肤 = CSS 变量：page 选择器挂浅色 token，页面根 view 挂 .theme-dark 时整组覆盖；
// 原生导航栏/窗口背景 = darkmode+theme.json 管「跟随系统」，运行时用 setNavigationBarColor/setBackgroundColor 覆盖。
const KEY = 'appearance';

function mode() { try { return wx.getStorageSync(KEY) || 'auto'; } catch (e) { return 'auto'; } }
function setMode(m) { try { wx.setStorageSync(KEY, m); } catch (e) {} }

function sysTheme() {
  try {
    const i = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
    return (i && i.theme) || 'light';
  } catch (e) { return 'light'; }
}

function isDark() {
  const m = mode();
  return m === 'dark' || (m === 'auto' && sysTheme() === 'dark');
}

// 原生栏只在「手动模式」下接管；auto 模式完全交给 darkmode+theme.json（跟随系统自动切）。
// 之前每次 onShow 都无条件 setNavigationBarColor/setBackgroundColor（自带 200ms 动画），
// 且 auto 模式下与 theme.json 互相拉扯 —— 这就是切页闪屏的来源。
let lastNav = null, lastWin = null;
function nativeBars(dark) {
  if (mode() === 'auto') return;
  const nav = dark ? '#0E1618' : '#176B5B';
  if (lastNav !== nav) {
    lastNav = nav;
    try { wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: nav, animation: { duration: 0, timingFunc: 'linear' } }); } catch (e) {}
  }
  const win = dark ? '#0E1618' : '#F3F8EF';
  if (lastWin !== win) {
    lastWin = win;
    try { wx.setBackgroundColor({ backgroundColor: win }); } catch (e) {}
  }
}

// 页面级应用：data.dark 驱动根 view 的 theme-dark 类；pageStyle 走 <page-meta>
// 浅/深两态都显式指定窗口背景，避免从另一主题切回来时先短暂露出默认窗口底色。
function applyPage(page) {
  const dark = isDark();
  const patch = {};
  if (page.data.dark !== dark) patch.dark = dark;
  const pageStyle = dark ? 'background-color:#0E1618;' : 'background-color:#F3F8EF;';
  if (page.data.pageStyle !== pageStyle) patch.pageStyle = pageStyle;
  if (Object.keys(patch).length) page.setData(patch);
  nativeBars(dark);
}

// 通用同值守卫：微信 setData 无深度 diff，同值也整树重渲染（切页闪屏根源）。
// 逐 key JSON 比对，只把真正变化的字段交给 setData。页面 data 不含循环引用，可安全序列化。
function sameSet(page, patch) {
  const out = {};
  for (const k in patch) {
    const nv = patch[k], ov = page.data[k];
    if (JSON.stringify(nv) !== JSON.stringify(ov)) out[k] = nv;
  }
  if (Object.keys(out).length) page.setData(out);
}

function syncTabBar(page, active) {
  if (typeof page.getTabBar !== 'function') return;
  const bar = page.getTabBar();
  if (!bar) return;
  const patch = {};
  const dark = isDark();
  if (bar.data.dark !== dark) patch.dark = dark;
  // active 也守卫：各页 onShow 原先无条件 setData({active})，同值也会让整个 tabBar 重渲染（底部闪）
  if (typeof active === 'number' && bar.data.active !== active) patch.active = active;
  if (Object.keys(patch).length) bar.setData(patch);
}

module.exports = { mode, setMode, isDark, applyPage, syncTabBar, sameSet };
