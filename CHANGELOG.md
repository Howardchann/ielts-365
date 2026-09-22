# 变更日志（CHANGELOG）

> 本文件随代码留存，目的：任何接手的人（或下一次的 AI）都能看懂**改了什么、为什么改、遗留问题在哪**，不依赖对话上下文。
>
> 给 AI 看的决策背景见 [AI-CONTEXT.md](./AI-CONTEXT.md)。
>
> **阅读顺序：本文件按时间倒序，最新的在最上面。**
> ⚠️ 09-20 之前几节里的「云同步」相关描述**已作废**——云同步于 2026-09-21 整体移除（见下），保留原文仅为留存决策过程。

---

## 2026-09-22 · 音频上云（云函数签名）+ 语法句预生成 + 三轮真机反馈闭环

### 一、事件线

| 时间 | 事件 |
|---|---|
| 上午 | 拿到环境 ID 与 fileID → 32000 条音频上传云端 → **发现免费期存储权限被锁死** → 改云函数签名方案 → 真机验证通过 |
| 中午 | 用户真机日志报 `backgroundfetch privacy fail` → 判定为误报（见下） |
| 13:50 | 用户提 **7 条修复**（语法句逐词蹦/音色不一、底栏重叠、关于文案位置、口音、音源切换、排版） |
| 15:00 | 语法句预生成根治（含 djb2 负数哈希 bug）→ 三轮真机反馈逐项闭环 |
| 16:20 | 云端垃圾清理 + GitHub 推送（3 个 commit） |

### 二、云端音频（提交 `087b41e`）

| # | 类型 | 文件 | 内容 |
|---|---|---|---|
| 1 | 新增 | `cloudfunctions/audio-url/index.js` | 批量签发云存储临时链接；`MAX_BATCH=50`、`MAX_AGE=7200` 写死、路径白名单正则 |
| 2 | 新增 | `cloudbaserc.json` + `project.config.json` | envId、functionRoot、cloudfunctionRoot |
| 3 | 改造 | `utils/cloud.js` | `ready()` 改为看 `wx.cloud.callFunction`；新增 `SIGN_FN='audio-url'` |
| 4 | 改造 | `utils/speech.js` | 云存储档由 `downloadFile` 改为「云函数批量签名 → URL 缓存(TTL 60min) → `InnerAudioContext` 播 https → 后台落本地缓存」；签名走**串行队列**防漏签；播放失败丢弃 URL 并降级在线链 |
| 5 | 新增 | `utils/prefetch()` | 提前签好当天音频（分片 ≤50/批），并顺手落盘前 10 条 |

**为什么必须这么做**：免费套餐下云存储权限锁定为「仅创建者和管理员可读写」，控制台与后台 API 双双拦截修改（`ModifyStorageSafeRule 当前套餐无法执行此操作`）；音频由管理端 CLI 上传、不属于任何用户，客户端 `downloadFile` / `getTempFileURL` 一律被安全规则拒绝（实测无签名直链 403，桶私有）。

**验证**：云函数返回 3 条签名 URL；非法路径 `../../secret.txt` 被拦；签名 URL 下载字节数与本地一致（39542 / 18853 / 16972 B）；mock 行为测试 `_test_speech_signed.js` **14/14 PASS**。
**真机验证（11:03）**：单词有声、例句有声、慢速 0.75X 有声、备份导出导入正常 → 音频链路闭环；并证明 **`InnerAudioContext` 播 https 直链不受 downloadFile 域名白名单限制**。

### 三、语法句预生成（本轮最大修复）

**根因**：语法例句在数据里是纯字符串数组 `day.g.ex[]`，**没有音频编号**，客户端只能降级在线 TTS → 音色不统一、部分仍逐词蹦。

**修复**：为全部英文语法例句预生成音频，命名用**文本 djb2 哈希** → `g/{hash%10}/{hash}{s?}.mp3`，数据文件零改动。

