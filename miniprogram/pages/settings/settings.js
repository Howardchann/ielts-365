// pages/settings/settings.js —— 设置：日期 / 语音 / 进度备份
const plan=require('../../utils/data.js');
const store=require('../../utils/store.js');
const speech=require('../../utils/speech.js');
const ACCENTS=['us','uk'];

Page({
  data:{startDate:plan.DEFAULT_START,today:'2026-09-21',rate:0.9,rateText:'0.90×',accent:'us',
    accentOptions:[{value:'us',label:'美式发音（默认）'},{value:'uk',label:'英式发音'}],accentIndex:0,
    totalChecked:0,starredCount:0,reviewCount:0,appVersion:'1.0.0',backupText:'',showBackup:false,importText:'',showImport:false,voiceTesting:false},
  onLoad(){const now=new Date(),pad=n=>String(n).padStart(2,'0');this.setData({today:now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())});speech.initPlugin();this._offSpeech=speech.onStateChange(p=>this.setData({voiceTesting:!!p.playing}));},
  onUnload(){if(this._offSpeech){this._offSpeech();this._offSpeech=null;}},
  onShow(){this.refresh();},
  refresh(){const rate=store.get('rate')||0.9,accent=store.get('accent')||'us';speech.setRate(rate);speech.setEngine('online');speech.setAccent(accent);
    this.setData({startDate:store.get('startDate')||plan.DEFAULT_START,rate,rateText:Number(rate).toFixed(2)+'×',accent,accentIndex:Math.max(0,ACCENTS.indexOf(accent)),totalChecked:store.checkedCount(),starredCount:(store.get('starredWords')||[]).length,reviewCount:Object.keys(store.get('reviewStats')||{}).length});},
  onStartDate(e){store.set('startDate',e.detail.value);this.refresh();wx.showToast({title:'开始日期已更新',icon:'success'});},
  onRate(e){const rate=Number(e.detail.value);speech.setRate(rate);store.set('rate',rate);this.setData({rate,rateText:rate.toFixed(2)+'×'});},
  onTestVoice(){if(this.data.voiceTesting){speech.stop();return;}speech.speak('Hello. Nice to meet you. This is your daily learning voice.');},
  onAccent(e){const idx=Number(e.detail.value),accent=this.data.accentOptions[idx].value;store.set('accent',accent);speech.setAccent(accent);this.setData({accent,accentIndex:idx});},
  onExport(){let text;try{text=store.exportBackup();}catch(e){wx.showToast({title:'导出失败',icon:'none'});return;}this.setData({backupText:text,showBackup:true,showImport:false,importText:''});wx.setClipboardData({data:text,success:()=>wx.showToast({title:'已复制，请粘贴到备忘录保存',icon:'none',duration:2500}),fail:()=>wx.showToast({title:'复制失败，请长按选中文本手动复制',icon:'none',duration:2500})});},
  onCopyBackup(){wx.setClipboardData({data:this.data.backupText,success:()=>wx.showToast({title:'已复制',icon:'success'})});},
  onHideBackup(){this.setData({showBackup:false});},onShowImport(){this.setData({showImport:true,showBackup:false,importText:''});},onHideImport(){this.setData({showImport:false,importText:''});},onImportInput(e){this.setData({importText:e.detail.value});},
  doImport(mode){const text=(this.data.importText||'').trim();if(!text){wx.showToast({title:'请先粘贴备份内容',icon:'none'});return;}let r;try{r=store.importBackup(text,mode);}catch(e){wx.showModal({title:'导入失败',content:e.message||String(e),showCancel:false});return;}this.setData({showImport:false,importText:''});this.refresh();const head=mode==='merge'?'合并完成':'覆盖完成';const detail=mode==='merge'?('新增 '+r.addedDays+' 天打卡、'+r.addedWords+' 个重点词\n合并后共 '+r.totalDays+' 天、'+r.totalWords+' 个重点词\n已恢复 '+r.reviewWords+' 个复习记录'):('已替换为备份中的 '+r.totalDays+' 天打卡、'+r.totalWords+' 个重点词、'+r.reviewWords+' 个复习记录');wx.showModal({title:head,content:detail,showCancel:false});},
  onImportMerge(){this.doImport('merge');},onImportReplace(){this.doImport('replace');},
  onAbout(){wx.showModal({title:'关于开溜',content:'零基础雅思全年学习计划：4阶段、52周、364天、1300个核心词汇。语音使用在线 TTS；学习进度只保存在本机，可在「进度备份」里导出保存，换机时导入恢复。',showCancel:false});}
});
