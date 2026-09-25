// utils/data.js —— 课程数据汇总 + 词表装配（18 个月 / 78 周版）
//
// 结构说明
// ────────
// · utils/data-p1..p6.js  只存**教学内容**：周主题、每日标题/目标、语法或技能点、练习、技巧、周日自检
// · utils/words.js        8000 词表，顺序＝课程顺序（每天：核心主题词 → 扩展词）
// · 每周词量由 RAMP 决定
//
// 18 个月排法
// ───────────
// 原 52 周课程每 2 周后插 1 个「巩固周」，共 52 + 26 = 78 周（546 天，390 个学习日）。
// 巩固周不引入新语法，专注复习前两周的词 + 一个词汇/输出技能点。
// 两条坡道：新课周 14→30 词/天，巩固周 11→25 词/天，合计恰好 8000。
//
// 为什么词表按课程顺序排列：这样「某一天要用哪些词」就是一整段连续区间，
// 偏移量在启动时一次算好（DAY_OFF），运行时零查表开销。
// 每个词带 ai（音频编号）——音频文件名用的是词频序排名，与本表顺序不同，故必须显式携带。
const p1 = require('./data-p1.js');
const p2 = require('./data-p2.js');
const p3 = require('./data-p3.js');
const p4 = require('./data-p4.js');
const p5 = require('./data-p5.js');
const p6 = require('./data-p6.js');
const WORD_PARTS = require('./words.js');

const WEEKS = [].concat(p1, p2, p3, p4, p5, p6);
const TOTAL_DAYS = 546;
const PHASE_NAMES = ['', '阶段一：基础起步', '阶段二：稳步成长', '阶段三：能力强化', '阶段四：雅思冲刺'];
const DOW = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
// 默认开始日期：动态取「下一个周一」（今天恰为周一则取今天）。
// 上线后新用户进「准备期」，从最近的整周开始；老用户已存有 startDate，不受影响。
// （历史默认值 2026-09-21 为开发者私有计划日，已废弃，见 CHANGELOG 09-25）
const DEFAULT_START = (() => {
  const n = new Date();
  const d = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7)); // getDay(): 周日=0 → 距下周一 (8-getDay())%7 天
  const p = x => ('0' + x).slice(-2);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
})();

// 每周每日新词数（双坡道：新课周 14→30，巩固周 11→25，总量 8000）
const RAMP = [
  14, 14, 11, 15, 15, 12, 15, 16, 12, 16, 16, 13, 17,
  17, 13, 17, 17, 14, 18, 18, 14, 18, 19, 15, 19, 19,
  15, 20, 20, 16, 20, 21, 16, 21, 21, 17, 22, 22, 17,
  22, 22, 18, 23, 23, 18, 23, 24, 19, 24, 24, 19, 25,
  25, 20, 25, 26, 20, 26, 26, 21, 27, 27, 21, 27, 27,
  22, 28, 28, 22, 28, 29, 23, 29, 29, 23, 30, 25, 30,
];

// 390 个学习日的核心词数（原有主题词；其余为扩展词。合计 1125）
// 巩固周全部为扩展词，故对应位置为 0
const CORE_CNT = [
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  0, 0, 0, 0, 0, 5, 5, 5, 3, 4, 5, 5, 5, 5, 4, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 5, 4, 5, 5, 3,
  5, 5, 5, 4, 4, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 4, 5, 5, 5, 4, 0, 0, 0, 0, 0, 4, 5, 4, 5, 4, 5, 5, 5, 5, 4, 0, 0, 0, 0, 0,
  4, 5, 5, 4, 5, 5, 5, 5, 4, 4, 0, 0, 0, 0, 0, 4, 5, 5, 5, 4, 5, 5, 5, 4, 5, 0, 0, 0, 0, 0, 5, 5, 5, 5, 4, 3, 4, 4, 5, 5,
  0, 0, 0, 0, 0, 4, 4, 5, 5, 5, 4, 4, 3, 5, 4, 0, 0, 0, 0, 0, 5, 4, 5, 5, 5, 4, 4, 5, 5, 5, 0, 0, 0, 0, 0, 5, 4, 5, 5, 5,
  5, 5, 5, 5, 4, 0, 0, 0, 0, 0, 5, 5, 3, 5, 5, 4, 5, 5, 5, 4, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 3, 5, 0, 0, 0, 0, 0,
  4, 5, 5, 4, 5, 5, 5, 4, 4, 4, 0, 0, 0, 0, 0, 5, 5, 4, 4, 4, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4,
  0, 0, 0, 0, 0, 1, 0, 0, 3, 5, 4, 2, 3, 4, 5, 0, 0, 0, 0, 0, 4, 5, 1, 3, 5, 4, 3, 3, 5, 3, 0, 0, 0, 0, 0, 3, 5, 2, 5, 1,
  1, 2, 5, 2, 4, 0, 0, 0, 0, 0, 4, 5, 3, 4, 5, 4, 4, 4, 2, 4, 0, 0, 0, 0, 0, 3, 5, 3, 3, 4, 4, 3, 5, 3, 4, 0, 0, 0, 0, 0,
  3, 3, 4, 3, 3, 3, 0, 2, 2, 4, 0, 0, 0, 0, 0, 4, 5, 4, 1, 2, 0, 0, 0, 0, 0, 4, 4, 3, 2, 4,
];

const WORD_TOTAL = 8000;
const WEEK_COUNT = 78;
const P1_TOTAL = RAMP.slice(0, 13).reduce((a, b) => a + b, 0) * 5;   // 前 13 周累计词数

