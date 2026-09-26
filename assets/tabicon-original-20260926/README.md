# tabBar 原版 PNG 图标备份（2026-09-26）

v1.1.x tabBar 改版前使用的 8 张原始 PNG 图标（今日/周计划/复习/设置 × 普通/选中），
已被 `custom-tab-bar/index.wxss` 内的 SVG data-URI（生成源 `tools/gen-tabicons.js`）取代。

**本目录仅作历史存档，不参与小程序打包**（位于 `miniprogram/` 之外）。
如需回滚旧 tabBar：把这 8 张放回 `miniprogram/images/` 并恢复改版前的
`custom-tab-bar/index.{js,wxml,wxss}` 与 `app.json` 相关配置。

- 替换原因：PNG 图标与 09-25 后的新 UI 风格（红点缀镂空选中态、深浅两套）不匹配，且 cover-view 缩放发虚
- SVG 版生成/自检：`node tools/gen-tabicons.js` → `node tools/check-tabicons.js` → Edge 无头截图
- 原始备份位置（仓库外）：`D:\idea\_tabicon_backup_0926\`
- 相关决策与坑：`AI-CONTEXT.md` §2.7、坑 42；`CHANGELOG.md` 2026-09-26 节