| # | 类型 | 内容 | 状态 |
|---|---|---|---|
| 6 | 修复 | 统计：例句引用 912 条去重 = **765 英文（预生成）+ 147 含中文（记忆法条目，走在线）** | 已验证 |
| 7 | **修复 bug** | **djb2 必须 `>>> 0`**：初版 `& 0xFFFFFFFF` 得 int32，>2^31 的句子哈希为负 → 文件名带负号、分桶 `-1`~`-9`、白名单匹配不上（88 文件传不上）。修复后重提取，369 个文件重生成 | 已验证 |
| 8 | 修复 | `cloudfunctions/audio-url` 白名单扩为 `^([ws]/[0-8]/\d{4}s?\.mp3\|g/[0-9]/[0-9a-f]{8}s?\.mp3)$` 并重新部署 | 已验证 |
| 9 | 修复 | `speech.js tryPregenG()` 加非 ASCII 短路：中文条目不再白跑一次云函数 + 播放报错 + 6 秒超时 | 已验证 |
| 10 | 验证 | 生成+转码 **1530/1530 零失败**；全量差集核对（`verify_grammar_all.py`）：本地缺失 0 / 云端缺失 0 | 已验证 |

### 四、其余 6 项修复（提交 `ba72e28` 及前置）

| # | 类型 | 文件 | 内容 |
|---|---|---|---|
| 11 | 修复 | `app.wxss` | 底部模块与 tabBar 重叠 → `page` 加 `padding-bottom: calc(40rpx + env(safe-area-inset-bottom))` |
| 12 | 修复 | `utils/speech.js` + `settings.js` | 新增 `engineMode`（auto / pregen / online）+ 设置页三选。**逐词连播只保留给单词**（句子兜底改为 有道整句 → 百度整句） |
| 13 | **修复 bug** | `utils/speech.js tryUrl()` | 重构中把「precheck 被拦 → 退回直连」的兜底丢了 → 域名未配时整句直接放弃不出声。**这条是行为测试抓出来的**，复跑 14/14 |
| 14 | 修复 | `settings.js` | 「关于」文案集中到顶部 5 个常量，用户可自行修改；wxml 去掉写死的 `v` 前缀（否则用户写成"版本V1.0"会显示重复 v） |
| 15 | 修复 | `today.wxml/js/wxss` | 练习任务 `pr` 按 `1) 2) 3)` 拆行渲染 |
| 16 | **修复 bug** | `app.wxss` | 语法区文字"全挤在一行"——根因是 CSS：`.grammar-ex-text{flex:1}` **缺 `min-width:0`**，长英文句被撑成一行。补 `min-width:0` + 折行属性 + 行高；新增 `.ex-no` 序号圆标、`.grammar-ex` 分隔线 |
| 17 | 修复 | `today.wxml` + `app.wxss` | 语法区播放按钮点击无状态：按钮本身没挂 `playing` 类、也没有 `.ex-speak.playing` 样式 → 补样式；按下反馈改用 `hover-class="speak-hover" hover-stay-time="120"`（小程序 `view` 的 CSS `:active` 不可靠） |

**真机复验**：三轮反馈全部闭环——语法句音色统一且连贯 ✓ / 按钮状态与按下反馈 ✓ / 音源切换 ✓ / 底部间距 ✓ / 任务区排版 ✓ / 语法区长句折行 + 序号圆标 ✓ / 「关于」卡片两行 ✓。

### 五、云端垃圾清理 + GitHub 推送（用户批准后执行）

- **清理**：`diff_g_cloud.py` 以「运行时真正会请求的 1530 个路径」与云端 `g/0~g/9` 全量做差集 → 缺失 0、**多余 650 个（27.11MB）**。构成为 **12 个负号哈希 + 638 个"合法 hex 但不在需求集内"**（第一批生成时的旧哈希命名，与原先"都是负号文件"的推测不符）。删前核对 `speech.js hashName` ↔ 核对脚本 ↔ 云函数 `PATH_RE` **三处逐字一致**，再执行 `clean_g_extra.py` → 复验云端 **1530 个 / 64.4MB，缺失 0、多余 0**
- **推送**：3 个 commit —— `966b2dd`（8000 词 + 78 周，16 文件）→ `087b41e`（音频云端分发，7 文件）→ `ba72e28`（语法区/设置页，4 文件）
- ⚠️ **网络层踩坑（重要）**：沙箱内 push 挂起，沙箱外直连也失败。根因是**本机 DNS 拒绝解析 github.com**（`ECONNREFUSED queryA`），11 个 GitHub IP 中仅 4 个可达 → 「DNS 挂 + GitHub 半阻断」，**不是代理的问题**。解法：本地 CONNECT 隧道 + **`git -c http.sslBackend=openssl -c http.proxy=http://127.0.0.1:18899`**（默认 schannel 后端走隧道完全失败；隧道脚本须 `client.pause()` 后再 pipe，否则丢 TLS 握手数据）
- 三方对齐校验：`refs/heads/main` == `origin/main` == `ls-remote` == `ba72e289…`；另用 API 独立复核三个 commit 均已上线

