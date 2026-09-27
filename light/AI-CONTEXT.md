# AI-CONTEXT —— light 实例（纯浅色版 · **主项 / 上线版**）

> **本文件只描述 light 实例自身的现状与边界**。cloud 实例（三色调整完整版）的完整决策史、机制细节、实验记录见 `../cloud/AI-CONTEXT.md`——两实例共享全部底层机制，此处不重复。

## 本实例定位（2026-09-27 用户拍板）

**本实例为仓库主项与唯一上线形态**：深浅模式下的闪白/残影在保留三色调整的 cloud 实例中无法根治，故功能开发与上线以后都从本实例出，直到主题闪白问题找到根治方案。共用逻辑（store/speech/页面结构）的变更需同步回 `cloud/` 与 `dark/`。

## 本实例是什么

- 由 cloud 实例 **v1.1.38**（提交 `dbe76dc` 时的 cloud/ 树）派生；
- **色系调整模块整体删除**：主题定死浅色，没有「跟随系统/浅色/深色」三态，没有手动切换；
- 适用于不需要深色模式的发布形态。

## 与 cloud 实例的代码差异（仅以下几处）

| 文件 | 差异 |
|---|---|
| `miniprogram/utils/theme.js` | `mode()` 恒返回 `'light'`、`isDark()` 恒 `false`；删除 storage 读写与系统主题探测；其余 API（applyPage/syncTabBar/sameSet/nativeBars）形状不变，页面代码零改动 |
| `miniprogram/app.json` | 删 `"darkmode": true`、`"themeLocation"`；`@winBg/@bgContent` 替换为静态 `#F3F8EF` |
| `miniprogram/theme.json` | 整文件删除 |
| `miniprogram/app.js` | 删 `wx.onThemeChange` 监听（无跟随系统链路） |
| `miniprogram/pages/settings/settings.wxml` | 删「外观」卡片（三态选择器） |
| `miniprogram/pages/settings/settings.js` | 删 `onAppearance` 处理器与 onShow 里的 `appearanceMode` 同步 |

## 主题机制现状

- **无 darkmode**：窗口容器底色走 app.json 静态色，永远是浅色 `#F3F8EF`；
- **无运行时主题切换**：不存在「手动主题≠系统主题」的状态，页面 data 的 `dark` 恒为 `false`，`.theme-dark` 类永不挂上；
- 四页 `<nav-bar>` 自定义导航栏、`custom-tab-bar` 均继承 cloud 实例实现，但永远渲染浅色。

## 问题边界（2026-09-27 用户定性，两问题均**待解决**）

1. ⚠️ **deep-link（设置页→复习页指定 tab）极短残影**：盖罩（veil）+跨栈预切换方案照搬 cloud，残影仍在（残影内容恒为浅色画面）。**已知过渡帧（中转桥垫帧）方案在本实例形态下不会产生残影**——过渡桥 2026-09-26 真机实验中浅色浏览正常，但该方案因深色形态闪白被整体舍弃，本实例不单独启用；残影保持待解决。
2. ⚠️ **系统是深色时首次进入本实例、首次点击 4 个 tab 闪白**：用户定性存在（与 cloud 实例「跟随系统跨主题翻转后首点 tab 闪白」同族）。注意本实例无 darkmode、容器色静态浅色，机制层级（webview 首绘/合成器/系统层）与 cloud 不完全相同，**待真机录屏定性后修复**；在此之前按待解决跟踪。

其他说明：切主题闪旧主题类问题在本实例结构性不存在（无主题切换）；合成器缓存帧机制仍在（后台页延迟重绘），缓存帧内容恒为浅色正确画面。

## 主题相关实验史（过渡桥方案与本实例的关系）

- **deep-link 过渡桥方案**（2026-09-26 晚，已弃）：用纯底色中转页垫帧消除 deep-link 残影——**浅色状态下浏览正常（不会产生残影），深色状态下持续闪白**（桥页自身是新建页面，theme.json 容器首帧色跟系统不跟应用，深色下垫不住）。方案被整体舍弃，本实例虽属浅色形态（该方案在本形态有效），仍不单独启用；残影按待解决跟踪。若未来重启垫帧类方案，浅色形态验证通过即终态。
- cloud 实例的「闪白残留层调研」结论（darkmode 强制依赖、无 backgroundColorContent 运行时 API）不适用于本实例——本实例直接绕开了 darkmode。

## 交互定稿（继承 cloud v1.1.38）

- 复习页：随机/到期两 tab 各记各的当前词（`currentRandom`/`currentDue` 分家）；点卡片/答完进下一词**不自动朗读**，朗读统一走卡片喇叭；已在到期页再点 tab 不换词；
- 四页全自定义导航栏、tap 跳转手动按压态、跳转前清态等铁律与 cloud 实例一致（见 cloud 文档 §铁律）。

## 构建 / 上传

- 开发者工具以 **`light/` 为项目根**打开（`miniprogramRoot: miniprogram/` 不变）；
- 上传前在 `light/` 下跑 `node tools/stamp-build.js`（会向上查找仓库根 `.git`，显示的 sha 是整个仓库的 HEAD）；
- 注意：四个实例同仓同 HEAD，「关于」页 sha 相同属正常；区分实例看各实例 README 与文档。
