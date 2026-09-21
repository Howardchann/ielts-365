// utils/speech.js —— 在线朗读（个人版）
// 微信同声传译 TTS 插件不对个人主体开放，本版本不再保留插件路径。
// 主源有道在线朗读（type=2 美音，type=1 英音），备用源百度 TTS；每个源都是「下载预检 + 直连播放」两步。
const state={engine:'online',rate:0.9,accent:'us',audio:null,playingText:'',queueMode:false,queue:[],playing:false,paused:false,listeners:[]};
let playToken=0,audioTimeout=null,audioOptDone=false;
function ensureAudioOption(){if(audioOptDone)return;audioOptDone=true;try{if(wx.setInnerAudioOption)wx.setInnerAudioOption({obeyMuteSwitch:false});}catch(e){}}
function initPlugin(){return false;}
function setRate(rate){const r=Math.min(1.3,Math.max(0.7,Number(rate)||0.9));state.rate=r;return r;}
function setEngine(){state.engine='online';}
function setAccent(accent){if(accent==='uk'||accent==='us')state.accent=accent;}
function notify(text,playing,mode){const p={text:text||'',playing:!!playing,mode:mode||(state.queueMode?'queue':(playing?'single':'idle'))};state.listeners.slice().forEach(fn=>{try{fn(p);}catch(e){}});}
function onlineUrl(text){return 'https://dict.youdao.com/dictvoice?audio='+encodeURIComponent(text)+'&type='+(state.accent==='uk'?1:2);}
// 备用朗读源：有道是词典查音，遇到音库未收录的短语会返回 HTTP 500（returned null audio），此时降级到百度 TTS。
// 百度仅英文、无英美音区分，作为兜底足够用。
function fallbackUrl(text){return 'https://fanyi.baidu.com/gettts?lan=en&spd=3&source=web&text='+encodeURIComponent(text);}
function killAudio(audio){if(!audio)return;try{audio.stop();}catch(e){}try{audio.destroy();}catch(e){}}
function cleanup(){if(audioTimeout){clearTimeout(audioTimeout);audioTimeout=null;}if(state.audio){killAudio(state.audio);state.audio=null;}state.playingText='';state.paused=false;}
// 每个源都走两步：① downloadFile 预检（能拿到明确 statusCode）② 直连外链播放。
// 原因：downloadFile 受「downloadFile 合法域名」白名单强校验（真机必校验、与开发工具设置无关），
// 而音频播放走 media 通道、校验更宽松——真机上常见「直连能响、下载被拦」。两条路都试才稳。
let failNotes=[];
const DEBUG_FAIL=true; // 诊断期把失败详情弹出来定位问题；稳定后改 false 即恢复一行 toast
function shortErr(e){return String((e&&(e.errMsg||e.errmsg))||e||'').replace(/^[^:]*:fail\s*/,'').slice(0,60);}
function playSrc(src,isFile,text,onResult){
  const token=++playToken,host=isFile?'本地文件':src.split('/')[2];
  if(state.audio)killAudio(state.audio);
  const audio=wx.createInnerAudioContext();state.audio=audio;state.paused=false;audio.src=src;audio.playbackRate=state.rate;
  let started=false;
  audioTimeout=setTimeout(()=>{if(token!==playToken||started)return;failNotes.push(host+' 未出声');cleanup();state.playing=false;onResult(false);},isFile?8000:6000);
  audio.onPlay(()=>{if(token!==playToken)return;started=true;state.playing=true;if(audio.playbackRate!==state.rate)audio.playbackRate=state.rate;});
  audio.onEnded(()=>{if(token!==playToken)return;cleanup();state.playing=false;onResult(true);});
  audio.onError(()=>{if(token!==playToken)return;failNotes.push(host+' 播放报错');cleanup();state.playing=false;onResult(false);});
  audio.play();
}
function tryOne(url,text,onResult){
  const token=++playToken,host=url.split('/')[2];
  wx.downloadFile({url:url,timeout:10000,
    success:res=>{if(token!==playToken)return;
      if(res.statusCode!==200){failNotes.push(host+' HTTP '+res.statusCode);playSrc(url,false,text,onResult);return;}
      playSrc(res.tempFilePath,true,text,onResult);},
    fail:err=>{if(token!==playToken)return;failNotes.push(host+' 下载被拦('+shortErr(err)+')');playSrc(url,false,text,onResult);}});
}
function playAudio(text,onDone){
  ensureAudioOption();failNotes=[];
  const urls=[onlineUrl(text),fallbackUrl(text)];
  let i=0;
  const step=success=>{
    if(success){if(onDone)onDone(true);return;}
    i++;
    if(i<urls.length){tryOne(urls[i],text,step);return;}
    const detail=failNotes.join('\n');
    console.warn('[speech] 朗读失败：\n'+detail);
    if(DEBUG_FAIL&&detail)wx.showModal({title:'朗读失败（诊断）',content:detail,showCancel:false,confirmText:'知道了'});
    else wx.showToast({title:'朗读失败，请检查网络',icon:'none'});
    if(onDone)onDone(false);
  };
  tryOne(urls[0],text,step);
}
function stop(){playToken++;state.queue=[];state.queueMode=false;cleanup();state.playing=false;notify('',false,'idle');}
function togglePause(){const audio=state.audio;if(!audio)return'none';if(state.paused){audio.play();state.paused=false;state.playing=true;notify(state.playingText,true);return'resumed';}audio.pause();state.paused=true;state.playing=false;notify(state.playingText,false);return'paused';}
function speakCore(text,onDone){state.playingText=text;state.playing=true;playAudio(text,ok=>{if(state.queueMode){if(onDone)onDone(ok);return;}if(!ok){stop();if(onDone)onDone(false);}else{if(onDone)onDone(true);notify('',false,'idle');}});notify(text,true);}
function speak(text,onDone){text=String(text||'').trim();if(!text){if(onDone)onDone(false);return;}if(state.queueMode){state.queue=[];state.queueMode=false;}speakCore(text,onDone);}
function speakQueue(texts){stop();state.queue=(texts||[]).map(v=>String(v||'').trim()).filter(Boolean);if(!state.queue.length)return;state.queueMode=true;next();}
function next(){if(!state.queueMode||!state.queue.length){state.queueMode=false;notify('',false,'idle');return;}const text=state.queue.shift();speakCore(text,()=>{if(!state.queueMode)return;setTimeout(next,250);});}
function isPlayingText(text){return!!(state.audio&&state.playingText===text);}
module.exports={initPlugin,setRate,setEngine,setAccent,speak,speakQueue,stop,togglePause,isPlayingText,isQueueActive:()=>state.queueMode,getEngineInfo:()=>({pluginOk:false,engine:'online',rate:state.rate,accent:state.accent}),onStateChange:(fn)=>{if(typeof fn!=='function')return()=>{};state.listeners.push(fn);return()=>{const i=state.listeners.indexOf(fn);if(i>=0)state.listeners.splice(i,1);};}};