// 每个学习日的词表起始偏移（0 基），启动时算一次
const DAY_OFF = [];
(function () {
  let off = 0;
  for (let w = 0; w < WEEK_COUNT; w++) {
    for (let k = 0; k < 5; k++) { DAY_OFF.push(off); off += RAMP[w]; }
  }
})();

// 词表延迟解析：8000 行只在首次取词时拆一次，避免启动开销
let _words = null;
function allWords() {
  if (_words) return _words;
  const lines = WORD_PARTS.join('\n').split('\n');
  const out = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].split('\t');
    out[i] = { w: c[0], p: c[1], m: c[2], e: c[3], ai: c[4] | 0 };
  }
  _words = out;
  return out;
}

// 占位符替换：{D} 当日词数 {W} 本周词数 {Wp} 上周词数 {P1} 前 13 周累计
function fill(s, n, wk, wp) {
  if (!s) return s;
  return String(s)
    .replace(/\{D\}/g, n)
    .replace(/\{Wp\}/g, wp)
    .replace(/\{W\}/g, wk)
    .replace(/\{P1\}/g, P1_TOTAL);
}

function fillBlock(o, n, wk, wp) {
  const r = {};
  for (const k in o) r[k] = typeof o[k] === 'string' ? fill(o[k], n, wk, wp) : o[k];
  return r;
}

// 周六弹性日固定内容（词数为相对当周的占位符）
const SATURDAY = {
  t: '弹性复习日',
  obj: '不安排新内容——补进度、巩固本周词汇、或好好休息，三选一。',
  pr: '1) 补进度：本周有落下的学习日就今天补上。2) 巩固：听写本周{W}词 + 朗读全部例句。3) 休息：只做10分钟随机复习，其余放空。三选一即可，休息不丢人。',
  tip: '语言学习靠的是"持续在场"而非"每天高强度"。弹性日是计划的一部分，不是偷懒——休息也是复习曲线的一环。',
};

// 天序号信息：day 1-546 → { wIdx, k }
function dayInfo(day) {
  if (day < 1 || day > TOTAL_DAYS) return { wIdx: 0, k: 1 };
  return { wIdx: Math.floor((day - 1) / 7), k: ((day - 1) % 7) + 1 };
}

// 由学习日序号取该日词条
function wordsOfStudyDay(di, perDay) {
  const start = DAY_OFF[di];
  const ws = allWords().slice(start, start + perDay);
  const cn = CORE_CNT[di] || 0;
  for (let i = 0; i < ws.length; i++) {
    ws[i] = { w: ws[i].w, m: ws[i].m, p: ws[i].p, e: ws[i].e, ai: ws[i].ai, core: i < cn };
  }
  return ws;
}

// 取某一天的学习数据（含周六/周日特殊处理）
function getDay(day) {
  const info = dayInfo(day);
  const week = WEEKS[info.wIdx];
  if (!week) return null;
  const perDay = RAMP[info.wIdx];
  const wkTotal = perDay * 5;
  const prevTotal = info.wIdx > 0 ? RAMP[info.wIdx - 1] * 5 : wkTotal;

  if (info.k === 6) return Object.assign({ type: 'sat' }, fillBlock(SATURDAY, perDay, wkTotal, prevTotal));
  if (info.k === 7) return Object.assign({ type: 'sun' }, fillBlock(week.sun || {}, perDay, wkTotal, prevTotal));

  const d = week.d[info.k - 1];
  if (!d) return null;
  const di = info.wIdx * 5 + (info.k - 1);
  const v = wordsOfStudyDay(di, perDay);
  const coreCount = CORE_CNT[di] || 0;
  return {
    type: 'study',
    t: d.t,
    obj: fill(d.obj, perDay, wkTotal, prevTotal),
    pr: fill(d.pr, perDay, wkTotal, prevTotal),
    tip: fill(d.tip, perDay, wkTotal, prevTotal),
    g: d.g,
    time: Math.round((25 + perDay * 1.2) / 5) * 5 + '分钟',
    words: perDay,
    coreCount: coreCount,
    extraCount: perDay - coreCount,
    v: v,
  };
}

// 由开始日期计算今天对应计划第几天（1 起；0 表示尚未开始）
function currentDayFromStart(startDateStr) {
  const sd = new Date(startDateStr + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((today - sd) / 86400000);
  if (diff < 0) return 0;
  return Math.min(diff + 1, TOTAL_DAYS);
}

// 已学词汇池：返回所有已打卡学习日的词汇（供随机复习）
function learnedWords(checkedDays) {
  const pool = [];
  const seen = {};
  Object.keys(checkedDays || {}).forEach(key => {
    if (!checkedDays[key]) return;
    const m = /^w(\d+)d(\d+)$/.exec(key);
    if (!m) return;
    const day = (parseInt(m[1], 10) - 1) * 7 + parseInt(m[2], 10);
    const info = dayInfo(day);
    if (info.k > 5) return;
    const di = info.wIdx * 5 + (info.k - 1);
    const ws = wordsOfStudyDay(di, RAMP[info.wIdx]);
    ws.forEach(v => {
      if (!seen[v.w]) { seen[v.w] = 1; pool.push(v); }
    });
  });
  return pool;
}

// 语音试听样句：取 Day 1 首个词的例句（走真实音频链路）
function demo() {
  const d = getDay(1);
  const w = d && d.v && d.v[0];
  return w ? { word: w.w, example: w.e, ai: w.ai } : null;
}

module.exports = {
  WEEKS, TOTAL_DAYS, PHASE_NAMES, DOW, DEFAULT_START, SATURDAY,
  RAMP, CORE_CNT, WORD_TOTAL, WEEK_COUNT, P1_TOTAL,
  dayInfo, getDay, currentDayFromStart, learnedWords, allWords, demo,
};
