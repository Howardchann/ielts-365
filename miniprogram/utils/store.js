// utils/store.js —— 本地进度管理 + 文件备份/恢复
// 个人版不使用云开发/云同步：所有学习进度保存在本机。
// 跨设备/换机请在设置页导出备份 JSON，必要时再导入恢复。

const KEY = 'ielts-365-store';
const plan = require('./data.js');
const DEFAULT_INTERVALS = [1, 2, 4, 7, 14, 30, 60, 120];
const DAY_KEY = /^w\d{1,2}d[1-7]$/;
const BACKUP_TAG = 'ielts-365';
const BACKUP_VERSION = 2;

const defaults = () => ({
  startDate: plan.DEFAULT_START, checkedDays: {}, starredWords: [], reviewStats: {},
  rate: 0.9, accent: 'us', engine: 'online', updatedAt: 0
});
let data = defaults(), listeners = [];

function loadLocal() {
  try { const saved = wx.getStorageSync(KEY); if (saved && typeof saved === 'object') data = Object.assign(defaults(), saved); } catch (e) {}
}
function saveLocal() { try { wx.setStorageSync(KEY, data); } catch (e) {} }
function emit() { listeners.slice().forEach(fn => { try { fn(data); } catch (e) {} }); }

function init() {
  loadLocal();
  if (data.engine === 'plugin' || data.engine === 'auto') data.engine = 'online';
  saveLocal(); emit();
}
function onResume() {}
function onChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}
function get(key) { return key ? data[key] : data; }
function set(key, value) { data[key] = value; data.updatedAt = Date.now(); saveLocal(); emit(); return value; }

function checkKey(w, k) { return 'w' + w + 'd' + k; }
function isChecked(w, k) { return !!data.checkedDays[checkKey(w, k)]; }
function toggleCheck(w, k) {
  const key = checkKey(w, k);
  if (data.checkedDays[key]) delete data.checkedDays[key]; else data.checkedDays[key] = 1;
  data.updatedAt = Date.now(); saveLocal(); emit(); return !!data.checkedDays[key];
}
function checkedCount() { return Object.keys(data.checkedDays || {}).length; }
function weekCheckedMap(wIdx) {
  const map = {}; for (let k = 1; k <= 7; k++) map[k] = !!data.checkedDays[checkKey(wIdx + 1, k)]; return map;
}
function weekCheckedCount(wIdx) {
  let n = 0; for (let k = 1; k <= 7; k++) if (data.checkedDays[checkKey(wIdx + 1, k)]) n++; return n;
}
function isStarred(word) { return (data.starredWords || []).some(v => v.w === word); }
function toggleStar(item) {
  const list = data.starredWords || (data.starredWords = []);
  const i = list.findIndex(v => v.w === item.w);
  if (i >= 0) list.splice(i, 1); else list.push({ w:item.w, m:item.m, p:item.p, e:item.e });
  data.updatedAt = Date.now(); saveLocal(); emit(); return i < 0;
}

// 正确：1/2/4/7/14/30/60/120 天逐级延长；错误：等级归零并立即可复习。
// correct/wrong/level/nextReviewAt/lastReviewedAt 均随本地数据保存并进入备份。
function reviewWord(word, remembered) {
  if (!word) return null;
  const now = Date.now();
  const old = data.reviewStats[word] || {correct:0,wrong:0,level:0,nextReviewAt:0,lastReviewedAt:0};
  let level, nextReviewAt;
  if (remembered) {
    level = Math.min((Number(old.level) || 0) + 1, DEFAULT_INTERVALS.length);
    nextReviewAt = now + DEFAULT_INTERVALS[level - 1] * 86400000;
  } else {
    level = 0; nextReviewAt = now;
  }
  data.reviewStats[word] = {
    correct:(old.correct||0)+(remembered?1:0), wrong:(old.wrong||0)+(remembered?0:1),
    level, nextReviewAt, lastReviewedAt:now
  };
  data.updatedAt = now; saveLocal(); emit(); return data.reviewStats[word];
}
function getReviewStats(word) {
  return (data.reviewStats || {})[word] || {correct:0,wrong:0,level:0,nextReviewAt:0,lastReviewedAt:0};
}
function dueWords(words) {
  const now = Date.now();
  return (words || []).filter(v => { const s=getReviewStats(v.w); return !s.nextReviewAt || s.nextReviewAt <= now; });
}

