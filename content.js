(() => {
  'use strict';
  if (window.__vvtLoaded) return;
  window.__vvtLoaded = true;

  const LANGUAGES = [['auto','Авто'],['en','Английский'],['ru','Русский'],['fr','Французский'],['de','Немецкий'],['es','Испанский'],['it','Итальянский'],['zh','Китайский'],['ja','Японский'],['ko','Корейский']];
  const DEFAULTS = { source:'en', target:'ru', voiceMode:'natural', showCaptions:true, originalVolume:18, autoTranslate:false };
  const s = { prefs:{...DEFAULTS}, prefsLoaded:false, autoAttempt:null, video:null, videoSrc:'', player:null, ui:null, subtitle:null, active:false, starting:false, session:0, request:0, translator:null, detector:null, detected:'', originalVolume:null, originalMuted:null, originalCaptions:null, tracks:[], last:'', lastSpoken:'', lastSpokenAt:0, pending:'', pendingSince:0, timer:null, speechQueue:[], currentUtterance:null, hideTimer:null, captionObserver:null, captionContainer:null, keyboardFocus:false, seen:0, url:location.href };

  const node = (selector) => s.ui?.querySelector(selector);
  const isYouTube = () => /(^|\.)youtube\.com$/.test(location.hostname) && s.player?.matches('.html5-video-player');
  function status(text) { const element=node('.vvt-status'); if(element){element.textContent=text; element.title=text;} }
  function save() { chrome.storage.sync.set({videoVoiceTranslate:s.prefs}).catch(()=>{}); }
  function scheduleHide() {
    clearTimeout(s.hideTimer);
    if(s.starting || !node('.vvt-menu')?.hidden ||
       (s.keyboardFocus && s.ui?.contains(document.activeElement))) return;
    s.hideTimer=setTimeout(()=>s.ui?.classList.add('vvt-hidden'),2400);
  }
  function showWidget() {
    if(!s.video?.isConnected || !s.ui) return;
    s.ui.classList.remove('vvt-hidden');
    scheduleHide();
  }
  function onPointerMove(event) {
    if(!s.video?.isConnected) return;
    s.keyboardFocus=false;
    const rect=s.video.getBoundingClientRect();
    if(s.ui?.contains(event.target) ||
      (event.clientX>=rect.left && event.clientX<=rect.right &&
       event.clientY>=rect.top && event.clientY<=rect.bottom)) showWidget();
  }
  function render() {
    if(!s.ui) return;
    for(const [key,selector] of [['source','.vvt-source'],['target','.vvt-target'],['voiceMode','.vvt-mode'],['originalVolume','.vvt-volume']]) node(selector).value=s.prefs[key];
    node('.vvt-captions').checked=s.prefs.showCaptions;
    node('.vvt-auto').checked=s.prefs.autoTranslate;
    node('.vvt-volume-value').textContent=`${s.prefs.originalVolume}%`;
    node('.vvt-toggle').textContent='Озвучить';
    node('.vvt-toggle').setAttribute('aria-pressed',String(s.active));
    node('.vvt-toggle').title=s.active?'Выключить озвучивание':s.starting?'Подготовка перевода':'Включить озвучивание';
    node('.vvt-toggle').disabled=s.starting;
    s.ui.classList.toggle('vvt-active',s.active);
    s.subtitle.hidden=!s.active||!s.prefs.showCaptions||!s.subtitle.textContent;
  }
  function makeUi() {
    s.ui=document.createElement('div');
    s.ui.id='vvt-panel';
    s.ui.classList.add('vvt-hidden');
    s.ui.setAttribute('role','group');
    s.ui.setAttribute('aria-label','Перевод видео');
    s.ui.innerHTML=`<div class="vvt-bar"><button type="button" class="vvt-toggle">Озвучить</button><span class="vvt-divider" aria-hidden="true"></span><button class="vvt-pip" type="button" aria-label="Открыть видео в отдельном окне" title="Отдельное окно"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="19" height="15.5" rx="3"/><rect x="11" y="10" width="8" height="6.5" rx="1"/></svg></button><button type="button" class="vvt-more" aria-label="Настройки перевода" aria-expanded="false" title="Настройки">⋯</button></div><div class="vvt-status" role="status" aria-live="polite"></div><div class="vvt-menu" hidden><div class="vvt-menu-title">Перевод видео</div><div class="vvt-language-grid"><label><span>С языка</span><select class="vvt-source" aria-label="Исходный язык"></select></label><span class="vvt-arrow">›</span><label><span>На язык</span><select class="vvt-target" aria-label="Язык перевода"></select></label></div><label class="vvt-row"><span>Переводить автоматически</span><input class="vvt-auto" type="checkbox"></label><label class="vvt-row"><span>Голос</span><select class="vvt-mode"><option value="standard">Обычный</option><option value="natural">Живой</option></select></label><label class="vvt-row"><span>Субтитры перевода</span><input class="vvt-captions" type="checkbox"></label><label class="vvt-volume-row"><span>Громкость оригинала <output class="vvt-volume-value"></output></span><input class="vvt-volume" type="range" min="0" max="100" step="1"></label></div>`;
    for(const [code,label] of LANGUAGES){
      for(const selector of code==='auto'?['.vvt-source']:['.vvt-source','.vvt-target']){
        const option=document.createElement('option'); option.value=code; option.textContent=label; node(selector).append(option);
      }
    }
    s.subtitle=document.createElement('div'); s.subtitle.id='vvt-subtitle'; s.subtitle.hidden=true;
    node('.vvt-toggle').addEventListener('click',()=>{if(s.active){s.autoAttempt={video:s.video,url:location.href,src:s.videoSrc};stop();}else start();});
    for(const [key,selector] of [['source','.vvt-source'],['target','.vvt-target']]){
      node(selector).addEventListener('change',()=>{s.prefs[key]=node(selector).value;save();if(s.active||s.starting)stop();render();});
    }
    node('.vvt-mode').addEventListener('change',()=>{s.prefs.voiceMode=node('.vvt-mode').value;save();clearSpeech();});
    node('.vvt-captions').addEventListener('change',()=>{s.prefs.showCaptions=node('.vvt-captions').checked;save();render();});
    node('.vvt-auto').addEventListener('change',()=>{s.prefs.autoTranslate=node('.vvt-auto').checked;if(s.prefs.autoTranslate)s.autoAttempt=null;save();if(s.prefs.autoTranslate)maybeAutoStart();render();});
    node('.vvt-volume').addEventListener('input',()=>{s.prefs.originalVolume=Number(node('.vvt-volume').value);node('.vvt-volume-value').textContent=`${s.prefs.originalVolume}%`;if(s.active)applyVolume();save();});
    node('.vvt-more').addEventListener('click',()=>{
      const menu=node('.vvt-menu');
      menu.hidden=!menu.hidden;
      node('.vvt-more').setAttribute('aria-expanded',String(!menu.hidden));
      showWidget();
    });
    node('.vvt-pip').addEventListener('click',togglePictureInPicture);
    s.ui.addEventListener('click',event=>event.stopPropagation());
    s.ui.addEventListener('pointerdown',event=>{s.keyboardFocus=false;event.stopPropagation();});
    s.ui.addEventListener('focusin',showWidget);
    s.ui.addEventListener('focusout',()=>setTimeout(scheduleHide,0));
    render();
  }
  async function togglePictureInPicture() {
    const video=s.video;
    if(!video?.isConnected){status('Видео не найдено');return;}
    if(!document.pictureInPictureEnabled || video.disablePictureInPicture ||
       typeof video.requestPictureInPicture!=='function'){
      status('Этот плеер не поддерживает отдельное окно');
      showWidget();
      return;
    }
    if(document.pictureInPictureElement!==video && video.readyState<1){
      status('Дождитесь загрузки видео');
      showWidget();
      return;
    }
    try {
      if(document.pictureInPictureElement===video) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
      status('');
    } catch(error) {
      const reason=error?.name==='NotAllowedError'
        ? 'Chrome не разрешил открыть окно. Нажмите кнопку ещё раз.'
        : error?.name==='InvalidStateError'
          ? 'Видео ещё не готово или плеер запрещает отдельное окно.'
          : error?.message || 'Неизвестная ошибка';
      status(reason);
      showWidget();
    }
  }
  function restoreCaptions(){
    document.documentElement.classList.remove('vvt-hide-source-captions');
    if(s.originalCaptions===false&&isYouTube()){
      const button=s.player?.querySelector('.ytp-subtitles-button');
      if(button?.getAttribute('aria-pressed')==='true')button.click();
    }
    s.originalCaptions=null;
    for(const {track,mode} of s.tracks){try{track.mode=mode;}catch(_){}}
    s.tracks=[];
  }
  function stop(){
    s.session++;s.request++;s.active=false;s.starting=false;clearTimeout(s.timer);s.timer=null;
    clearSpeech();s.translator?.destroy?.();s.detector?.destroy?.();s.translator=s.detector=null;s.detected='';
    restoreCaptions();
    if(s.video?.isConnected&&s.originalVolume!==null){s.video.volume=s.originalVolume;s.video.muted=s.originalMuted;}
    s.originalVolume=s.originalMuted=null;s.last=s.pending=s.lastSpoken='';s.pendingSince=s.lastSpokenAt=0;
    if(s.subtitle)s.subtitle.textContent='';
    status('');render();
  }
  function applyVolume(){if(!s.video)return;s.video.volume=s.prefs.originalVolume/100;s.video.muted=s.prefs.originalVolume===0;}
  function setupCaptions(){
    document.documentElement.classList.add('vvt-hide-source-captions');
    if(isYouTube()){
      const button=s.player.querySelector('.ytp-subtitles-button');
      if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')throw Error('У видео нет доступных субтитров YouTube');
      s.originalCaptions=button.getAttribute('aria-pressed')==='true';
      if(!s.originalCaptions)button.click();
      return;
    }
    const tracks=Array.from(s.video.textTracks||[]);
    s.tracks=tracks.map(track=>({track,mode:track.mode}));
    const chosen=tracks.find(track=>track.mode==='showing')||tracks.find(track=>['captions','subtitles'].includes(track.kind));
    if(chosen)chosen.mode='hidden';
  }
  function captionText(){
    if(!s.video)return '';
    if(isYouTube())return Array.from(s.player.querySelectorAll('.ytp-caption-window-container .ytp-caption-segment'),element=>element.textContent.trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    for(const track of s.video.textTracks||[]){
      if(track.mode==='disabled'||!track.activeCues?.length)continue;
      const text=Array.from(track.activeCues,cue=>cue.text||'').join(' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
      if(text)return text;
    }
    return Array.from(s.player?.querySelectorAll('.vjs-text-track-display .vjs-cue, .plyr__captions, .jw-text-track-cue')||[],element=>element.textContent.trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  }
  const wordPattern=/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  function normalizeCaption(text){
    return text.replace(/\[(?:music|applause|laughter|музыка|аплодисменты|смех)\]/gi,'').replace(/[♪♫]+|>>/g,' ').replace(/\s+/g,' ').trim();
  }
  function speechKey(text){return (text.match(wordPattern)||[]).join(' ').toLocaleLowerCase();}
  function unspokenCaption(text){
    const current=Array.from(text.matchAll(wordPattern));
    const previous=(s.last.match(wordPattern)||[]).map(word=>word.toLocaleLowerCase());
    for(let count=Math.min(current.length,previous.length);count>0;count--){
      if(current.slice(0,count).every((match,index)=>match[0].toLocaleLowerCase()===previous[previous.length-count+index])){
        return count===current.length?'':text.slice(current[count].index).trim();
      }
    }
    return text;
  }
  function chooseVoice(){
    const voices=speechSynthesis.getVoices().filter(voice=>voice.lang.toLowerCase().split('-')[0]===s.prefs.target);
    if(s.prefs.voiceMode==='standard')return voices.find(voice=>voice.localService)||voices[0];
    return voices.find(voice=>/enhanced|premium|natural|neural|siri/i.test(voice.name))||voices.find(voice=>!voice.localService)||voices[0];
  }
  function clearSpeech(){
    s.speechQueue.length=0;
    s.currentUtterance=null;
    speechSynthesis.cancel();
    if(s.subtitle){s.subtitle.textContent='';render();}
  }
  function playNextSpeech(){
    if(s.currentUtterance||!s.active||s.video?.paused||s.video?.ended)return;
    const next=s.speechQueue.shift();
    if(!next)return;
    if(next.session!==s.session){playNextSpeech();return;}
    const {text}=next;
    const utterance=new SpeechSynthesisUtterance(text);
    s.currentUtterance=utterance;
    utterance.lang=s.prefs.target;
    utterance.rate=Math.min(1.4,Math.max(1.1,s.video.playbackRate*1.12));
    const voice=chooseVoice();if(voice)utterance.voice=voice;
    utterance.onstart=()=>{
      if(s.currentUtterance!==utterance)return;
      s.subtitle.textContent=text;render();status('');
    };
    const finish=()=>{
      if(s.currentUtterance!==utterance)return;
      s.currentUtterance=null;
      playNextSpeech();
    };
    utterance.onend=finish;
    utterance.onerror=finish;
    try{speechSynthesis.speak(utterance);}catch(error){finish();status(error.message||String(error));}
  }
  function speak(text,request){
    if(!s.active||request!==s.request||s.video.paused||s.video.ended)return;
    s.speechQueue.push({text,session:s.session});
    playNextSpeech();
  }
  async function sourceFor(text){
    if(s.prefs.source!=='auto')return s.prefs.source;
    if(s.detected)return s.detected;
    const track=Array.from(s.video.textTracks||[]).find(item=>item.mode!=='disabled'&&item.language);
    if(track?.language)return s.detected=track.language.toLowerCase().split('-')[0];
    if(!s.detector)throw Error('Автоопределение недоступно');
    const results=await s.detector.detect(text);
    const best=results.reduce((current,result)=>result.confidence>current.confidence?result:current,{detectedLanguage:'',confidence:0});
    if(!best.detectedLanguage||best.confidence<0.35)throw Error('Не удалось определить язык. Выберите его вручную');
    s.detected=best.detectedLanguage.toLowerCase().split('-')[0];return s.detected;
  }
  async function translateCaption(text,session,request){
    try{
      const source=await sourceFor(text);
      if(session!==s.session||request!==s.request)return;
      const fresh=unspokenCaption(text);
      if(!speechKey(fresh)){s.last=text;return;}
      let translated=fresh;
      if(source!==s.prefs.target){
        if(!s.translator)s.translator=await Translator.create({sourceLanguage:source,targetLanguage:s.prefs.target});
        translated=await s.translator.translate(fresh);
      }
      if(session!==s.session||request!==s.request||text!==normalizeCaption(captionText()))return;
      s.last=text;
      const key=speechKey(translated);
      if(!key){status('');return;}
      if(key===s.lastSpoken&&Date.now()-s.lastSpokenAt<8000){status('');return;}
      s.lastSpoken=key;s.lastSpokenAt=Date.now();
      speak(translated,request);
    }catch(error){if(session===s.session)status(error.message||String(error));}
  }
  function checkCaptions(){
    if(!s.active||!s.video||s.video.paused||s.video.ended)return;
    const text=normalizeCaption(captionText());
    if(!speechKey(text)){
      s.pending='';s.pendingSince=0;clearTimeout(s.timer);
      if(Date.now()-s.lastSpokenAt>3000)s.last='';
      return;
    }
    s.seen=Date.now();if(text===s.pending||text===s.last)return;
    if(!s.pendingSince||!text.startsWith(s.pending))s.pendingSince=Date.now();
    s.pending=text;clearTimeout(s.timer);
    const delay=Math.max(0,Math.min(550,1800-(Date.now()-s.pendingSince)));
    const commit=()=>{
      if(!s.active||s.video.paused||normalizeCaption(captionText())!==s.pending)return;
      const fresh=unspokenCaption(s.pending);
      const age=Date.now()-s.pendingSince;
      if((fresh.match(wordPattern)||[]).length===1&&!/[.!?…]$/.test(fresh)&&age<1100){
        s.timer=setTimeout(commit,1100-age);
        return;
      }
      const current=s.pending;s.pendingSince=0;
      translateCaption(current,s.session,++s.request);
    };
    s.timer=setTimeout(commit,delay);
  }
  function observeCaptions() {
    const container=isYouTube()?s.player.querySelector('.ytp-caption-window-container'):null;
    if(container===s.captionContainer)return;
    s.captionObserver?.disconnect();
    s.captionContainer=container;
    if(!container)return;
    s.captionObserver=new MutationObserver(checkCaptions);
    s.captionObserver.observe(container,{subtree:true,childList:true,characterData:true});
  }
  async function start(){
    if(!s.video||s.active||s.starting)return;
    s.starting=true;const session=++s.session;render();status('Подготовка…');
    try{
      if(!('Translator' in globalThis))throw Error('В Chrome недоступен Translator API');
      if(s.prefs.source==='auto'){
        if(!('LanguageDetector' in globalThis))throw Error('Автоопределение недоступно — выберите язык вручную');
        const promise=LanguageDetector.create();
        const created=await promise;
        if(session!==s.session){created.destroy?.();return;}
        s.detector=created;
      }else if(s.prefs.source!==s.prefs.target){
        const promise=Translator.create({sourceLanguage:s.prefs.source,targetLanguage:s.prefs.target,monitor(monitor){monitor.addEventListener('downloadprogress',event=>{if(session===s.session)status(`Загрузка языкового пакета: ${Math.round(event.loaded*100)}%`);});}});
        const created=await promise;
        if(session!==s.session){created.destroy?.();return;}
        s.translator=created;
      }
      if(session!==s.session)return;
      setupCaptions();s.originalVolume=s.video.volume;s.originalMuted=s.video.muted;applyVolume();
      s.active=true;s.starting=false;s.seen=Date.now();render();status('');checkCaptions();
    }catch(error){if(session!==s.session)return;const message=error.message||String(error);stop();status(message);showWidget();}
  }
  function maybeAutoStart(){
    if(!s.prefsLoaded||!s.prefs.autoTranslate||!s.video||s.active||s.starting)return;
    if(s.autoAttempt?.video===s.video&&s.autoAttempt.url===location.href&&s.autoAttempt.src===s.videoSrc)return;
    s.autoAttempt={video:s.video,url:location.href,src:s.videoSrc};
    start();
  }
  function onPauseOrSeek(){
    clearSpeech();clearTimeout(s.timer);s.last=s.pending=s.lastSpoken='';s.pendingSince=s.lastSpokenAt=0;s.request++;
  }
  function findVideo(){
    if(/(^|\.)youtube\.com$/.test(location.hostname)&&location.pathname==='/watch'){
      const player=document.querySelector('.html5-video-player');const video=player?.querySelector('video');
      return video?{video,player}:null;
    }
    const videos=Array.from(document.querySelectorAll('video')).filter(video=>{const rect=video.getBoundingClientRect();return rect.width>=180&&rect.height>=100;}).sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return y.width*y.height-x.width*x.height;});
    const video=videos[0];return video?{video,player:video.parentElement||video}:null;
  }
  function position(){
    if(!s.video||!s.ui)return;
    const rect=s.video.getBoundingClientRect();
    const width=Math.min(290,Math.max(220,rect.width-16),innerWidth-24);
    s.ui.style.setProperty('--vvt-width',`${width}px`);
    s.ui.style.top=`${Math.max(12,rect.top+10)}px`;
    s.ui.style.left=`${Math.max(12,Math.min(innerWidth-width-12,rect.left+(rect.width-width)/2))}px`;
    s.ui.classList.toggle('vvt-narrow',width<265);
    s.subtitle.style.left=`${Math.max(8,rect.left+8)}px`;
    s.subtitle.style.width=`${Math.max(180,rect.width-16)}px`;
    s.subtitle.style.bottom=`${Math.max(20,innerHeight-rect.bottom+50)}px`;
  }
  function attach(){
    const found=findVideo();
    if(!found){
      if(s.active||s.starting)stop();
      s.captionObserver?.disconnect();
      s.captionObserver=s.captionContainer=null;
      s.ui?.remove();s.subtitle?.remove();s.video=s.player=null;s.videoSrc='';return;
    }
    if(found.video!==s.video){
      if(s.active||s.starting)stop();
      clearTimeout(s.hideTimer);
      s.ui.classList.add('vvt-hidden');
      node('.vvt-menu').hidden=true;
      node('.vvt-more').setAttribute('aria-expanded','false');
      s.captionObserver?.disconnect();
      s.captionObserver=s.captionContainer=null;
      if(s.video){s.video.removeEventListener('pause',onPauseOrSeek);s.video.removeEventListener('seeking',onPauseOrSeek);}
      s.video=found.video;s.player=found.player;
      s.videoSrc=s.video.currentSrc||s.video.src||'';
      s.video.addEventListener('pause',onPauseOrSeek);s.video.addEventListener('seeking',onPauseOrSeek);
    }
    const currentSrc=s.video.currentSrc||s.video.src||'';
    if(currentSrc&&s.videoSrc&&currentSrc!==s.videoSrc&&(s.active||s.starting))stop();
    s.videoSrc=currentSrc;
    const host=document.fullscreenElement||document.body;
    if(s.ui.parentElement!==host)host.append(s.ui);
    if(s.subtitle.parentElement!==host)host.append(s.subtitle);
    observeCaptions();
    position();
    maybeAutoStart();
  }
  makeUi();
  document.addEventListener('keydown',event=>{if(event.key==='Tab')s.keyboardFocus=true;},true);
  document.addEventListener('pointermove',onPointerMove,{passive:true});
  chrome.storage.sync.get({videoVoiceTranslate:DEFAULTS}).then(({videoVoiceTranslate})=>{
    for(const key of Object.keys(DEFAULTS)){if(typeof videoVoiceTranslate?.[key]===typeof DEFAULTS[key])s.prefs[key]=videoVoiceTranslate[key];}
    s.prefsLoaded=true;
    render();
    maybeAutoStart();
  }).catch(()=>{s.prefsLoaded=true;maybeAutoStart();});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='sync'||!changes.videoVoiceTranslate?.newValue)return;
    const next=changes.videoVoiceTranslate.newValue;
    const languagesChanged=next.source!==s.prefs.source||next.target!==s.prefs.target;
    for(const key of Object.keys(DEFAULTS)){if(typeof next[key]===typeof DEFAULTS[key])s.prefs[key]=next[key];}
    if(languagesChanged&&(s.active||s.starting))stop();
    if(s.active)applyVolume();
    render();maybeAutoStart();
  });
  setInterval(()=>{if(location.href!==s.url){s.url=location.href;if(s.active||s.starting)stop();}attach();checkCaptions();},120);
  attach();
})();
