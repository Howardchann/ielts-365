# CHANGELOG —— dark 实例

> 本实例由 cloud 实例 v1.1.38（仓库提交 `dbe76dc` 的 cloud/ 树）派生，**共享全部产品与机制历史**——完整变更史见 `../cloud/CHANGELOG.md`，此处只记录本实例自身的差异与后续变更。

## 2026-09-29 · 从 light 同步功能内核（音标 / 复习例句朗读 / 音色兜底），外观配色不同步

**背景**：light 实例 09-29 推进到 v1.1.45。用户拍板**只同步功能内核**：dark / cloud 补功能、不补外观；`original/` 落后多代、不发布，不参与同步。

**本次承接（逐处字符串替换，未动任何深色 token）**：

1. `utils/words.js` — 整文件覆盖为 light 版（全量 8000 词含音标，642KB → 762KB）；覆盖前已证本实例在该文件上无独有内容。
2. `utils/data.js` — 带出第 6 字段 `ipa`。
3. `pages/today/today.wxml` — 词头容器改 `.word-head`，新增纯文本音标 `<text class="word-ipa">`。
4. `app.wxss` — **仅**新增 `.word-head` / `.word-ipa`（24rpx，大屏 12px）两条功能规则；浅灰顶、`--card-line`、`.card.tip-box`、窗口底色等**一律未同步**（深色形态有自己的 token 组）。
5. `pages/review/review.js` — 新增 `_aiOf()`（音色兜底）与 `onSpeakStarredEx()`（重点词例句朗读）。
6. `pages/review/review.wxml` / `review.wxss` — 例句行改与今日页同款，`align-items:center`。
7. `utils/store.js` — `toggleStar` 入库补存 `ai`。

**验收**：与 light 的剩余差异收敛为 9 个文件（app.js / app.json / app.wxss / 4 个页面 json / theme.js / build-info.js），**全部为深色主题机制、外观与版本号**；功能类文件已从差异列表全部消失。

⚠️ 深色真机验收从严（沿用本实例铁律）：本次改动涉及今日页词头布局与复习页例句行，**须深色真机过一遍今日页词行 + 复习页重点词例句朗读**（深色态下历史多次只在深色暴露问题）。

---

## 2026-09-27 · 首点闪白定性更新（light 录屏结论同步，文档修订）

- light 实例 v1.1.39 真机录屏逐帧定性「首点 4 tab 闪白」：**与色系无关**，冷启动（后台无小程序）后首访各 tab 即闪，1~2 帧容器底色帧（webview 冷创建首绘帧）；首页不闪；
- 本实例旧定性「系统浅色才闪」被推翻，AI-CONTEXT 已改写；深色实例下底色帧与深色页面色差更大，预期观感更明显；
- 候选方案见 light/AI-CONTEXT（均未实施）；深色形态实验垫色类方案须真机逐帧从严验证（过渡桥教训）；
- 本次仅文档修订，无代码变更。

## 2026-09-27 · 问题边界重新定性（用户拍板）

- 本实例待解决问题收敛为两项：① **deep-link 残影**（仍在，深色形态下观感非常不明显；过渡帧方案在深色会闪白，不可用）；② **系统浅色时首次进入/首次切换 4 个 tab 闪白**（与 cloud 跨主题翻转闪白同族、方向相反，机制待录屏定性）——均**待解决**；
- 此前文档「跨主题翻转闪白在本实例结构性不存在」的判断被用户定性推翻，已修正。

## 2026-09-27 · 派生

- 自 cloud 实例 v1.1.38 派生，主题定死**深色**；
- 删除色系调整模块：`theme.js` 定死 dark、app.json 去 darkmode/themeLocation 改静态深色（backgroundTextStyle 改 light、tabBar 静态色改深）、theme.json 删除、app.js 删 onThemeChange、设置页删「外观」卡片与 onAppearance；
- 闪白问题家族（切主题闪旧主题/容器首帧错色/跟随系统翻转闪白）在本实例**结构性不存在**，详见本实例 AI-CONTEXT「问题边界」；
- ⚠️ 历史教训：deep-link 过渡桥方案在 cloud 实例**深色态持续闪白**被证伪——深色形态下任何新建页面垫帧类方案需从严真机验证；
- 后续变更从本节往下追加。
