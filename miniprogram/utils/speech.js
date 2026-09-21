// utils/speech.js —— 在线朗读（个人版）
// 微信同声传译 TTS 插件不对个人主体开放，本版本不再保留插件路径。
// 统一使用有道在线朗读：type=2 美音，type=1 英音。
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
function getTimeoutMs(text){const chars=String(text||'').length;const rateFactor=1/Math.max(0.7,state.rate);return Math.min(30000,Math.max(12000,8000+chars*140*rateFactor));}
function playAudio(src,onDone,text,allowFallback){
  ensureAudioOption();if(state.audio)killAudio(state.audio);
  const token=++playToken;
  const fail=()=>{if(token!==playToken)return;cleanup();state.playing=false;if(allowFallback){playAudio(fallbackUrl(text),onDone,text,false);return;}wx.showToast({title:'朗读失败，请检查网络',icon:'none'});if(onDone)onDone(false);};
  // 先用 downloadFile 把音频下到本地再播：真机上 InnerAudioContext 直连外链若返回 500/被拦，
  // onError 可能不回调，导致静默无声且无法降级。downloadFile 能拿到明确 statusCode。
  wx.downloadFile({url:src,timeout:15000,
    success:res=>{if(token!==playToken)return;if(res.statusCode!==200){fail();return;}startPlay(res.tempFilePath);},
    fail:()=>fail()});
  function startPlay(file){
    if(token!==playToken)return;
    const audio=wx.createInnerAudioContext();state.audio=audio;state.paused=false;audio.src=file;audio.playbackRate=state.rate;
    audioTimeout=setTimeout(()=>{if(token!==playToken)return;cleanup();state.playing=false;if(allowFallback){playAudio(fallbackUrl(text),onDone,text,false);return;}wx.showToast({title:'朗读超时，请检查网络',icon:'none'});if(onDone)onDone(false);notify('',false,'idle');},getTimeoutMs(text));
    audio.onPlay(()=>{if(token!==playToken)return;state.playing=true;if(audio.playbackRate!==state.rate)audio.playbackRate=state.rate;});
    audio.onEnded(()=>{if(token!==playToken)return;cleanup();state.playing=false;if(onDone)onDone(true);});
    audio.onError(()=>fail());
    audio.play();
  }
}
function stop(){playToken++;state.queue=[];state.queueMode=false;cleanup();state.playing=false;notify('',false,'idle');}
function togglePause(){const audio=state.audio;if(!audio)return'none';if(state.paused){audio.play();state.paused=false;state.playing=true;notify(state.playingText,true);return'resumed';}audio.pause();state.paused=true;state.playing=false;notify(state.playingText,false);return'paused';}
function speakCore(text,onDone){state.playingText=text;state.playing=true;playAudio(onlineUrl(text),ok=>{if(state.queueMode){if(onDone)onDone(ok);return;}if(!ok){stop();if(onDone)onDone(false);}else{if(onDone)onDone(true);notify('',false,'idle');}},text,true);notify(text,true);}
function speak(text,onDone){text=String(text||'').trim();if(!text){if(onDone)onDone(false);return;}if(state.queueMode){state.queue=[];state.queueMode=false;}speakCore(text,onDone);}
function speakQueue(texts){stop();state.queue=(texts||[]).map(v=>String(v||'').trim()).filter(Boolean);if(!state.queue.length)return;state.queueMode=true;next();}
function next(){if(!state.queueMode||!state.queue.length){state.queueMode=false;notify('',false,'idle');return;}const text=state.queue.shift();speakCore(text,()=>{if(!state.queueMode)return;setTimeout(next,250);});}
function isPlayingText(text){return!!(state.audio&&state.playingText===text);}
module.exports={initPlugin,setRate,setEngine,setAccent,speak,speakQueue,stop,togglePause,isPlayingText,isQueueActive:()=>state.queueMode,getEngineInfo:()=>({pluginOk:false,engine:'online',rate:state.rate,accent:state.accent}),onStateChange:(fn)=>{if(typeof fn!=='function')return()=>{};state.listeners.push(fn);return()=>{const i=state.listeners.indexOf(fn);if(i>=0)state.listeners.splice(i,1);};}};