### 六、误报排查：`backgroundfetch privacy fail`

真机日志 `private_getBackgroundFetchData:fail:internal error` 属**噪声，与业务无关**。两条硬证据：① 全项目 grep 无 `getBackgroundFetchData` / `backgroundFetch` / `usePrivacyCheck` 调用；② 朗读链路用到的 `wx.cloud.callFunction` / `wx.createInnerAudioContext` / `wx.downloadFile` **均不在隐私接口清单**。

⚠️ 但排查中发现一项**提审前必办**：本项目唯一的隐私接口是 **`wx.setClipboardData`**（导出备份）——官方把 set/get 同列归入"读取你的剪切板"，**写入也算**。提交审核时必须在「用户隐私保护指引」声明剪切板，否则**正式版**该功能 fail。

---

## 2026-09-21 · 移除云同步 → 换源预生成 → 8000 词 / 78 周重构

### 一、架构决策：进度改纯本地 + 内置 SRS（提交 `0102aa1`、`4e5c40d`、`51b5702`）

| # | 类型 | 内容 |
|---|---|---|
| 1 | **移除** | 删除云同步全部代码（`store.js`）、设置页云同步卡片、`app.js` 云开发初始化。**当前全项目无任何 `wx.cloud.database` / `.collection(` 调用** |
| 2 | 新增 | 本地间隔重复：`DEFAULT_INTERVALS = [1,2,4,7,14,30,60,120]`；答对 `level+1`，答错 `level=0` 且 `nextReviewAt=now` |
| 3 | 新增 | 复习页三页签：随机 / **到期** / 重点词（`dueWords()`） |
| 4 | 修复 | 备份合并幂等：`mergeReviewStats()` 按 `lastReviewedAt` 取较新者，同一份备份重复导入不会重复累加 |

**为什么移除**：免费云环境在小程序发布后第 15 天到期（转付费约 19.9 元/月），而本项目实际用量仅约 8 资源点/月（占免费额度 0.02%）——**门槛是政策倒计时，不是用量**。为「多端同步」付年费不划算，改为自带备份自救。

### 二、语音方案换源：逐词连播作废 → 云厂商 TTS 预生成

用户否决逐词连播（"逐词读句子对我这种零基础学习的来说本身就很难受"）——连读/重音/语调/句子节奏全丢，而这是零基础学句子最需要的。**该方案作废，只保留给单词。**

**端点全覆盖实测（决定换源）**：

| 端点 | 结果 |
|---|---|
| 有道 `dictvoice` | 参数无解（`type`/`le`/`keyfrom`/去标点全 500）；**与长度相关**：`I usually` ✅ / `I usually get` ❌ |
| `tts.youdao.com/fanyivoice`\|`nspeech`\|`ttsapi` | HTTP 688（WAF 封，补 UA/Referer 无解） |
| `tts.baidu.com/text2audio` | `err_no:503 Failed connect to jtts engine` |
| 必应 readaloud / Google translate_tts | 403 / 超时 |
| **覆盖率量化** | 单词 **99/100**，**例句仅 11/100** → "部分句子不发声"实际是**约 89% 例句都不发声** |

**音色定稿**：`en-US-AvaMultilingualNeural`（用户试听 6 个音色后选定"最接近人声"）。
**规格定稿**：转码 **44100Hz 单声道 MP3** —— 微软原生输出 MPEG2 24kHz，而百度那批"播放报错"的正是 MPEG2 低采样率档；44100Hz MPEG1 是全机型验证可播的规格。

**码率天花板实测**（内存内 patch `communicate.py` 的 `outputFormat` 逐档测）：仅 **24kHz 家族**可用，**码率上限 96kbps**；`audio-24khz-128/160/192kbitrate`、`audio-48khz-*`、`audio-16khz-128kbitrate` 全部 `NoAudioReceived`。