function exportBackup() {
  return JSON.stringify({
    app:BACKUP_TAG, v:BACKUP_VERSION, exportedAt:Date.now(),
    data:{
      startDate:data.startDate, checkedDays:data.checkedDays||{}, starredWords:data.starredWords||{},
      reviewStats:data.reviewStats||{}, rate:data.rate, accent:data.accent, engine:'online'
    }
  });
}
function sanitizeReviewStats(raw) {
  const out={}; if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(word=>{
    if (!word || word.length>100) return; const s=raw[word]; if (!s || typeof s!=='object') return;
    out[String(word).slice(0,100)]={
      correct:Math.max(0,Math.min(999999,Number(s.correct)||0)),
      wrong:Math.max(0,Math.min(999999,Number(s.wrong)||0)),
      level:Math.max(0,Math.min(DEFAULT_INTERVALS.length,Math.floor(Number(s.level)||0))),
      nextReviewAt:Math.max(0,Number(s.nextReviewAt)||0),
      lastReviewedAt:Math.max(0,Number(s.lastReviewedAt)||0)
    };
  }); return out;
}
function sanitize(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('不是有效的备份数据');
  if (raw.app && raw.app !== BACKUP_TAG) throw new Error('这不是「开溜」的备份');
  const d=(raw.data && typeof raw.data==='object')?raw.data:raw;
  const out={checkedDays:{},starredWords:[],reviewStats:{},startDate:'',rate:0,accent:'',engine:'online'};
  const cd=d.checkedDays;
  if(cd && typeof cd==='object' && !Array.isArray(cd)) Object.keys(cd).forEach(k=>{if(DAY_KEY.test(k)&&cd[k])out.checkedDays[k]=1;});
  if(Array.isArray(d.starredWords)){
    const seen={}; d.starredWords.forEach(item=>{if(!item||!item.w)return;const w=String(item.w).slice(0,60);if(seen[w])return;seen[w]=1;out.starredWords.push({w,m:String(item.m||'').slice(0,80),p:String(item.p||'').slice(0,20),e:String(item.e||'').slice(0,300)});});
  }
  out.reviewStats=sanitizeReviewStats(d.reviewStats);
  if(typeof d.startDate==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d.startDate))out.startDate=d.startDate;
  const rate=Number(d.rate); if(rate>=0.5&&rate<=2)out.rate=rate;
  if(d.accent==='us'||d.accent==='uk')out.accent=d.accent;
  return out;
}
function mergeReviewStats(localStats,incomingStats){
  const result=Object.assign({},localStats||{});
  Object.keys(incomingStats||{}).forEach(word=>{
    const incoming=incomingStats[word], local=result[word];
    if(!local){result[word]=incoming;return;}
    const lt=Number(local.lastReviewedAt)||0,it=Number(incoming.lastReviewedAt)||0;
    result[word]={correct:(Number(local.correct)||0)+(Number(incoming.correct)||0),wrong:(Number(local.wrong)||0)+(Number(incoming.wrong)||0),
      level:it>=lt?incoming.level:local.level,nextReviewAt:it>=lt?incoming.nextReviewAt:local.nextReviewAt,lastReviewedAt:Math.max(lt,it)};
  }); return result;
}
function importBackup(text,mode){
  const str=String(text==null?'':text).trim(); if(!str)throw new Error('内容为空，请先粘贴备份文本');
  let raw; try{raw=JSON.parse(str);}catch(e){throw new Error('解析失败：不是完整的备份文本，请重新复制一次');}
  const inc=sanitize(raw),replace=mode==='replace'; let addedDays=0,addedWords=0;
  if(replace){data.checkedDays=inc.checkedDays;data.starredWords=inc.starredWords;data.reviewStats=inc.reviewStats;addedDays=Object.keys(inc.checkedDays).length;addedWords=data.starredWords.length;}
  else{
    const md=Object.assign({},data.checkedDays||{});Object.keys(inc.checkedDays).forEach(k=>{if(!md[k]){md[k]=1;addedDays++;}});data.checkedDays=md;
    const map={},list=(data.starredWords||[]).slice();list.forEach(v=>{if(v&&v.w)map[v.w]=1;});
    inc.starredWords.forEach(v=>{if(!map[v.w]){map[v.w]=1;list.push(v);addedWords++;}});data.starredWords=list;
    data.reviewStats=mergeReviewStats(data.reviewStats,inc.reviewStats);
  }
  if(inc.startDate)data.startDate=inc.startDate;if(inc.rate)data.rate=inc.rate;if(inc.accent)data.accent=inc.accent;
  data.engine='online';data.updatedAt=Date.now();saveLocal();emit();
  return {addedDays,addedWords,totalDays:Object.keys(data.checkedDays||{}).length,totalWords:(data.starredWords||[]).length,reviewWords:Object.keys(data.reviewStats||{}).length};
}
module.exports={init,onResume,onChange,get,set,isChecked,toggleCheck,checkedCount,weekCheckedCount,weekCheckedMap,isStarred,toggleStar,reviewWord,getReviewStats,dueWords,exportBackup,importBackup};
