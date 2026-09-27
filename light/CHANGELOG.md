# CHANGELOG —— light 实例

> 本实例由 cloud 实例 v1.1.38（仓库提交 `dbe76dc` 的 cloud/ 树）派生，**共享全部产品与机制历史**——完整变更史见 `../cloud/CHANGELOG.md`，此处只记录本实例自身的差异与后续变更。

## 2026-09-27 · 派生

- 自 cloud 实例 v1.1.38 派生，主题定死**浅色**；
- 删除色系调整模块：`theme.js` 定死 light、app.json 去 darkmode/themeLocation 改静态浅色、theme.json 删除、app.js 删 onThemeChange、设置页删「外观」卡片与 onAppearance；
- 闪白问题家族（切主题闪旧主题/容器首帧错色/跟随系统翻转闪白）在本实例**结构性不存在**，详见本实例 AI-CONTEXT「问题边界」；
- 后续变更从本节往下追加。
