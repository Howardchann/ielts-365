// 52 周课程数据汇总 + 全局常量
const p1 = require('./data-p1.js');
const p2 = require('./data-p2.js');
const p3 = require('./data-p3.js');
const p4 = require('./data-p4.js');
const WEEKS = [].concat(p1, p2, p3, p4);

const TOTAL_DAYS = 364;
const PHASE_NAMES = ['', '阶段一：基础起步', '阶段二：稳步成长', '阶段三：能力强化', '阶段四：雅思冲刺'];
const DOW = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DEFAULT_START = '2026-09-21';

// 周六弹性日固定内容
const SATURDAY = {
  t: '周六弹性复习日',
  obj: '不安排新内容——补进度、巩固本周词汇、或好好休息，三选一。',
  pr: '1) 补进度：本周有落下的学习日就今天补上。2) 巩固：听写本周25词 + 朗读全部例句。3) 休息：只做10分钟随机复习，其余放空。三选一即可，休息不丢人。',
  tip: '语言学习靠的是"持续在场"而非"每天高强度"。弹性日是计划的一部分，不是偷懒——休息也是复习曲线的一环。'
};

// 天序号信息：day 1-364 → { wIdx, k }
function dayInfo(day) {
  if (day < 1 || day > TOTAL_DAYS) return { wIdx: 0, k: 1 };
  return { wIdx: Math.floor((day - 1) / 7), k: ((day - 1) % 7) + 1 };
}

// 取某一天的学习数据（含周六/周日特殊处理）
function getDay(day) {
  const info = dayInfo(day);
  const week = WEEKS[info.wIdx];
  if (!week) return null;
  if (info.k === 6) return Object.assign({ type: 'sat' }, SATURDAY);
  if (info.k === 7) return Object.assign({ type: 'sun' }, week.sun);
  const d = week.d[info.k - 1];
  return d ? Object.assign({ type: 'study' }, d) : null;
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

// 已学词汇池：返回所有已打卡天的词汇（供随机复习）
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
    const week = WEEKS[info.wIdx];
    const d = week && week.d[info.k - 1];
    (d && d.v ? d.v : []).forEach(v => {
      if (!seen[v.w]) { seen[v.w] = 1; pool.push(v); }
    });
  });
  return pool;
}

module.exports = { WEEKS, TOTAL_DAYS, PHASE_NAMES, DOW, DEFAULT_START, SATURDAY, dayInfo, getDay, currentDayFromStart, learnedWords };
