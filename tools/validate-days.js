#!/usr/bin/env node
// tools/validate-days.js —— Day 1-546 全量数据校验（人工测不到的天数用脚本兜底）
//
// 用法：node tools/validate-days.js
// 输出：控制台摘要 + tools/validate-report.txt（有问题才列明细）
//
// 校验范围：
//   ① 周表结构（78 周 × 5 学习日 + 周日自检，字段非空，语法例句存在）
//   ② 坡道与核心词数组（RAMP 合计 8000 / CORE_CNT 合计 1125 / 长度对齐）
//   ③ 8000 词表逐行（单词/词性/释义/例句/音频编号非空，全局查重）
//   ④ 逐天 getDay()：词条数=坡道值、core 标记与 coreCount 一致、无重复词、
//      占位符 {D}{W}{Wp}{P1} 已全部替换、type 与天序对应、字段完整
//   ⑤ 边界与日期换算（dayInfo / currentDayFromStart）

const fs = require('fs');
const path = require('path');
const plan = require('../miniprogram/utils/data.js');

const ROOT = path.resolve(__dirname, '..');
const problems = [];
let checks = 0;
function bad(msg) { problems.push(msg); }
function ok(cond, msg) { checks++; if (!cond) bad(msg); }

// ---------- ① 周表结构 ----------
const WEEKS = plan.WEEKS;
ok(WEEKS.length === 78, `周数=${WEEKS.length}，应为 78`);
WEEKS.forEach((wk, i) => {
  const tag = `周${wk && wk.w}`;
  if (!wk) { bad(`WEEKS[${i}] 为空`); return; }
  ok(wk.w === i + 1, `${tag} 编号不连续（期望 ${i + 1}）`);
  ok(wk.p >= 1 && wk.p <= 4, `${tag} 阶段号非法：${wk.p}`);
  ok(!!wk.theme, `${tag} 缺 theme`);
  ok(Array.isArray(wk.d) && wk.d.length === 5, `${tag} 学习日数量=${wk.d ? wk.d.length : 0}，应为 5`);
  (wk.d || []).forEach((d, k) => {
    const dt = `${tag} Day${i * 7 + k + 1}`;
    if (!d) { bad(`${dt} 数据为空`); return; }
    ok(!!d.t, `${dt} 缺标题 t`);
    ok(!!d.obj, `${dt} 缺目标 obj`);
    ok(!!d.pr, `${dt} 缺练习 pr`);
    ok(!!d.tip, `${dt} 缺技巧 tip`);
    ok(d.g && !!d.g.t && !!d.g.exp, `${dt} 语法点 g.t/g.exp 缺失`);
    ok(d.g && Array.isArray(d.g.ex) && d.g.ex.length > 0 && d.g.ex.every(s => typeof s === 'string' && s.trim()), `${dt} 语法例句 g.ex 缺失或含空串`);
  });
  ok(wk.sun && !!wk.sun.t && !!wk.sun.obj && !!wk.sun.pr && !!wk.sun.tip, `${tag} 周日自检 sun 字段缺失`);
});

// ---------- ② 坡道与核心词 ----------
const RAMP = plan.RAMP, CORE_CNT = plan.CORE_CNT;
ok(RAMP.length === 78, `RAMP 长度=${RAMP.length}，应为 78`);
ok(RAMP.every(n => n > 0), 'RAMP 存在非正值');
const rampSum = RAMP.reduce((a, b) => a + b, 0);
ok(rampSum * 5 === 8000, `RAMP 合计×5天=${rampSum * 5}，应为 8000`);
ok(CORE_CNT.length === 390, `CORE_CNT 长度=${CORE_CNT.length}，应为 390`);
const coreSum = CORE_CNT.reduce((a, b) => a + b, 0);
ok(coreSum === 1125, `CORE_CNT 合计=${coreSum}，应为 1125`);
ok(CORE_CNT.every(n => n >= 0), 'CORE_CNT 存在负值');

// ---------- ③ 词表逐行（与 data.js 同层：require 运行时字符串，按真实 \n/\t 拆分） ----------
const WORD_PARTS = require('../miniprogram/utils/words.js');
const wordLines = (Array.isArray(WORD_PARTS) ? WORD_PARTS : WORD_PARTS.PARTS).join('\n').split('\n');
const seenW = new Map(), seenAi = new Map();
let dupW = [], dupAi = [], badLine = 0;
wordLines.forEach((ln, i) => {
  const row = String(ln).split('\t');
  if (row.length < 5 || row.slice(0, 4).some(s => !String(s || '').trim()) || !(parseInt(row[4], 10) > 0)) { badLine++; if (badLine <= 5) bad(`词表第 ${i + 1} 行字段缺失：${ln.slice(0, 60)}`); return; }
  const w = row[0];
  if (seenW.has(w)) dupW.push(w); else seenW.set(w, 1);
  const ai = row[4];
  if (seenAi.has(ai)) dupAi.push(ai); else seenAi.set(ai, 1);
});
ok(badLine === 0, `词表字段异常 ${badLine} 行`);
ok(wordLines.length === 8000, `词表行数=${wordLines.length}，应为 8000`);
if (dupW.length) bad(`词表重复单词 ${dupW.length} 个（前 10：${dupW.slice(0, 10).join(', ')}）`);
if (dupAi.length) bad(`词表重复音频编号 ${dupAi.length} 个（前 10：${dupAi.slice(0, 10).join(', ')}）`);