### 三、词表扩至 8000 + 课程重构为 78 周（提交 `966b2dd`）

| # | 类型 | 内容 |
|---|---|---|
| 5 | 新增 | `utils/words.js`（627.8KB）：8000 词，**课程顺序**，每行 `单词\t词性\t释义\t例句\t音频编号` |
| 6 | 改造 | `utils/data.js` 重写：`TOTAL_DAYS=546`、`WEEK_COUNT=78`、`RAMP[78]`、`CORE_CNT[390]`、`DAY_OFF` 偏移表；`getDay()` 装配词条 |
| 7 | 改造 | `data-p1..p4` → **`data-p1..p6`**（78 周教学内容，每片 13 周；词数引用改占位符 `{D}`/`{W}`/`{Wp}`/`{P1}`） |
| 8 | 改造 | 页面适配：`today`（核心词/扩展词分组）、`weeks`（18 个月总览）、`review`（传 ai/kind）、`settings`（关于文案、日期 picker 放宽到 2028-12-31） |

**排法与坡道**：

```
W1, W2 → R1 → W3, W4 → R2 → …… → W49, W50 → R25 → W51 → R26 → W52
78 周 / 546 天 / 390 个学习日；新课日 14→30 词/天（260 天）+ 巩固日 11→25（130 天）= 8000
```

- **必须新写 130 天内容**的原因：原课程教学内容恰好 52 周整（260 个语法点全部唯一 + 52 个周日自检），且**降词量必须增加"带新词的学习日"**——只加复习日词量不会降
- 26 个巩固周每周一个技能主线（复习方法 → 前缀 re-/un-/dis- → make/do/take 搭配 → …… → 词根 struct/tract/form → 考前衔接），**不引入新语法**；构词法周的例词从 8000 词表按词频真实筛选
- 采用**核心词 + 扩展词双轨**：1125 个原有主题词留在原周原位，6875 个新词按词频升序追加 → **周主题/每日标题/语法/练习/自检一行都不用改**
- ⚠️ **音频零重做**：`ai` = 词频序排名，与课程结构解耦，**32000 条音频一条都不用重生成、不用重新上传**
- W52 是「考前一周：状态巅峰」，必须留在最末 → 第 26 个巩固周刻意插在 W51 之后

### 四、主包体积硬约束（实测，差点爆限制）

| 编码方式 | 体积 |
|---|---|
| 原 JS 对象字面量风格外推 8000 词 | 2044KB → 主包 **107%，爆 2MB 限制** ❌ |
| **制表符/换行分隔字符串**（采用） | **628KB → 主包 55%** ✅ |
| 对象数组 JSON / 元组数组 JSON / 去音标 | 886KB / 722KB / 550KB |

另：**音频命名从"文本哈希"改为"词表序号"** —— 8000 词的哈希映射表会膨胀到 1.2MB+，直接吃掉 2MB 主包；序号命名让运行时靠 `ai` 拼路径，**零映射表**。`{ai//1000}/` 分片目录避免单目录上万文件（Windows 上删除 1.6 万文件 12 分钟未完成）。

### 五、本轮踩坑

- **同一文件并行发 Edit → 改动静默丢失**（`weeks.js` / `settings.js` 各丢 3 处）。教训：同文件修改必须串行，或整文件重写；改完必须 `grep` 复验（**09-22 又咬了一次**，见上节第 21 条）
- `data-p*.js` 字符串里换行必须转义成 `\n`，否则 `Unterminated string literal`（`node --check` 立即发现）
- utils 备份目录必须放在 `miniprogram/` **之外**，否则被计入主包
- 音标补齐：117 个派生词用 eng-to-ipa(CMUdict) 生成，**必须用最长匹配分词器**（连续 replace 会把 ɪ→i 再被 i→: 二次转换，产出 `si:g'ni:fi:kәntli:` 这种错音标）
- 例句抓取首轮过滤太松（`repressed` 配到不当例句）→ 学习产品绝不能有，大幅扩展敏感词表后重建
- 人名表误伤 `frank/mark/rose/may/jack/bob` 等**同时是常用词**的名字 → 从人名表移出

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
