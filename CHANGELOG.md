# 变更日志（CHANGELOG）

> 本文件随代码留存，目的：任何接手的人（或下一次的 AI）都能看懂**改了什么、为什么改、遗留问题在哪**，不依赖对话上下文。
>
> 给 AI 看的决策背景见 [AI-CONTEXT.md](./AI-CONTEXT.md)。

---

## 2026-09-20（第二次）· 进度备份 + 云状态显示修正

由于确认「免费云环境会在发布后第 15 天到期」，且个人主体无法迁移，决定**不依赖任何付费云服务**，改为自带备份自救。

| # | 类型 | 文件 | 内容 | 状态 |
|---|---|---|---|---|
| 1 | 修复 | `utils/store.js` | 新增 `exportBackup()`：把 startDate / checkedDays / starredWords / rate / accent / engine 序列化为带 `app` 标识与版本号的 JSON 文本 | 已验证 |
| 2 | 修复 | `utils/store.js` | 新增 `importBackup(text, mode)`：`merge` 取并集（打卡合并、重点词按 word 去重且保留本地释义）、`replace` 整体覆盖 | 已验证 |
| 3 | 修复 | `utils/store.js` | 新增 `sanitize()`：外部数据逐字段校验——key 须匹配 `/^w\d{1,2}d[1-7]$/`（防 `__proto__` 污染）、缺 `w` 的条目丢弃、字符串截断（词 60 / 释义 80 / 词性 20 / 例句 300）、`rate` 限 0.5~2、`accent` 限 us/uk、`engine` 限三者之一、日期须 `YYYY-MM-DD` | 已验证 |
| 4 | 修复 | `pages/settings/settings.js` | 新增导出（自动复制剪贴板）、重新复制、合并导入、覆盖导入、收起等 7 个处理函数；导入失败以中文弹窗说明原因 | 已验证 |
| 5 | 修复 | `pages/settings/settings.wxml` | 新增「进度备份」卡片：stat-line + 两个 textarea 区块（导出结果 / 导入输入）+ 合并 / 覆盖按钮 | 已验证 |
| 6 | 修复 | `pages/settings/settings.wxss` | 新增 `.backup-box` / `.backup-text` / `.btn-plain` | 已验证 |
| 7 | **修复已知 bug** | `utils/store.js` | `cloudStatus().enabled` 在未开通云开发时恒为 `true`，设置页谎称"打开几天后会自动创建"。改为在 `init()` / `syncNow()` 先探测 `db()` 可用性写入 `cloudAvailable`，三者联合判断 | 已验证 |
| 8 | 文档 | `README.md` | 修正过时的插件 / 云同步描述；「关于」弹窗改为备份说明 | 已验证 |
| 9 | 文档 | `AI-CONTEXT.md` | 新增：给未来接手 AI 的决策背景文档，含 3 个关键决策、已修坑列表、实测数据、TODO、主体约束 | 已验证 |

### 本次验证

```
36 条断言全部通过（mock 微信运行时，cloud = undefined）
  1. 导出格式与字段完整性                6 条
  2. 合并导入（并集、去重、保留本地释义） 8 条
  3. 覆盖导入（清理旧数据）               5 条
  4. 脏数据与恶意输入（污染/截断/非法值） 10 条
  5. 错误处理（空串/非法 JSON/其他 App）   4 条
  6. 往返一致性                            3 条
未开通云开发时 cloudStatus(): enabled=false ready=false hasDoc=false  ✅
JS 语法：12 个文件全部通过
WXML 绑定方法 15 个，JS 均有实现，无缺失
```

### 变更量

| 文件 | 变化 |
|---|---|
| `utils/store.js` | 8,973 → 约 12,400 字节（新增备份模块 + 状态修正） |
| `pages/settings/settings.js` | 3,712 → 约 5,300 字节 |
| `pages/settings/settings.wxml` | 3,191 → 约 4,600 字节 |
| `pages/settings/settings.wxss` | 877 → 1,165 字节 |

---

## 2026-09-20 · 语音引擎重写 + 18 项修复 + 个人主体适配

### 背景

从 H5 版迁移而来，原始痛点：**H5 无法选择发音人**。迁到小程序后，排查出 18 项缺陷（3 项致命、5 项重要）。同时确认一个硬约束：**个人主体小程序搜不到微信同声传译插件**（AppID `wx069ba97219f66d99`）。

