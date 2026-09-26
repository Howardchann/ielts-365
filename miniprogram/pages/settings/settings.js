// pages/settings/settings.js —— 设置：日期 / 语音 / 进度备份
const plan=require('../../utils/data.js');
const store=require('../../utils/store.js');
const speech=require('../../utils/speech.js');
const theme=require('../../utils/theme.js');
const ACCENTS=['us','uk'];

// ====================== 「关于」模块文案（想改这块的文字，只改本段即可） ======================
// ① 卡片标题：设置页里那一小块的标题
const ABOUT_CARD_LABEL = '关于';
// ② 卡片里那行文字，版本号会自动拼在后面 → 屏幕显示「关于本计划 v1.0」
const ABOUT_TITLE = '和好友一起来学雅思';
// ③ 版本显示：全自动，无需手动维护。
//    屏幕实际显示 = 环境 + 构建标识，如「体验版 · 3a96f2d · 09-25 22:11」
//    构建标识由 tools/stamp-build.js 生成（上传 / 预览前跑一次），用来确认手机上跑的是哪次提交
// ④ 点击后弹窗的标题
const ABOUT_MODAL_TITLE = '关于开溜';
// ⑤ 弹窗正文：\n 表示换行。行首不要留空格，否则手机弹窗里会出现空档
const ABOUT_TEXT =
  '2026 年 9 月 21 日开始开发。初衷：给自己一套能坚持下来的零基础雅思自学节奏——每天 30 分钟左右，先养习惯，再上强度。\n' +
  '计划共 4 个阶段、78 周、546 天、8000 词：1125 个主题核心词 + 6875 个词频扩展词，每 2 周安排 1 个巩固周。\n' +
  '进度自动云同步，也可在「备份与重置」导出文本存档；语音预生成，播过即缓存，离线可听。';
// ========================================================================================

// ---------- 构建标识（为什么需要：小程序运行时无法调用 git，"跑的是哪一版"只能在上传前固化） ----------
// 缺文件也要能跑（比如刚 clone 还没跑 stamp-build.js）→ 降级为只显示环境名
let BUILD = null;
try { BUILD = require('../../utils/build-info.js'); } catch (e) { BUILD = null; }

// 当前运行环境：开发版（含「预览」扫码）/ 体验版 / 正式版
function envLabel() {
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
    const v = info && info.miniProgram && info.miniProgram.envVersion;
    if (v === 'release') return '正式版';
    if (v === 'trial') return '体验版';
    if (v === 'develop') return '开发版';
  } catch (e) {}
  return '';
}

function buildLabel() {
  const p = n => String(n).padStart(2, '0');
  const parts = [];
  const env = envLabel(); if (env) parts.push(env);
  if (BUILD && BUILD.sha) {
    parts.push(BUILD.sha + (BUILD.dirty ? '*' : ''));
  }
  const t = Number(BUILD && BUILD.builtAt) || 0;
  if (t) {
    const d = new Date(t);
    parts.push(p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()));
  }
  return parts.length ? parts.join(' · ') : '未知版本';
}

