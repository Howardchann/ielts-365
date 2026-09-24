# 云同步测试台（tools/cloudsync-test）

在 **node 里把真实代码跑起来**的端到端测试：内存假数据库 + 假 `wx-server-sdk`，
直接加载仓库里真实的 `miniprogram/utils/store.js` 与 `cloudfunctions/sync/index.js`，
用两个独立 store 实例模拟**两台设备共享同一份云端数据**。

目的：验证「合并规则」在多设备交错写入下**不会丢进度、不会复活已取消的打卡/收藏**。
所有用例都是确定性的（用 `setTimeout` 造时序，不靠手速），可重复、可进回归。

## 跑法

```bash
node tools/cloudsync-test/run_tests.js
```

- 无需安装任何依赖（`wx-server-sdk` 被重定向到内存假实现）
- 退出码：`0` = 全过，`1` = 有用例失败，`2` = 脚本自身异常
- 仓库根目录由 `__dirname` 上溯两级推出 → **本目录可以整目录搬动**，不必改代码

## 覆盖范围（14 组 / 56 项断言）

| 组 | 主题 |
|---|---|
| 1–3 | 首启自动建集合、打卡推云、新设备全量拉取 |
| 4–5 | 两端各打一天不互相覆盖、**取消打卡后另一端不复活**（墓碑 + 时间戳裁决） |
| 6 | 收藏 / 取消收藏同一套时间戳规则 |
| 7 | 复习记录按 `lastReviewedAt` 取更晚者、换设备拿全量 |
| 8 | 设置项按 `settingsAt` 取更晚者 |
| 9 | 复习记录**分片**落在正确分片、单片体积远低于 512KB 上限 |
| 10 | 脏数据超过 400 条时**分多轮推完**，一条不丢 |
| 11 | 导入备份后能推给云端，不被云端旧值顶回 |
| 12 | 关掉同步开关后不再上送，但本机记录不受影响 |
| **13** | **在途（in-flight）竞态**：请求飞行期间的复习不能被回包吞掉 |
| **14** | **服务端不制造"虚假新版本"**：重复上送同一快照不递增 `reviewRev` |

## 怎么加用例

两处关键接缝：

1. **`wx.cloud.callFunction`** —— `makeDevice()` 里每个设备自带一层包装。
   payload 此时**已经固化**、回包还没进 `applyMerged`，这就是「飞行中」区间。
   【13】就是在这一层包了个 `Promise` + `setTimeout` 注入第二次操作的。
2. **假数据库 `DB`** —— 用例末尾直接用 `dump(openid)` 或遍历 `DB.progress.values()`
   检查云端落库结果（`kind === 'core'` 是核心文档，`kind === 'rs'` 是复习记录分片）。

⚠️ **写时序类用例必须注意**：注入的第二次操作，其 `lastReviewedAt` 必须**严格大于**
上送值（至少隔 1ms），否则 `currentAt > sentAt` 不成立、根本走不到被测分支 ——
**用例会假通过**。【13】里那个 `setTimeout(…, 5)` 不是随便写的。

## 变异测试：验证「用例本身有效」

**全过 ≠ 用例有效。** 一套永远绿的用例等于没写。把修复块换回旧逻辑，
用同一套用例重跑，**必须失败**才证明它真的在守这条路径：

```bash
# 1. 复制 store.js，手工把修复块换回旧逻辑（无条件清 dirty）
cp miniprogram/utils/store.js miniprogram/utils/store.__nofix.js
#    编辑 store.__nofix.js，把 applyMerged 里对 sentVersions 的判断改回
#    `(sentWords || []).forEach(w => { delete data.reviewDirty[w]; })`

# 2. 用变异版跑同一套用例
TEST_STORE="D:/idea/ielts-365/miniprogram/utils/store.__nofix.js" node tools/cloudsync-test/run_tests.js
#    → 期望【13】精准失败（本地被顶回旧值 / dirty 被误清 / 云端 correct 停在 1）

# 3. 用完删掉，别留在仓库里
rm miniprogram/utils/store.__nofix.js
```

⚠️ **变异版必须留在 `miniprogram/utils/` 同目录**，不能挪到仓库外或临时目录 ——
`store.js` 里有 `require('./data.js')`，挪走就解析不到，会直接抛错而不是给出有意义的失败。

2026-09-24 实测结论：旧逻辑下【13】**精准失败 4 项**，新逻辑下全过 ——
用例能抓 bug，不是空测。【14】在变异版下仍通过（它测的是服务端，未被变异影响），符合预期。

## 局限（这些必须靠真机，见同目录 `真机实测清单.md`）

- 假数据库只模拟了 NoSQL 的**关键语义**（建集合、`where().limit().get()`、`doc.set`、
  `doc.update` 的**合并语义**），不覆盖真实权限规则、调用限额、网络失败
- 不覆盖：真机音频播放与**服务器域名校验**、剪切板（导出备份）、冷启动耗时、弱网、多微信号
- 不覆盖 UI：页面渲染、跳转、按钮文案

→ 测试台保证**逻辑正确**，真机实测保证**环境正确**。两者都要做。