// ---------- ④ 逐天 getDay ----------
const PH = /\{(D|W|Wp|P1)\}/;
let studyDays = 0, satDays = 0, sunDays = 0, wordVisits = 0;
for (let day = 1; day <= 546; day++) {
  const info = plan.dayInfo(day);
  ok(info.wIdx * 7 + info.k === day, `dayInfo(${day}) 换算错误 wIdx=${info.wIdx} k=${info.k}`);
  ok(info.k >= 1 && info.k <= 7 && info.wIdx >= 0 && info.wIdx < 78, `dayInfo(${day}) 越界`);
  const d = plan.getDay(day);
  if (!d) { bad(`Day ${day}：getDay 返回 null`); continue; }
  if (info.k === 6) {
    satDays++;
    ok(d.type === 'sat', `Day ${day} type=${d.type}，应为 sat`);
    ok(!!d.t && !!d.obj && !!d.pr && !!d.tip, `Day ${day}（周六）字段缺失`);
    [d.t, d.obj, d.pr, d.tip].forEach(s => { if (PH.test(s)) bad(`Day ${day}（周六）存在未替换占位符：${String(s).slice(0, 40)}`); });
  } else if (info.k === 7) {
    sunDays++;
    ok(d.type === 'sun', `Day ${day} type=${d.type}，应为 sun`);
    ok(!!d.t && !!d.obj && !!d.pr && !!d.tip, `Day ${day}（周日）字段缺失`);
    [d.t, d.obj, d.pr, d.tip].forEach(s => { if (PH.test(s)) bad(`Day ${day}（周日）存在未替换占位符：${String(s).slice(0, 40)}`); });
  } else {
    studyDays++;
    ok(d.type === 'study', `Day ${day} type=${d.type}，应为 study`);
    ok(Array.isArray(d.v) && d.v.length === RAMP[info.wIdx], `Day ${day} 词数=${d.v ? d.v.length : 0}，坡道应为 ${RAMP[info.wIdx]}`);
    ok(d.coreCount + d.extraCount === (d.v ? d.v.length : 0), `Day ${day} core+extra ≠ 词数`);
    const inDay = new Set();
    (d.v || []).forEach((v, i) => {
      wordVisits++;
      if (!v.w || !v.m || !v.p || !v.e || !(v.ai > 0)) { bad(`Day ${day} 第 ${i + 1} 词字段缺失：${JSON.stringify(v).slice(0, 60)}`); return; }
      if (inDay.has(v.w)) bad(`Day ${day} 重复单词：${v.w}`);
      inDay.add(v.w);
      ok(v.core === (i < d.coreCount), `Day ${day} 第 ${i + 1} 词 core 标记与 coreCount 不一致`);
      if (!v.core && i < d.coreCount) bad(`Day ${day} 前 ${d.coreCount} 词中出现非 core`);
    });
    ok(!!d.t && !!d.obj && !!d.pr && !!d.tip && d.g && !!d.g.t, `Day ${day} 教学字段缺失`);
    [d.t, d.obj, d.pr, d.tip].forEach(s => { if (PH.test(s)) bad(`Day ${day} 存在未替换占位符：${String(s).slice(0, 40)}`); });
    ok(/分钟$/.test(d.time || ''), `Day ${day} time 异常：${d.time}`);
  }
}
ok(studyDays === 390, `学习日=${studyDays}，应为 390`);
ok(satDays === 78 && sunDays === 78, `周六=${satDays} 周日=${sunDays}，各应 78`);

// ---------- ⑤ 边界与日期 ----------
ok(plan.dayInfo(0).wIdx === 0 && plan.dayInfo(547).wIdx === 0, 'dayInfo 越界未安全钳制');
ok(plan.getDay(0) !== undefined && plan.getDay(547) !== undefined, 'getDay 越界抛异常（应安全返回）');
const cd = (s) => plan.currentDayFromStart(s);
const tomorrow = new Date(Date.now() + 86400000), today = new Date();
const f = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
ok(cd(f(tomorrow)) === 0, `开始日在明天应得 0，实得 ${cd(f(tomorrow))}`);
ok(cd(f(today)) === 1, `开始日为今天应得 1，实得 ${cd(f(today))}`);
const past = new Date(Date.now() - 200 * 86400000);
ok(cd(f(past)) === 201, `开始日在 200 天前应得 201，实得 ${cd(f(past))}`);
const far = new Date(Date.now() - 1000 * 86400000);
ok(cd(f(far)) === 546, `超 546 天应钳制为 546，实得 ${cd(f(far))}`);

// ---------- 汇总 ----------
const head = [
  '==== Day 1-546 全量数据校验报告 ====',
  `时间：${new Date().toLocaleString('zh-CN')}`,
  `断言通过：${checks - problems.length}/${checks}`,
  `覆盖：学习日 ${studyDays} · 周六 ${satDays} · 周日 ${sunDays} · 词条访问 ${wordVisits} 次`,
  `词表：${wordLines.length} 行，唯一单词 ${seenW.size}，唯一音频编号 ${seenAi.size}`,
  '',
];
let out;
if (!problems.length) {
  out = head.join('\n') + '✅ 全部通过，未发现数据问题。\n';
} else {
  out = head.join('\n') + `❌ 发现 ${problems.length} 个问题：\n` + problems.map((p, i) => `${i + 1}. ${p}`).join('\n') + '\n';
}
fs.writeFileSync(path.join(__dirname, 'validate-report.txt'), out);
console.log(out.split('\n').slice(0, 8).join('\n'));
console.log(problems.length ? `❌ ${problems.length} 个问题，明细见 tools/validate-report.txt` : '✅ 全部通过（tools/validate-report.txt）');