Page({
  data:{startDate:plan.DEFAULT_START,today:'',rate:0.9,rateText:'0.90×',accent:'us',
    accentOptions:[{value:'us',label:'美式发音（默认）'},{value:'uk',label:'英式发音'}],accentIndex:0,
    engineOptions:[{value:'auto',label:'自动（推荐）：优先预生成，失败切在线'},{value:'pregen',label:'仅预生成高清音频'},{value:'online',label:'仅在线 TTS（有道/百度）'}],engineIndex:0,
    totalChecked:0,totalDays:plan.TOTAL_DAYS,starredCount:0,reviewCount:0,appVersion:buildLabel(),aboutCardLabel:ABOUT_CARD_LABEL,aboutTitle:ABOUT_TITLE,engineLabel:'',engineHint:'',backupText:'',showBackup:false,importText:'',showImport:false,voiceTesting:false,voiceLabel:'试听发音',
    cloudOn:true,cloudMeta:'',cloudErr:'',cloudTip:'',syncing:false,sheet:{show:false,title:'',options:[],index:0,key:''},cal:{show:false,y:0,m:0,label:'',grid:[],canPrev:true,canNext:true},
    // 主题 data 初始化（与 tabBar 同款）：首帧即正确深浅，见 today.js 注释
    dark:theme.isDark(),pageStyle:theme.isDark()?'background-color:#0E1618;':''},
  onLoad(){theme.applyPage(this);theme.syncTabBar(this);const now=new Date(),pad=n=>String(n).padStart(2,'0');this.setData({today:now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())});speech.initPlugin();this._offSpeech=speech.onStateChange(p=>this.setData({voiceTesting:!!p.playing,voiceLabel:p.playing?'停止朗读':'试听发音'}));this._offStore=store.onChange(()=>this.refreshCloud());this.refreshCloud();},
  onUnload(){if(this._offSpeech){this._offSpeech();this._offSpeech=null;}if(this._offStore){this._offStore();this._offStore=null;}},
  onShow(){theme.syncTabBar(this,3);this.applyTheme();theme.sameSet(this,{appearanceMode:theme.mode()});try{wx.setNavigationBarTitle({title:'设置'});}catch(e){}this.refresh();},
  applyTheme(){theme.applyPage(this);theme.syncTabBar(this);},
  /* 外观三态：跟随系统 / 浅色 / 深色。切换后通知栈内所有页面 + tabBar 即时换肤 */
  onAppearance(e){const m=e.currentTarget.dataset.mode;if(!m||m===theme.mode())return;theme.setMode(m);this.setData({appearanceMode:m});getCurrentPages().forEach(p=>{if(p.applyTheme)p.applyTheme();});},
  refresh(){const rate=store.get('rate')||0.9,accent=store.get('accent')||'us',engineMode=store.get('engineMode')||'auto';speech.setRate(rate);speech.setEngineMode(engineMode);speech.setAccent(accent);
    const eng=speech.getEngineInfo(),pre=eng.engine==='pregen';
    const MODES={auto:['自动（当前云端音频可用，优先预生成）','优先预生成高清音频（美音），失败自动切在线。'],pregen:['仅预生成高清音频','只用预生成音频（美音），失败不切在线。'],online:['仅在线 TTS（有道 / 百度）','全部在线朗读，口音切换只在此音源生效。']};
    const m=MODES[engineMode]||MODES.auto;
    // 同值守卫：onShow 每次进设置页都调 refresh，数值没变就不再整树 setData（切 tab 闪屏）
    theme.sameSet(this,{startDate:store.get('startDate')||plan.DEFAULT_START,rate,rateText:Number(rate).toFixed(2)+'×',accent,accentIndex:Math.max(0,ACCENTS.indexOf(accent)),engineIndex:Math.max(0,this.data.engineOptions.findIndex(o=>o.value===engineMode)),totalChecked:store.checkedCount(),totalDays:plan.TOTAL_DAYS,starredCount:(store.get('starredWords')||[]).length,reviewCount:store.activeReviewCount(),
      engineLabel:m[0],
      engineHint:(pre?'':'⚠️ 云端音频不可用，预生成将自动降级在线。')+m[1]});this.refreshCloud();},
  openEngineSheet(){this.setData({sheet:{show:true,title:'朗读方式',options:this.data.engineOptions,index:this.data.engineIndex,key:'engine'}});},
  openAccentSheet(){this.setData({sheet:{show:true,title:'发音口音',options:this.data.accentOptions,index:this.data.accentIndex,key:'accent'}});},
  closeSheet(){this.setData({'sheet.show':false});},noop(){},
  onSheetPick(e){const i=Number(e.currentTarget.dataset.i),k=this.data.sheet.key;this.setData({'sheet.show':false});if(k==='engine'){const m=this.data.engineOptions[i].value;store.set('engineMode',m);speech.setEngineMode(m);this.refresh();}else{const accent=this.data.accentOptions[i].value;store.set('accent',accent);speech.setAccent(accent);this.setData({accent,accentIndex:i});}},
  onStartDate(){this.openCal();},
  /* 自绘月历弹层（替代系统 date picker 深色滚轮）：周一开头，范围 2025-01 ~ 2028-12，选非周一对齐当周周一 */
  openCal(){const d=(this.data.startDate||plan.DEFAULT_START).split('-').map(Number);const y=d[0],m=d[1]-1;const g=this._buildCal(y,m);this.setData({cal:{show:true,y,m,label:g.label,grid:g.grid,canPrev:g.canPrev,canNext:g.canNext}});},
  _buildCal(y,m){const first=new Date(y,m,1),lead=(first.getDay()+6)%7,days=new Date(y,m+1,0).getDate();const p=n=>('0'+n).slice(-2);const t=new Date(),tIso=t.getFullYear()+'-'+p(t.getMonth()+1)+'-'+p(t.getDate());const grid=[];for(let i=0;i<lead;i++)grid.push({blank:true,iso:'b'+i});for(let d=1;d<=days;d++){const iso=y+'-'+p(m+1)+'-'+p(d);grid.push({d,iso,dis:iso<tIso||iso>'2028-12-31',sel:iso===this.data.startDate,today:iso===tIso});}return{grid,label:y+' 年 '+(m+1)+' 月',canPrev:!(y===2025&&m===0),canNext:!(y===2028&&m===11)};},
  shiftMonth(e){const dir=Number(e.currentTarget.dataset.dir);let{y,m}=this.data.cal;m+=dir;if(m<0){m=11;y--;}if(m>11){m=0;y++;}if((dir<0&&(y===2025&&m===0))||(dir>0&&(y===2028&&m===11))){return;}const g=this._buildCal(y,m);this.setData({'cal.y':y,'cal.m':m,'cal.label':g.label,'cal.grid':g.grid,'cal.canPrev':g.canPrev,'cal.canNext':g.canNext});},
  closeCal(){this.setData({'cal.show':false});},
  pickDay(e){const ds=e.currentTarget.dataset;if(ds.dis==='true'||ds.dis===true)return;const iso=ds.iso;let d=new Date(iso+'T00:00:00');const off=(d.getDay()+6)%7;
  // 09-26 定稿：非周一 → 顺延到「所选日期之后的第一个周一」（只向后、不回退）。
  // 日历已禁选今天之前的日期，startDate 恒 ≥ 今天，倒计时天数恒 ≥ 0，
  // 不再有「还有 -5 天开学」的负数态；补课语义随之废除（过去的周一已选不到）。
  if(off)d.setDate(d.getDate()+(7-off));
  const p=n=>('0'+n).slice(-2),ms=p(d.getMonth()+1)+'-'+p(d.getDate());const fin=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());store.set('startDate',fin);getCurrentPages().forEach(pg=>{if(pg.resetView)pg.resetView();});this.setData({'cal.show':false,startDate:fin});this.refresh();this.fb().toast(off?'已顺延到周一 '+ms:'开始日期已更新');},
  onRate(e){const rate=Number(e.detail.value);speech.setRate(rate);store.set('rate',rate);this.setData({rate,rateText:rate.toFixed(2)+'×'});},
  onTestVoice(){if(this.data.voiceTesting){speech.stop();return;}const d=plan.demo();if(d&&d.example){speech.speak(d.example,{ai:d.ai,kind:'s'});}else{speech.speak('Hello. Nice to meet you. This is your daily learning voice.');}},
  backupSummaryOf(text){try{const o=JSON.parse(text);return (o&&typeof o.summary==='string')?o.summary:'';}catch(e){return '';}},
  onExport(){let text;try{text=store.exportBackup();}catch(e){this.fb().toast('导出失败');return;}const s=this.backupSummaryOf(text);this.setData({backupText:text,showBackup:true,showImport:false,importText:''});wx.setClipboardData({data:text,success:()=>this.fb().modal({title:'备份已导出',content:(s?s+'\n\n':'')+'全文已复制到剪贴板，粘贴到备忘录等处保存即可。',showCancel:false}),fail:()=>this.fb().toast('复制失败，请长按选中文本手动复制',2500)});},
  onCopyBackup(){wx.setClipboardData({data:this.data.backupText,success:()=>this.fb().toast('已复制'),fail:()=>this.fb().toast('复制失败，请长按上方文本手动复制',2500)});},
  onHideBackup(){this.setData({showBackup:false});},onShowImport(){this.setData({showImport:true,showBackup:false,importText:''});},onHideImport(){this.setData({showImport:false,importText:''});},onImportInput(e){this.setData({importText:e.detail.value});},
  doImport(mode){const text=(this.data.importText||'').trim();if(!text){this.fb().toast('请先粘贴备份内容');return;}let r;try{r=store.importBackup(text,mode);}catch(e){this.fb().modal({title:'导入失败',content:e.message||String(e),showCancel:false});return;}this.setData({showImport:false,importText:''});getCurrentPages().forEach(pg=>{if(pg.resetView)pg.resetView();});this.refresh();const bs=this.backupSummaryOf(text);const head=mode==='merge'?'合并完成':'覆盖完成';const detail=(bs?('该备份：'+bs+'\n\n'):'')+(mode==='merge'?('新增 '+r.addedDays+' 天打卡、'+r.addedWords+' 个重点词\n合并后共 '+r.totalDays+' 天、'+r.totalWords+' 个重点词\n已恢复 '+r.reviewWords+' 个复习记录'):('已替换为备份中的 '+r.totalDays+' 天打卡、'+r.totalWords+' 个重点词、'+r.reviewWords+' 个复习记录'));this.fb().modal({title:head,content:detail,showCancel:false});},
  onImportMerge(){this.doImport('merge');},onImportReplace(){this.doImport('replace');},
  onResetProgress(){this.fb().modal({title:'清除学习记录',content:'将清空全部打卡、收藏与复习记录，云端一并清除，其他设备同步后同样清空——无法撤销。建议先「导出备份」，确定从 0 开始吗？',confirmText:'清除',danger:true,onConfirm:()=>{store.resetProgress();getCurrentPages().forEach(p=>{if(p.resetView)p.resetView();});this.refresh();this.fb().toast('已清除，重新开始',1500);}});},
  // 云同步状态：只更新这一小块，避免每次 store 变更都整页 refresh
  refreshCloud(){
    const sr=store.cloudStatus();const p=n=>String(n).padStart(2,'0');
    let meta='';
    if(!sr.supported) meta='当前微信版本不支持云开发，请升级微信后重试';
    else if(!sr.enabled) meta='已关闭：进度只保存在本机，不会上传';
    else if(sr.syncing) meta='正在同步…';
    else if(!sr.lastSyncAt) meta='尚未同步过';
    else{const d=new Date(sr.lastSyncAt),today=new Date();const same=d.toDateString()===today.toDateString();
      meta='上次同步：'+(same?'今天 ':(p(d.getMonth()+1)+'-'+p(d.getDate())+' '))+p(d.getHours())+':'+p(d.getMinutes());}
    if(sr.enabled&&sr.pending>0) meta+='，待同步 '+sr.pending+' 条复习记录';
    theme.sameSet(this,{cloudOn:sr.enabled,syncing:!!sr.syncing,cloudMeta:meta,cloudErr:sr.error||'',
      cloudTip:sr.enabled?'进度自动同步，多台设备共用一份进度':'开启后进度自动同步，多台设备共用一份进度'});
  },
  fb(){return this.selectComponent('#fb');},
  onCloudToggle(e){const on=!!e.detail.value;this.setData({cloudOn:on});store.setSyncEnabled(on).then(r=>{this.refreshCloud();this.fb().toast((r&&r.ok)?(on?'云同步已开启':'云同步已关闭'):((r&&r.msg)||'操作失败'),2200);});},
  onSyncNow(){if(this.data.syncing)return;this.setData({syncing:true});store.syncNow().then(r=>{this.refreshCloud();const extra=(r.msg&&r.msg!=='已同步')?('——'+r.msg):'';this.fb().modal({title:r.ok?'同步完成':'同步失败',content:r.ok?('进度已与云端对齐'+extra):((r.msg||'未知错误')+'——本地进度不受影响，可稍后点「立即同步」重试'),showCancel:false});});},
  onAbout(){this.fb().modal({title:ABOUT_MODAL_TITLE,content:ABOUT_TEXT,showCancel:false});}
});
