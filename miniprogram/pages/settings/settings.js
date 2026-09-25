// pages/settings/settings.js —— 设置：日期 / 语音 / 进度备份
const plan=require('../../utils/data.js');
const store=require('../../utils/store.js');
const speech=require('../../utils/speech.js');
const ACCENTS=['us','uk'];

// ====================== 「关于」模块文案（想改这块的文字，只改本段即可） ======================
// ① 卡片标题：设置页里那一小块的标题
const ABOUT_CARD_LABEL = '关于';
// ② 卡片里那行文字，版本号会自动拼在后面 → 屏幕显示「关于本计划 v1.0」
const ABOUT_TITLE = '和好友一起来学雅思';
// ③ 版本号：以后发新版只改这里。
//    屏幕实际显示 = 本行 + 环境 + 构建标识，如「版本V2.0 · 开发版 · 8dad358 · 09-24 17:40」
//    构建标识由 tools/stamp-build.js 生成（上传 / 预览前跑一次），用来确认手机上跑的是哪次提交
const ABOUT_VERSION = '版本V2.0';
// ④ 点击后弹窗的标题
const ABOUT_MODAL_TITLE = '关于开溜';
// ⑤ 弹窗正文：\n 表示换行。行首不要留空格，否则手机弹窗里会出现空档
const ABOUT_TEXT =
  '零基础雅思 18 个月学习计划：4 个阶段、78 周、546 天、8000 词汇。\n' +
  '词汇分两组：1125 个主题核心词 + 6875 个词频扩展词，每日新词从 11 个逐步升到 30 个。\n' +
  '每 2 周系统课程后安排 1 个巩固周，复习前两周词汇并做词根词缀训练，全程共 26 个巩固周。\n' +
  '语音为预生成高清音频，播过即缓存到本机，之后同一句可离线播放。\n' +
  '学习进度会自动同步到云端：换手机登录同一个微信，进度自动恢复。\n' +
  '也可以在「进度备份」里导出文本自己存档，需要时导入恢复。';
// ========================================================================================

// ---------- 构建标识（为什么需要：小程序运行时无法调用 git，"跑的是哪一版"只能在上传前固化） ----------
// 缺文件也要能跑（比如刚 clone 还没跑 stamp-build.js）→ 降级为只显示 ABOUT_VERSION
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
  const parts = [ABOUT_VERSION];
  const env = envLabel(); if (env) parts.push(env);
  if (BUILD && BUILD.sha) {
    parts.push(BUILD.sha + (BUILD.dirty ? '*' : ''));
  }
  const t = Number(BUILD && BUILD.builtAt) || 0;
  if (t) {
    const d = new Date(t);
    parts.push(p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()));
  }
  return parts.join(' · ');
}

