// 云同步端到端测试台
// 做法：内存假数据库 + 把 wx-server-sdk 重定向到假实现，
//      再把 miniprogram/utils/store.js 与 cloudfunctions/sync/index.js 接起来跑，
//      用两个独立 store 实例模拟两台设备共享同一份云端数据。
// 目的：验证「合并规则」在多设备交错写入下不会丢进度 / 不会复活取消掉的打卡。
//
// 跑法：node tools/cloudsync-test/run_tests.js
//      （仓库根目录由 __dirname 上溯两级推出，本文件可整目录搬动）
// 变异测试：TEST_STORE=<另一份 store.js 的绝对路径> node tools/cloudsync-test/run_tests.js
//          用来验证「用例本身有效」——把修复块换回旧逻辑，用例必须失败。

const path = require('path');
const Module = require('module');

// 本文件位于 <repo>/tools/cloudsync-test/ → 上溯两级即仓库根
const ROOT = path.resolve(__dirname, '..', '..');
const SYNC_FN = path.join(ROOT, 'cloudfunctions/sync/index.js');
const STORE_PATH = process.env.TEST_STORE
  ? path.resolve(process.env.TEST_STORE)
  : path.join(ROOT, 'miniprogram/utils/store.js');

// ---------------- 假数据库（模拟云开发 NoSQL 的关键语义） ----------------
const DB = {};            // collection -> Map(_id -> doc)
let currentOpenid = '';

function collErr() { const e = new Error('database collection not exists'); e.errMsg = 'database collection not exists -502005'; return e; }
function docErr() { const e = new Error('document not exists'); e.errMsg = 'document.get:fail document not exists'; return e; }

function applyPatch(doc, patch) {
  Object.keys(patch).forEach(k => {
    const segs = k.split('.');
    let cur = doc;
    for (let i = 0; i < segs.length - 1; i++) {
      if (!cur[segs[i]] || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {};
      cur = cur[segs[i]];
    }
    cur[segs[segs.length - 1]] = patch[k];
  });
}
function col(name) {
  if (!DB[name]) throw collErr();
  return DB[name];
}

const fakeSdk = {
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  init() {},
  getWXContext() { return { OPENID: currentOpenid }; },
  database() {
    return {
      createCollection: async (name) => {
        if (DB[name]) { const e = new Error('collection already exists'); e.errMsg = 'collection already exists'; throw e; }
        DB[name] = new Map();
        return { requestId: 'fake' };
      },
      collection: (name) => ({
        where: (w) => ({
          limit: (n) => ({
            get: async () => {
              const c = col(name);
              const data = [...c.values()].filter(d => Object.keys(w).every(k => d[k] === w[k])).slice(0, n);
              return { data: JSON.parse(JSON.stringify(data)) };
            },
          }),
        }),
        doc: (id) => ({
          set: async ({ data }) => {
            const c = col(name);
            c.set(id, Object.assign({ _id: id }, JSON.parse(JSON.stringify(data))));
            return { _id: id };
          },
          update: async ({ data }) => {
            const c = col(name);
            const cur = c.get(id);
            if (!cur) throw docErr();
            applyPatch(cur, JSON.parse(JSON.stringify(data)));
            return { stats: { updated: 1 } };
          },
        }),
      }),
    };
  },
};

// 把 require('wx-server-sdk') 重定向到假实现（不动项目目录、不装依赖）
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === 'wx-server-sdk') return path.join(__dirname, 'fake-sdk.js');
  return origResolve.apply(this, arguments);
};
require.cache[path.join(__dirname, 'fake-sdk.js')] = { id: 'fake-sdk', filename: 'fake-sdk', loaded: true, exports: fakeSdk };

const syncMain = require(SYNC_FN).main;

// ---------------- 设备（各自独立的本地存储 + 同一个云） ----------------
function makeDevice(name, openid) {
  const storage = {};
  const wx = {
    getStorageSync: (k) => storage[k],
    setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
    removeStorageSync: (k) => { delete storage[k]; },
    cloud: {
      callFunction: ({ name, data }) => new Promise((resolve, reject) => {
        if (name !== 'sync') return reject(new Error('unknown function ' + name));
        currentOpenid = openid;
        Promise.resolve(syncMain(data)).then(result => resolve({ result }), reject);
      }),
    },
  };
  delete require.cache[require.resolve(STORE_PATH)];
  const store = require(STORE_PATH);
  return { name, openid, wx, storage, store };
}