### 修复清单

| # | 级别 | 文件 | 问题 | 修复方式 | 状态 |
|---|---|---|---|---|---|
| 1 | 致命 | `pages/weeks/weeks.js` | 用 `navigateTo` 跳 tabBar 页面，按官方限制必失败，周计划点任何一天都跳不过去 | 改 `switchTab` + `app.globalData.jumpDay` 传参 | 已验证 |
| 2 | 致命 | `utils/speech.js` | `state.plugin.textToSpeech` 未判空，插件不可用时直接 TypeError | 所有发声路径前判空 + toast 提示 | 已验证 |
| 3 | 致命 | `pages/today/today.js` | 监听器在每次调用时重复注册，无限堆积 | `onLoad` 只注册一次，`onUnload` 注销；`onStateChange` 改为返回取消函数 | 已验证 |
| 4 | 重要 | `utils/speech.js` | iOS 静音键打开时吞声（原 H5 "无法选择声音"的同类根因） | 播放前调用 `wx.setInnerAudioOption({ obeyMuteSwitch: false })` | 已验证 |
| 5 | 重要 | `utils/speech.js` | 快速连点叠音 + `InnerAudioContext` 实例泄漏 | `playToken` 递增令牌 + `killAudio()` 强制销毁旧实例 | 已验证 |
| 6 | 重要 | `utils/speech.js` | 插件回调未按官方规范校验 `retcode`，错误码当成功用 | 增加 `retcode === 0` 判定 + `explainPluginError()` 翻译成中文 | 已验证 |
| 7 | 重要 | `utils/store.js` | 云同步失败一次就把 `cloudEnabled` 永久置 false，网络恢复无法自愈 | 改为失败计数 `MAX_FAILS = 3` + 「立即同步」强制重试 | 已验证 |
| 8 | 重要 | `pages/weeks/weeks.js` | 周格子用「完成数量」推断完成状态，跳天打卡全错 | 新增 `store.weekCheckedMap()` 返回 7 天真实状态 | 已验证 |
| 9 | — | `utils/speech.js` | TTS 无缓存，重复朗读反复消耗额度 | 同文本 3 小时内复用，上限 300 条 | 已验证 |
| 10 | — | `utils/speech.js` | 连读中点单词不打断队列，双音覆盖 | `speak()` 先清空队列（对齐 H5 行为） | 已验证 |
| 11 | — | `utils/store.js` | `syncNow()` "推完等 1.5 秒猜结果" | 改为真实 Promise 链 | 已验证 |
| 12 | — | `utils/store.js` | 拉取与推送并发互相覆盖 | `pullInFlight` + `pendingPush` 保证先拉后推串行 | 已验证 |
| 13 | — | `utils/store.js` | 云错误只打 console | `explainError()` 直译，设置页直接显示 | 已验证 |
| 14 | — | `pages/today/today.js` | `setData` 传了双份词汇数据（传输量翻倍） | `renderDay` 剔除 `dayData.v` | 已验证 |
| 15 | — | `pages/review/review.js` | 重点词池副本缺 `starred` 字段，永远显示未收藏 | 抽样结果回填真实状态 | 已验证 |
| 16 | — | `pages/review/review.js` | 抽词可能连续抽中同一个词 | `pickItem()` 最多重试 4 次 | 已验证 |
| 17 | — | `pages/settings/*` | 无口音选择 | 新增美式/英式 picker | 已验证 |
| 18 | — | `project.config.json` | `cloudfunctionRoot` 指向不存在的目录 | 移除该字段 | 已验证 |

### 个人主体适配（online 版本）

| 改动 | 说明 |
|---|---|
| `app.json` | 移除 `plugins` 声明（个人主体未添加插件时，硬声明可能在上传环节被卡） |
| `utils/store.js` | 默认引擎 `auto` → `online` |
| `pages/settings/settings.js` | 初始引擎改为 `online` |
| `pages/settings/settings.wxml` | 插件就绪提示改为在线通道说明 |

### 变更量统计