Page({
  data:{startDate:plan.DEFAULT_START,today:'',rate:0.9,rateText:'0.90×',accent:'us',
    accentOptions:[{value:'us',label:'美式发音（默认）'},{value:'uk',label:'英式发音'}],accentIndex:0,
    engineOptions:[{value:'auto',label:'自动（推荐）：优先预生成，失败切在线'},{value:'pregen',label:'仅预生成高清音频'},{value:'online',label:'仅在线 TTS（有道/百度）'}],engineIndex:0,
    totalChecked:0,totalDays:plan.TOTAL_DAYS,starredCount:0,reviewCount:0,appVersion:buildLabel(),aboutCardLabel:ABOUT_CARD_LABEL,aboutTitle:ABOUT_TITLE,engineLabel:'',engineHint:'',backupText:'',showBackup:false,importText:'',showImport:false,voiceTesting:false,voiceLabel:'试听发音',
    cloudOn:true,cloudMeta:'',cloudErr:'',cloudTip:'',syncing:false},
  onLoad(){const now=new Date(),pad=n=>String(n).padStart(2,'0');this.setData({today:now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())});speech.initPlugin();this._offSpeech=speech.onStateChange(p=>this.setData({voiceTesting:!!p.playing,voiceLabel:p.playing?('朗读中…'+(p.source?'（'+p.source+'）':'')+' 点击停止'):'试听发音'}));this._offStore=store.onChange(()=>this.refreshCloud());this.refreshCloud();},
  onUnload(){if(this._offSpeech){this._offSpeech();this._offSpeech=null;}if(this._offStore){this._offStore();this._offStore=null;}},
  onShow(){if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ active: 3 });this.refresh();},
  refresh(){const rate=store.get('rate')||0.9,accent=store.get('accent')||'us',engineMode=store.get('engineMode')||'auto';speech.setRate(rate);speech.setEngineMode(engineMode);speech.setAccent(accent);
    const eng=speech.getEngineInfo(),pre=eng.engine==='pregen';
    const MODES={auto:['自动（当前云端音频可用，优先预生成）','优先播预生成高清音频（美音），失败自动切在线 TTS。在线音色与预生成不同，属正常现象。'],pregen:['仅预生成高清音频','只用预生成音频（美音），不连网朗读。若某条失败会直接提示，不再切在线。'],online:['仅在线 TTS（有道 / 百度）','全部走在线朗读。音色与预生成不同；口音切换（英/美）只在这个音源下生效。']};
    const m=MODES[engineMode]||MODES.auto;
    this.setData({startDate:store.get('startDate')||plan.DEFAULT_START,rate,rateText:Number(rate).toFixed(2)+'×',accent,accentIndex:Math.max(0,ACCENTS.indexOf(accent)),engineIndex:Math.max(0,this.data.engineOptions.findIndex(o=>o.value===engineMode)),totalChecked:store.checkedCount(),totalDays:plan.TOTAL_DAYS,starredCount:(store.get('starredWords')||[]).length,reviewCount:Object.keys(store.get('reviewStats')||{}).length,
      engineLabel:m[0],
      engineHint:(pre?'':'⚠️ 云端音频不可用，预生成将自动降级在线。')+m[1]});this.refreshCloud();},
  onEngineMode(e){const m=this.data.engineOptions[Number(e.detail.value)].value;store.set('engineMode',m);speech.setEngineMode(m);this.refresh();},
  onStartDate(e){const v=e.detail.value,d=new Date(v+'T00:00:00'),off=(d.getDay()+6)%7;if(off)d.setDate(d.getDate()-off);const p=n=>('0'+n).slice(-2),ms=p(d.getMonth()+1)+'-'+p(d.getDate());store.set('startDate',d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()));this.refresh();wx.showToast({title:off?('已对齐到周一 '+ms):'开始日期已更新',icon:'none'});},
  onRate(e){const rate=Number(e.detail.value);speech.setRate(rate);store.set('rate',rate);this.setData({rate,rateText:rate.toFixed(2)+'×'});},
  onTestVoice(){if(this.data.voiceTesting){speech.stop();return;}const d=plan.demo();if(d&&d.example){speech.speak(d.example,{ai:d.ai,kind:'s'});}else{speech.speak('Hello. Nice to meet you. This is your daily learning voice.');}},
  onAccent(e){const idx=Number(e.detail.value),accent=this.data.accentOptions[idx].value;store.set('accent',accent);speech.setAccent(accent);this.setData({accent,accentIndex:idx});},
  onExport(){let text;try{text=store.exportBackup();}catch(e){wx.showToast({title:'导出失败',icon:'none'});return;}this.setData({backupText:text,showBackup:true,showImport:false,importText:''});wx.setClipboardData({data:text,success:()=>wx.showToast({title:'已复制，请粘贴到备忘录保存',icon:'none',duration:2500}),fail:()=>wx.showToast({title:'复制失败，请长按选中文本手动复制',icon:'none',duration:2500})});},
  onCopyBackup(){wx.setClipboardData({data:this.data.backupText,success:()=>wx.showToast({title:'已复制',icon:'success'}),fail:()=>wx.showToast({title:'复制失败，请长按上方文本手动复制',icon:'none',duration:2500})});},
  onHideBackup(){this.setData({showBackup:false});},onShowImport(){this.setData({showImport:true,showBackup:false,importText:''});},onHideImport(){this.setData({showImport:false,importText:''});},onImportInput(e){this.setData({importText:e.detail.value});},
  doImport(mode){const text=(this.data.importText||'').trim();if(!text){wx.showToast({title:'请先粘贴备份内容',icon:'none'});return;}let r;try{r=store.importBackup(text,mode);}catch(e){wx.showModal({title:'导入失败',content:e.message||String(e),showCancel:false});return;}this.setData({showImport:false,importText:''});this.refresh();const head=mode==='merge'?'合并完成':'覆盖完成';const detail=mode==='merge'?('新增 '+r.addedDays+' 天打卡、'+r.addedWords+' 个重点词\n合并后共 '+r.totalDays+' 天、'+r.totalWords+' 个重点词\n已恢复 '+r.reviewWords+' 个复习记录'):('已替换为备份中的 '+r.totalDays+' 天打卡、'+r.totalWords+' 个重点词、'+r.reviewWords+' 个复习记录');wx.showModal({title:head,content:detail,showCancel:false});},
  onImportMerge(){this.doImport('merge');},onImportReplace(){this.doImport('replace');},
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
    this.setData({cloudOn:sr.enabled,syncing:!!sr.syncing,cloudMeta:meta,cloudErr:sr.error||'',
      cloudTip:sr.enabled?'进度自动同步到云端：换手机登录同一个微信即可恢复，多台设备共用同一份进度。':'开启后进度自动同步到云端，多台设备共用同一份进度。'});
  },
  onCloudToggle(e){const on=!!e.detail.value;this.setData({cloudOn:on});store.setSyncEnabled(on).then(r=>{this.refreshCloud();wx.showToast({title:(r&&r.ok)?(on?'云同步已开启':'云同步已关闭'):((r&&r.msg)||'操作失败'),icon:on&&r&&r.ok?'success':'none',duration:2200});});},
  onSyncNow(){if(this.data.syncing)return;this.setData({syncing:true});store.syncNow().then(r=>{this.refreshCloud();wx.showModal({title:r.ok?'同步完成':'同步失败',content:r.ok?('进度已与云端对齐。\n'+(r.msg||'')):((r.msg||'未知错误')+'\n\n本地进度不受影响，可稍后点「立即同步」重试。'),showCancel:false});});},
  onAbout(){wx.showModal({title:ABOUT_MODAL_TITLE,content:ABOUT_TEXT,showCancel:false});}
});
