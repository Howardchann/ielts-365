# AI-CONTEXT —— dark 实例（纯深色版）

> **本文件只描述 dark 实例自身的现状与边界**。cloud 实例（三色调整完整版）的完整决策史、机制细节、实验记录见 `../cloud/AI-CONTEXT.md`——两实例共享全部底层机制，此处不重复。

## 本实例是什么

- 由 cloud 实例 **v1.1.38**（提交 `dbe76dc` 时的 cloud/ 树）派生；
- **色系调整模块整体删除**：主题定死深色，没有「跟随系统/浅色/深色」三态，没有手动切换；
- 适用于不需要浅色模式的发布形态。

## 功能层与 light 对齐情况

- **2026-09-29**：按用户拍板「只同步功能内核」，从 light 承接了——音标（`utils/words.js` 全量数据 + `utils/data.js` 第 6 字段 + 今日页 `.word-head/.word-ipa` 渲染）、复习页重点词例句朗读（`onSpeakStarredEx`）、音色兜底（`_aiOf`）、收藏补存 `ai`（`store.js`）。
- **外观 / 配色一律不同步**：本实例无浅灰顶、无 `--card-line`、无 `.card.tip-box` 描边、无 light 的窗口底色。
- 同步后与 light 的剩余差异 = **主题机制 + 版本号**（见下表）；与 cloud 的差异仍只有下表的主题部分，两实例功能层已齐平。
- 规则与验收判据见 `../light/AI-CONTEXT.md` §同步边界。

## 与 cloud 实例的代码差异（仅以下几处）

| 文件 | 差异 |
|---|---|
| `miniprogram/utils/theme.js` | `mode()` 恒返回 `'dark'`、`isDark()` 恒 `true`；删除 storage 读写与系统主题探测；其余 API（applyPage/syncTabBar/sameSet/nativeBars）形状不变，页面代码零改动 |
| `miniprogram/app.json` | 删 `"darkmode": true`、`"themeLocation"`；`@winBg/@bgContent` 替换为静态 `#0E1618`；`backgroundTextStyle` 改 `light`（下拉加载点适配深底）；tabBar 静态色改深色（`backgroundColor #0E1618`、`borderStyle black`、`color #5E6B66`、`selectedColor #58B394`） |
| `miniprogram/theme.json` | 整文件删除 |
| `miniprogram/app.js` | 删 `wx.onThemeChange` 监听（无跟随系统链路） |
| `miniprogram/pages/settings/settings.wxml` | 删「外观」卡片（三态选择器） |
| `miniprogram/pages/settings/settings.js` | 删 `onAppearance` 处理器与 onShow 里的 `appearanceMode` 同步 |

## 主题机制现状

- **无 darkmode**：窗口容器底色走 app.json 静态色，永远是深色 `#0E1618`；
- **无运行时主题切换**：页面 data 的 `dark` 恒为 `true`（首帧即 `theme-dark` 类），页面根 view 恒挂深色 token 组；自定义导航栏/tabBar 恒深色；
- 状态栏前景 `navigationBarTextStyle: "white"` 两页 json 已有（cloud 链路遗留），深色下同样成立。

## 问题边界（2026-09-27 用户定性，两问题均**待解决**）

1. ⚠️ **deep-link（设置页→复习页指定 tab）残影**：盖罩（veil）+跨栈预切换方案照搬 cloud，残影仍在——**深色形态下残影观感非常不明显**（残影内容恒为深色画面），但按待解决跟踪。已知过渡帧（中转桥垫帧）方案在深色形态会闪白（见下方实验史），不可用于本实例。
2. ⚠️ **首次进入本实例、首次切换 4 个 tab 顶部闪一帧（2026-09-27 定性更新，待解决）**：**与色系无关，推翻「系统浅色才闪」旧定性**——light 实例 v1.1.39 真机录屏（1000129736.mp4，24fps）对同族现象逐帧定性：触发条件=手机后台无本小程序（冷启动）后首次访问各 tab 页（首页不闪，启动页 webview 常驻）；逐帧可见 1~2 帧（约 40~80ms）容器底色帧（页面背景与自定义导航未绘制，仅窗口 background 色+状态栏+胶囊+隐约新页虚影），随后 1 帧完整渲染。机制=tab 页 webview 冷创建首绘帧；深色实例下灰/浅色底色帧与深色页面色差大，理论上**观感比 light 更明显**。候选方案见 light/AI-CONTEXT（均未实施）；深色形态若实验 backgroundColor 方案，底色帧应设为导航深色并真机逐帧验证（过渡桥教训：深色形态垫帧类方案必须从严验收）。

其他说明：切主题闪旧主题类问题在本实例结构性不存在（无主题切换）；合成器缓存帧机制仍在（后台页延迟重绘），缓存帧内容恒为深色正确画面。

## 主题相关实验史（cloud 实例的教训，对深色形态尤其重要）

- **deep-link 过渡桥方案**（2026-09-26 晚，已弃）：用纯底色中转页垫帧——**浅色状态下浏览正常，深色状态下持续闪白**（桥页自身是新建页面，theme.json 容器首帧色跟系统不跟应用，深色下垫不住，反复闪）。**这条教训对深色发布形态是最重的一条：任何「新建页面垫帧」类方案在深色主题下都未经验证且历史已证伪一次**；若 dark 实例未来要引入类似方案，必须真机深色逐帧验证。
- cloud 实例的「闪白残留层调研」结论（darkmode 强制依赖、无 backgroundColorContent 运行时 API）不适用于本实例——本实例直接绕开了 darkmode。

## 交互定稿（继承 cloud v1.1.38）

- 复习页：随机/到期两 tab 各记各的当前词（`currentRandom`/`currentDue` 分家）；点卡片/答完进下一词**不自动朗读**，朗读统一走卡片喇叭；已在到期页再点 tab 不换词；
- 四页全自定义导航栏、tap 跳转手动按压态、跳转前清态等铁律与 cloud 实例一致（见 cloud 文档 §铁律）。

## 构建 / 上传

- 开发者工具以 **`dark/` 为项目根**打开（`miniprogramRoot: miniprogram/` 不变）；
- 上传前在 `dark/` 下跑 `node tools/stamp-build.js`（会向上查找仓库根 `.git`，显示的 sha 是整个仓库的 HEAD）；
- 注意：四个实例同仓同 HEAD，「关于」页 sha 相同属正常；区分实例看各实例 README 与文档。
- ⚠️ **深色真机验收从严**：cloud 实例的多次闪白问题都只在深色态暴露（过渡桥浅色正常深色闪白）。dark 实例每次改动后，深色真机过一遍四页切换+冷启动+切后台回前台。