| 文件 | 行数变化 | 字节变化 |
|---|---|---|
| `utils/speech.js` | 170 → 341（+231 / −56） | 4,873 → 10,882 |
| `utils/store.js` | 203 → 270（+124 / −57） | 5,663 → 8,973 |
| `pages/weeks/weeks.js` | 55 → 74（+35 / −16） | 1,502 → 2,345 |
| `pages/weeks/weeks.wxml` | 43 → 49（+26 / −20） | 1,833 → 2,055 |
| `pages/review/review.js` | 108 → 128（+40 / −20） | 2,962 → 3,801 |
| `pages/settings/settings.js` | 104 → 124（+30 / −10） | 3,115 → 3,712 |
| `pages/today/today.js` | +37 / −37 | 4,301 → 4,520 |
| `app.js` | +1 / −1 | 716 → 817 |
| `project.config.json` | −1 | 576 → 534 |

数据文件（`data.js` / `data-p1~p4.js`）与 H5 版逐字节一致，未改动。

### 验证结果

- 10 个 JS 文件 `node --check` 通过
- 16 条断言全部通过（10 条基础 + 6 条 TTS），含 mock 微信运行时与 mock 插件
- 全部 JSON 合法
- WXML 绑定的方法与变量一致性检查通过，无缺失
- 数据完整性：52 周 / 1,300 词 / 去重 1,125 / 四阶段各 13 周 / 无缺项

---

## 已知遗留问题

### 1. ~~云状态显示不准确~~ → **已修复**（见第二次更新第 7 条）

原问题：`store.js` 中 `enabled: cloudReady || cloudFailCount < MAX_FAILS`。未开通云开发时 `db()` 返回 `null` 直接 reject，**不经过 catch，`cloudFailCount` 恒为 0**，导致 `enabled` 恒 `true`，设置页显示「尚未建立云端记录（打开几天后会自动创建）」——实际永远不会创建。

现已改为三者联合判断（`cloudAvailable` + `cloudReady` + 失败计数）。

### 2. ~~学习进度只有本地一份~~ → **已提供备份方案**（见第二次更新第 1~6 条）

未开通云开发时进度存在 `wx.setStorageSync('ielts-365-store')`，卸载微信 / 换机 / 清缓存会丢失。

现已在设置页提供「进度备份」：导出 JSON 文本 + 合并 / 覆盖导入。**建议养成定期导出的习惯**（每月一次即可），粘贴到「文件传输助手」或备忘录保存。

### 3. 有道 TTS 是非官方公开接口

无 SLA、无配额承诺，存在被限流或改版的可能。若将来失效，替换点集中在 `speech.js` 的 `startOnline()`，约 20 行。备选：腾讯云 TTS（免费 800 万字符 / 3 个月，后付费 0.2~0.3 元每万字符），但需要在服务端加签，成本转移到云函数。

### 4. 量级参考

全库会朗读的内容共 **79,300 字符 ≈ 7.93 万字符**：

| 内容 | 条数 | 最长字符 |
|---|---|---|
| 单词 | 1,300 | 23 |
| 词汇例句 | 1,300 | 51 |
| 语法例句 | 780 | **222** |

注意：**127 条语法例句超过微信插件的 50 字符上限**，即便能用插件也读不了这部分——这是插件方案的结构性缺陷，也是本次选择在线通道的实证依据。

---

## 主体相关结论（不涉代码，但影响后续决策）

| 结论 | 依据 |
|---|---|
| 个人主体无法添加同声传译插件 | 用户已实际确认搜索不到；社区答复"个人不支持，因为这个插件的类目个人主体没有" |
| **个人主体不能迁移为企业/个体工商户主体** | 微信官方社区明确答复："个人主体小程序不支持迁移至任何主体类型……建议注册新的小程序账号" |
| 更换主体 = 重新注册，AppID 会变 | 同上 |
| 使用「经营者非本人」的个体工商户执照风险高 | 所有权归经营者，认证/变更全程需对方配合，收款进对方账户 |
| 自办个体工商户执照成本极低 | 多地政府指南：不收费、0.5~3 个工作日，部分自助机 15 分钟出照 |
| 云开发免费环境在小程序发布后第 15 天到期 | 微信官方计费文档 + 腾讯云 CloudBase 价格文档 |

**当前决策：保持个人主体，使用有道在线 TTS 通道，不开通云开发付费。**