// ---------------- 断言 ----------------
let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.log('  \u2717 ' + msg + (extra !== undefined ? ('  \u2192 ' + JSON.stringify(extra)) : '')); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function dump(id) { const c = DB.progress; return c ? c.get(id) : undefined; }

// ---------------- 主流程 ----------------
(async () => {
  const OPENID = 'oABCDEFGHIJKLMNOPQRSTUVWXYZ12';
  const d1 = makeDevice('设备1', OPENID);
  const d2 = makeDevice('设备2', OPENID);

  const use = (dev) => { global.wx = dev.wx; return dev; };

  console.log('\n【1】首次使用：集合不存在时应自动创建');
  use(d1); d1.store.init(); await sleep(80);
  let core = dump(OPENID);
  ok(!!core, '启动即自动创建了云端记录（集合不存在 → 自动建 → 重试成功）', core);
  ok(core && core.kind === 'core', '记录 kind=core', core && core.kind);

  console.log('\n【2】设备1 打卡 w1d1 并同步');
  use(d1); const t1 = Date.now(); d1.store.toggleCheck(1, 1);
  let r = await d1.store.syncNow();
  ok(r.ok, '同步成功：' + r.msg, r);
  core = dump(OPENID);
  ok(core.checkedDays && core.checkedDays.w1d1 > 1e12, '云端拿到带时间戳的打卡', core.checkedDays);

  console.log('\n【3】设备2 全新安装，拉取设备1 的进度');
  use(d2); d2.store.init(); await sleep(80);
  r = await d2.store.syncNow();
  ok(r.ok, '同步成功：' + r.msg, r);
  ok(d2.store.isChecked(1, 1), '设备2 已拿到 w1d1 的打卡');
  ok(d2.store.checkedCount() === 1, '设备2 完成天数 = 1', d2.store.checkedCount());

  console.log('\n【4】设备2 打卡 w1d2 → 设备1 拉取，两天都应存在');
  use(d2); d2.store.toggleCheck(1, 2); r = await d2.store.syncNow(); await sleep(5);
  use(d1); r = await d1.store.syncNow();
  ok(r.ok, '设备1 同步成功：' + r.msg, r);
  ok(d1.store.isChecked(1, 1) && d1.store.isChecked(1, 2), '设备1 同时拥有 w1d1 与 w1d2', { c1: d1.store.isChecked(1,1), c2: d1.store.isChecked(1,2) });
  core = dump(OPENID);
  ok(Object.keys(core.checkedDays).length === 2, '云端两天都在', core.checkedDays);

  console.log('\n【5】设备2 取消 w1d1 → 设备1 本地仍有旧打卡，不能复活它');
  use(d2); await sleep(5); d2.store.toggleCheck(1, 1);
  ok(!d2.store.isChecked(1, 1), '设备2 本地已取消');
  r = await d2.store.syncNow(); await sleep(5);
  core = dump(OPENID);
  ok(!core.checkedDays.w1d1, '云端 w1d1 已取消', core.checkedDays);
  ok(core.uncheckedDays && core.uncheckedDays.w1d1 > 1e12, '云端留下取消时间戳（墓碑）', core.uncheckedDays);

  use(d1); r = await d1.store.syncNow();
  ok(r.ok, '设备1 同步成功：' + r.msg, r);
  ok(!d1.store.isChecked(1, 1), '设备1 的旧打卡没有被复活');
  ok(d1.store.isChecked(1, 2), '设备1 的 w1d2 仍在');
  core = dump(OPENID);
  ok(!core.checkedDays.w1d1, '云端未被设备1 的旧数据顶回', core.checkedDays);

  console.log('\n【6】收藏词 + 取消收藏（同一套时间戳规则）');
  use(d1); await sleep(5);
  d1.store.toggleStar({ w: 'get up', m: '起床', p: 'v', e: 'I get up at six.' });
  r = await d1.store.syncNow(); await sleep(5);
  use(d2); r = await d2.store.syncNow();
  ok(d2.store.isStarred('get up'), '设备2 拉到收藏词');
  await sleep(5); d2.store.toggleStar({ w: 'get up', m: '起床', p: 'v', e: 'I get up at six.' });
  r = await d2.store.syncNow(); await sleep(5);
  use(d1); r = await d1.store.syncNow();
  ok(!d1.store.isStarred('get up'), '设备1 的旧收藏没有复活');
  core = dump(OPENID);
  ok(Object.keys(core.unstarredWords || {}).indexOf('get up') >= 0, '云端留下取消收藏墓碑', core.unstarredWords);

  console.log('\n【7】复习记录：按单词取更晚的一条，且换设备能拿到全量');
  use(d1); await sleep(5); d1.store.reviewWord('apple', true);
  r = await d1.store.syncNow(); await sleep(5);
  ok(r.ok, '设备1 推送复习记录成功：' + r.msg, r);
  const revAfterD1 = (d1.store.cloudStatus().rev);
  ok(revAfterD1 > 0, 'reviewRev 已递增（' + revAfterD1 + '）');

  use(d2); await sleep(5); r = await d2.store.syncNow();
  ok(d2.store.getReviewStats('apple').lastReviewedAt > 1e12, '设备2 全量拉到 apple 的复习记录', d2.store.getReviewStats('apple'));

  await sleep(5); d2.store.reviewWord('apple', false);   // 更晚 → 应胜出
  r = await d2.store.syncNow(); await sleep(5);
  use(d1); r = await d1.store.syncNow();
  const s = d1.store.getReviewStats('apple');
  ok(s.wrong === 1 && s.level === 0, '设备1 拿到设备2 更晚的记录（wrong=1, level=0）', s);

  console.log('\n【8】设置项：settingsAt 更晚者胜');
  use(d1); await sleep(5); d1.store.set('rate', 1.1); r = await d1.store.syncNow(); await sleep(10);
  use(d2); r = await d2.store.syncNow();
  ok(Math.abs(d2.store.get('rate') - 1.1) < 1e-9, '设备2 拿到 rate=1.1', d2.store.get('rate'));
  await sleep(10); d2.store.set('rate', 1.25);   // 更晚 → 应胜出
  r = await d2.store.syncNow(); await sleep(10);
  use(d1); r = await d1.store.syncNow();
  ok(Math.abs(d1.store.get('rate') - 1.25) < 1e-9, '设备1 被更晚的 rate=1.25 更新', d1.store.get('rate'));

  console.log('\n【9】复习记录分片：8000 词不会撑爆单条记录上限');
  function shardOf(word) { let h = 0; for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0; return h % 8; }
  use(d1);
  const words = [];
  for (let i = 0; i < 30; i++) { const w = 'word' + i; words.push(w); d1.store.reviewWord(w, i % 2 === 0); }
  r = await d1.store.syncNow(); await sleep(5);
  const rsDocs = [...DB.progress.values()].filter(d => d.kind === 'rs');
  ok(rsDocs.length > 1, '数据被分到多个分片（' + rsDocs.length + ' 片）', rsDocs.map(d => d._id));
  let misplaced = [];
  rsDocs.forEach(d => Object.keys(d.stats || {}).forEach(w => { if (shardOf(w) !== d.i) misplaced.push(w + '@' + d.i + '(应为' + shardOf(w) + ')'); }));
  ok(misplaced.length === 0, '每个单词都落在正确的分片里', misplaced);
  const totalInShards = rsDocs.reduce((n, d) => n + Object.keys(d.stats || {}).length, 0);
  ok(totalInShards === 31, '分片里应有 31 条记录（apple + 30 个），实际 ' + totalInShards);
  const maxShardBytes = Math.max(...rsDocs.map(d => JSON.stringify(d.stats).length));
  ok(maxShardBytes < 512 * 1024, '最大分片体积 ' + maxShardBytes + ' 字节，远低于单条记录上限');
  // 8000 词的全量估算
  const avg = totalInShards ? Array.from(DB.progress.values()).filter(d => d.kind === 'rs').reduce((n, d) => n + JSON.stringify(d.stats).length, 0) / totalInShards : 0;
  console.log('    参考：单条复习记录约 ' + Math.round(avg) + ' 字节 → 8000 词全量约 ' + (avg * 8000 / 1024).toFixed(0) + 'KB，分 8 片后每片约 ' + (avg * 8000 / 1024 / 8).toFixed(0) + 'KB');

  console.log('\n【10】脏数据上限：单次超过 400 个单词要分多轮推完');
  use(d1);
  for (let i = 0; i < 500; i++) d1.store.reviewWord('bulk' + i, true);
  const before = d1.store.cloudStatus().pending;
  ok(before === 500, '待推队列 500 条', before);
  r = await d1.store.syncNow();
  const afterFirst = d1.store.cloudStatus().pending;
  ok(afterFirst === 100, '第一轮推完 400 条，剩 100 条待推', afterFirst);
  await new Promise(res => { let n = 0; const tick = () => { if (d1.store.cloudStatus().pending === 0 || ++n > 60) return res(); setTimeout(tick, 150); }; tick(); });
  const afterAll = d1.store.cloudStatus().pending;
  ok(afterAll === 0, '后续轮次把剩余的都推完了（待推 ' + afterAll + ' 条）', afterAll);
  const bulkInCloud = [...DB.progress.values()].filter(d => d.kind === 'rs')
    .reduce((n, d) => n + Object.keys(d.stats || {}).filter(w => w.indexOf('bulk') === 0).length, 0);
  ok(bulkInCloud === 500, '云端收到全部 500 条 bulk 记录，实际 ' + bulkInCloud);

  console.log('\n【11】导入备份后能推给云端（不会被云端旧值顶回去）');
  use(d2);
  const beforeImp = d2.store.getReviewStats('hello').lastReviewedAt;
  const fakeBackup = JSON.stringify({
    app: 'ielts-365', v: 3, data: {
      checkedDays: { w2d1: Date.now() }, starredWords: [{ w: 'hello', m: '你好', p: 'int.', e: 'Hello!' }],
      reviewStats: { hello: { correct: 5, wrong: 0, level: 5, nextReviewAt: Date.now() + 86400000, lastReviewedAt: Date.now() } },
    },
  });
  const imp = d2.store.importBackup(fakeBackup, 'merge');
  ok(imp.addedDays >= 1, '导入新增打卡 ' + imp.addedDays + ' 天');
  ok(d2.store.isStarred('hello'), '导入后设备2 本地已有该收藏词');
  ok(imp.addedWords === 1, '导入新增收藏词 ' + imp.addedWords + ' 个（无 ts 字段的旧备份也要算数）');
  r = await d2.store.syncNow(); await sleep(5);
  use(d1); r = await d1.store.syncNow();
  ok(d1.store.getReviewStats('hello').correct === 5, '设备1 拿到导入进来的复习记录', d1.store.getReviewStats('hello'));
  ok(d1.store.isChecked(2, 1), '设备1 拿到导入进来的打卡');
  ok(d1.store.isStarred('hello'), '设备1 拿到导入进来的收藏词');

  console.log('\n【12】关闭云同步后不再上送');
  use(d2); d2.store.setSyncEnabled(false);
  const cntBefore = [...DB.progress.values()].filter(d => d.kind === 'rs').reduce((n, d) => n + Object.keys(d.stats || {}).length, 0);
  d2.store.reviewWord('zzzoffline', true);
  r = await d2.store.syncNow();
  ok(!r.ok, '关闭后同步被拒绝：' + r.msg, r);
  const cntAfter = [...DB.progress.values()].filter(d => d.kind === 'rs').reduce((n, d) => n + Object.keys(d.stats || {}).length, 0);
  ok(cntBefore === cntAfter, '云端记录数未变（' + cntAfter + '）');
  ok(d2.store.getReviewStats('zzzoffline').correct === 1, '本地仍然记住了（关同步不影响本机）');

  // 【A7】把开关重新打开 → 内部会直接 syncNow()，关闭期间攒下的 dirty 必须一次补齐
  d2.store.setSyncEnabled(true); await sleep(50);
  const cloudStats = {};
  [...DB.progress.values()].filter(d => d.kind === 'rs').forEach(d => Object.assign(cloudStats, d.stats || {}));
  ok(cloudStats['zzzoffline'] && cloudStats['zzzoffline'].correct === 1,
    '重新打开开关后自动补齐：关闭期间攒下的复习记录已上云', cloudStats['zzzoffline']);
  const offAll = [...DB.progress.values()].filter(d => d.kind === 'rs').reduce((n, d) => n + Object.keys(d.stats || {}).length, 0);
  ok(offAll === cntBefore + 1, '云端记录数已由 ' + cntBefore + ' 变为 ' + offAll);
  ok(d2.store.cloudStatus().pending === 0, '补齐后待推队列清空', d2.store.cloudStatus());

  console.log('\n【13】在途（in-flight）竞态：请求飞行期间的复习不能被回包吞掉');
  use(d1); await sleep(5);
  r = await d1.store.syncNow();
  ok(d1.store.cloudStatus().pending === 0, '起点：待推队列已清空', d1.store.cloudStatus());

  d1.store.reviewWord('race', true);                     // 第一次复习 —— 这一版会被上送
  const sentVer = Object.assign({}, d1.store.getReviewStats('race'));
  ok(sentVer.correct === 1 && sentVer.level === 1, '起点：correct=1 / level=1', sentVer);

  // 在 wx.cloud.callFunction 上做手脚：payload 此时已固化（= 请求已发出），
  // 但回包还没进 applyMerged —— 这个区间就是「飞行中」。
  // 注入放在 setTimeout 里，保证第二次复习的 lastReviewedAt 严格大于上送值。
  const origCall = d1.wx.cloud.callFunction;
  let injected = false;
  d1.wx.cloud.callFunction = ({ name, data }) => {
    const p = origCall({ name, data });
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (data && data.reviewDirty && data.reviewDirty.race) {
          d1.store.reviewWord('race', true);             // 飞行期间又复习了同一个词
          injected = true;
        }
        p.then(resolve, reject);                         // 注入完才放行回包
      }, 5);
    });
  };

  r = await d1.store.syncNow();
  d1.wx.cloud.callFunction = origCall;
  ok(injected, '已在请求飞行期间注入第二次复习');
  ok(r.ok, '同步成功：' + r.msg, r);

  const afterRace = d1.store.getReviewStats('race');
  ok(afterRace.lastReviewedAt > sentVer.lastReviewedAt,
    '回包未把飞行期间的新版本顶回旧值',
    { 上送: sentVer.lastReviewedAt, 现状: afterRace.lastReviewedAt });
  ok(afterRace.correct === 2 && afterRace.level === 2,
    '本地保留第二次的结果（correct=2 / level=2）', afterRace);
  ok(d1.store.cloudStatus().pending === 1,
    '该词仍留在待推队列（dirty 未被误清）', d1.store.cloudStatus());

  r = await d1.store.syncNow(); await sleep(5);
  ok(r.ok, '续推成功：' + r.msg, r);
  const cloudRace = [...DB.progress.values()]
    .filter(d => d.kind === 'rs')
    .map(d => (d.stats || {}).race)
    .filter(Boolean)[0];
  ok(!!cloudRace, '云端最终收到该词 —— 飞行期间的复习没有永久丢失', cloudRace);
  ok(cloudRace && cloudRace.correct === 2, '云端 correct=2（两次复习都记上了）', cloudRace);

  console.log('\n【14】服务端不制造"虚假新版本"：重复上送同一快照不递增 reviewRev');
  use(d1); await sleep(5);
  const revBeforeDup = dump(OPENID).reviewRev;
  const nowDup = Date.now();
  const dupEntry = { correct: 3, wrong: 0, level: 3, nextReviewAt: nowDup + 86400000, lastReviewedAt: nowDup };
  const dupPayload = { action: 'merge', core: {}, reviewDirty: { dupword: dupEntry }, reviewRev: 0 };
  await d1.wx.cloud.callFunction({ name: 'sync', data: dupPayload });
  const revAfterFirstDup = dump(OPENID).reviewRev;
  ok(revAfterFirstDup === revBeforeDup + 1,
    '首次上送（真实变化）→ reviewRev 递增 ' + revBeforeDup + ' → ' + revAfterFirstDup);
  const resDup = await d1.wx.cloud.callFunction({ name: 'sync', data: dupPayload });
  const revAfterSecondDup = dump(OPENID).reviewRev;
  ok(revAfterSecondDup === revAfterFirstDup,
    '重复上送同一快照 → reviewRev 不再递增（仍为 ' + revAfterSecondDup + '）');
  ok(resDup.result && Object.keys(resDup.result.reviewPatch || {}).length === 0,
    '重复上送不再返回 patch（旧设备重传不会逼其他设备回全量）',
    resDup.result && resDup.result.reviewPatch);

  console.log('\n【15】清除学习记录（从0开始）：墓碑/零记录压制，两台设备都收敛到空');
  use(d1); await sleep(5);
  // 造进度：打卡 + 收藏 + 复习（复用前面章节已同步的部分进度，如 apple/hello）
  d1.store.toggleCheck(3, 1); d1.store.toggleCheck(3, 2);
  d1.store.toggleStar({ w: 'resetword', m: '重置词', p: 'n.', e: 'Reset word.' });
  d1.store.reviewWord('resetword', true);
  await d1.store.syncNow(); await sleep(10);
  ok(d1.store.checkedCount() > 0 && d1.store.isStarred('resetword'),
    '起点：设备1 有打卡 ' + d1.store.checkedCount() + ' 天且有收藏/复习记录');
  // 清除
  const resetAt = d1.store.getReviewStats('resetword').lastReviewedAt;
  d1.store.resetProgress();
  ok(d1.store.checkedCount() === 0, '重置后本地打卡数 = 0');
  ok(!d1.store.isStarred('resetword'), '重置后本地收藏已清空');
  const zr = d1.store.getReviewStats('resetword');
  ok(zr.correct === 0 && zr.wrong === 0 && zr.lastReviewedAt >= resetAt,
    '重置后复习记录变为零记录（压制云端用）', zr);
  ok(d1.store.activeReviewCount() === 0, '有效复习计数 = 0（纯零记录不计入）');
  // 上云（可能需要多轮：墓碑+零记录都走 dirty 通道）
  await new Promise(res => { let n = 0; const tick = () => { if (d1.store.cloudStatus().pending === 0 || ++n > 60) return res(); setTimeout(tick, 150); }; tick(); });
  const allRs = {};
  [...DB.progress.values()].filter(d => d.kind === 'rs').forEach(d => Object.assign(allRs, d.stats || {}));
  const nonZero = Object.keys(allRs).filter(w => (allRs[w].correct || 0) + (allRs[w].wrong || 0) > 0);
  ok(nonZero.length === 0, '云端所有复习记录都被零记录压平（非零记录 ' + nonZero.length + ' 条）', nonZero.slice(0, 5));
  const coreDoc = [...DB.progress.values()].find(d => d.kind === 'core');
  const checkedKeys = Object.keys((coreDoc && coreDoc.checkedDays) || {});
  const uncheckedWins = checkedKeys.filter(k => {
    const c = (coreDoc.checkedDays[k] || 0), u = (coreDoc.uncheckedDays || {})[k] || 0;
    return c > u;   // 仍有"打卡时间晚于取消时间"的天 = 未压住
  });
  ok(uncheckedWins.length === 0, '云端所有打卡都被取消墓碑压住', uncheckedWins.slice(0, 5));
  // 设备2 同步 → 收敛到空
  use(d2); await sleep(10);
  await d2.store.syncNow(); await sleep(50); await d2.store.syncNow(); await sleep(10);
  ok(d2.store.checkedCount() === 0, '设备2 同步后打卡数也归 0');
  ok(!d2.store.isStarred('resetword'), '设备2 同步后收藏也清空');
  const d2r = d2.store.getReviewStats('resetword');
  ok(d2r.correct === 0 && d2r.wrong === 0, '设备2 同步后复习记录也归零', d2r);
  ok(d2.store.activeReviewCount() === 0, '设备2 有效复习计数 = 0');
  // 重置后重新打卡要能正常工作（墓碑被更晚的时间戳压过）
  use(d1); await sleep(5);
  d1.store.toggleCheck(1, 1); await d1.store.syncNow(); await sleep(10);
  use(d2); await sleep(5); await d2.store.syncNow(); await sleep(10);
  ok(d1.store.isChecked(1, 1) && d2.store.isChecked(1, 1), '重置后重新打卡，两台设备都正常生效');

  console.log('\n============================');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('============================\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试脚本异常：', e); process.exit(2); });
