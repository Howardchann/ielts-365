// utils/speech.js —— 在线朗读（个人版）
// 微信同声传译 TTS 插件不对个人主体开放，本版本不再保留插件路径。
// 朗读链路：① 有道整句 → ② 有道逐词连播 → ③ 百度整句（详见下方「朗读候选链」注释）。
const state={engine:'online',rate:0.9,accent:'us',audio:null,playingText:'',queueMode:false,queue:[],playing:false,paused:false,listeners:[]};
let playToken=0,audioTimeout=null,audioOptDone=false;
function ensureAudioOption(){if(audioOptDone)return;audioOptDone=true;try{if(wx.setInnerAudioOption)wx.setInnerAudioOption({obeyMuteSwitch:false});}catch(e){}}
function initPlugin(){return false;}
function setRate(rate){const r=Math.min(1.3,Math.max(0.7,Number(rate)||0.9));state.rate=r;return r;}
function setEngine(){state.engine='online';}
function setAccent(accent){if(accent==='uk'||accent==='us')state.accent=accent;}
function notify(text,playing,mode){const p={text:text||'',playing:!!playing,source:usedSource||'',mode:mode||(state.queueMode?'queue':(playing?'single':'idle'))};state.listeners.slice().forEach(fn=>{try{fn(p);}catch(e){}});}
function onlineUrl(text){return 'https://dict.youdao.com/dictvoice?audio='+encodeURIComponent(text)+'&type='+(state.accent==='uk'?1:2);}
// 备用朗读源：有道是词典查音，遇到音库未收录的短语会返回 HTTP 500（returned null audio），此时降级到百度 TTS。
// 百度仅英文、无英美音区分，作为兜底足够用。
function fallbackUrl(text){return 'https://fanyi.baidu.com/gettts?lan=en&spd=3&source=web&text='+encodeURIComponent(text);}
function killAudio(audio){if(!audio)return;try{audio.stop();}catch(e){}try{audio.destroy();}catch(e){}}
function cleanup(){if(audioTimeout){clearTimeout(audioTimeout);audioTimeout=null;}if(state.audio){killAudio(state.audio);state.audio=null;}state.playingText='';state.paused=false;}
// ---- 朗读候选链（2026-09-21 实测依据）----
// · 有道 dictvoice 是「词典查音」而非通用 TTS：**单词命中 ~99%，整句仅 ~11%**（未收录的整句返回 HTTP 500）
// · 有道输出 MPEG1 44.1/48kHz，真机播放正常（单词出声已在真机验证）
// · 百度 gettts 是真 TTS、覆盖 100%，但输出 MPEG2 16kHz 24kbps（真机可播性未验证，故降为兜底）
// 故链路顺序：① 有道整句（最自然）→ ② 有道逐词连播（几乎必成）→ ③ 百度整句（兜底）。
// 每个源都是「downloadFile 预检 → 直连播放 → 本地文件重试」：
// 预检能拿到明确 statusCode（500 立刻失败，不必干等播放超时）；直连走 media 通道、校验最宽松。
let failNotes=[],usedSource='';
const DEBUG_FAIL=true; // 诊断期把失败详情弹出来定位问题；稳定后改 false 即恢复一行 toast
function shortErr(e){return String((e&&(e.errMsg||e.errmsg))||e||'').replace(/^[^:]*:fail\s*/,'').slice(0,60);}
function playSrc(src,isFile,onResult,timeoutMs){
  const token=++playToken,host=isFile?'本地文件':src.split('/')[2];
  if(state.audio)killAudio(state.audio);
  const audio=wx.createInnerAudioContext();state.audio=audio;state.paused=false;audio.src=src;audio.playbackRate=state.rate;
  let started=false;
  audioTimeout=setTimeout(()=>{if(token!==playToken||started)return;failNotes.push(host+' 未出声');cleanup();state.playing=false;onResult(false);},timeoutMs||6000);
  audio.onPlay(()=>{if(token!==playToken)return;started=true;state.playing=true;if(audio.playbackRate!==state.rate)audio.playbackRate=state.rate;});
  audio.onEnded(()=>{if(token!==playToken)return;cleanup();state.playing=false;onResult(true);});
  audio.onError(err=>{if(token!==playToken)return;failNotes.push(host+' 播放报错'+(err&&err.errCode?('('+err.errCode+')'):''));cleanup();state.playing=false;onResult(false);});
  audio.play();
}
// downloadFile 预检：拿到明确 statusCode；被白名单拦也能立刻判定
function precheck(url,onPass,onFail){
  const token=++playToken,host=url.split('/')[2];
  wx.downloadFile({url:url,timeout:8000,
    success:res=>{if(token!==playToken)return;if(res.statusCode!==200){failNotes.push(host+' HTTP '+res.statusCode);onFail();return;}onPass(res.tempFilePath);},
    fail:err=>{if(token!==playToken)return;failNotes.push(host+' 下载被拦('+shortErr(err)+')');onFail();}});
}
// 预检通过 → 直连播放（真机已验证通道）→ 仍无声则播刚下好的本地文件
function tryUrl(url,onResult,ms){
  precheck(url,file=>{playSrc(url,false,ok=>{if(ok){onResult(true);return;}playSrc(file,true,onResult,ms);},ms);},()=>onResult(false));
}
// ① 有道整句
function trySentence(text,onResult){tryUrl(onlineUrl(text),onResult,6000);}
// ② 有道逐词连播：整句查不到音时逐词朗读（词典单词覆盖率 ~99%），个别词失败就跳过，不中断
function tryWords(text,onResult){
  const words=String(text).replace(/[^A-Za-z0-9'\-\s]/g,' ').split(/\s+/).filter(Boolean);
  if(words.length<2){onResult(false);return;}
  let i=0,okAny=false;
  const next=()=>{if(i>=words.length){onResult(okAny);return;}playSrc(onlineUrl(words[i++]),false,ok=>{if(ok)okAny=true;next();},3500);};
  next();
}
// ③ 百度整句（真 TTS 兜底）
function tryBaidu(text,onResult){tryUrl(fallbackUrl(text),onResult,7000);}
function playAudio(text,onDone){
  ensureAudioOption();failNotes=[];usedSource='';
  const chain=[
    {name:'有道整句',run:cb=>trySentence(text,cb)},
    {name:'有道逐词',run:cb=>tryWords(text,cb)},
    {name:'百度整句',run:cb=>tryBaidu(text,cb)}
  ];
  let i=0;
  const step=ok=>{
    if(ok){usedSource=chain[i].name;notify(state.playingText,true);if(onDone)onDone(true);return;}
    i++;
    if(i<chain.length){chain[i].run(step);return;}
    const detail=[...new Set(failNotes)].join('\n');
    console.warn('[speech] 朗读失败：\n'+detail);
    if(DEBUG_FAIL&&detail)wx.showModal({title:'朗读失败（诊断）',content:detail,showCancel:false,confirmText:'知道了'});
    else wx.showToast({title:'朗读失败，请检查网络',icon:'none'});
    if(onDone)onDone(false);
  };
  chain[0].run(step);
}
function stop(){playToken++;state.queue=[];state.queueMode=false;cleanup();state.playing=false;notify('',false,'idle');}
function togglePause(){const audio=state.audio;if(!audio)return'none';if(state.paused){audio.play();state.paused=false;state.playing=true;notify(state.playingText,true);return'resumed';}audio.pause();state.paused=true;state.playing=false;notify(state.playingText,false);return'paused';}
function speakCore(text,onDone){state.playingText=text;state.playing=true;playAudio(text,ok=>{if(state.queueMode){if(onDone)onDone(ok);return;}if(!ok){stop();if(onDone)onDone(false);}else{if(onDone)onDone(true);notify('',false,'idle');}});notify(text,true);}
function speak(text,onDone){text=String(text||'').trim();if(!text){if(onDone)onDone(false);return;}if(state.queueMode){state.queue=[];state.queueMode=false;}speakCore(text,onDone);}
function speakQueue(texts){stop();state.queue=(texts||[]).map(v=>String(v||'').trim()).filter(Boolean);if(!state.queue.length)return;state.queueMode=true;next();}
function next(){if(!state.queueMode||!state.queue.length){state.queueMode=false;notify('',false,'idle');return;}const text=state.queue.shift();speakCore(text,()=>{if(!state.queueMode)return;setTimeout(next,250);});}
function isPlayingText(text){return!!(state.audio&&state.playingText===text);}
module.exports={initPlugin,setRate,setEngine,setAccent,speak,speakQueue,stop,togglePause,isPlayingText,isQueueActive:()=>state.queueMode,getEngineInfo:()=>({pluginOk:false,engine:'online',rate:state.rate,accent:state.accent}),onStateChange:(fn)=>{if(typeof fn!=='function')return()=>{};state.listeners.push(fn);return()=>{const i=state.listeners.indexOf(fn);if(i>=0)state.listeners.splice(i,1);};}};
