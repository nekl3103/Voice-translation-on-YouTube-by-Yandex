(() => {
  'use strict';
  if (window.__vvtLoaded) return;
  window.__vvtLoaded = true;

  const LANGUAGES = [['auto','Авто'],['en','Английский'],['ru','Русский'],['fr','Французский'],['de','Немецкий'],['es','Испанский'],['it','Итальянский'],['zh','Китайский'],['ja','Японский'],['ko','Корейский']];
  const DEFAULTS = { source:'en', target:'ru', voiceMode:'natural', showCaptions:true, originalVolume:18 };
  const s = { prefs:{...DEFAULTS}, video:null, player:null, ui:null, subtitle:null, active:false, starting:false, session:0, request:0, translator:null, detector:null, detected:'', originalVolume:null, originalMuted:null, originalCaptions:null, tracks:[], last:'', pending:'', timer:null, seen:0, url:location.href };

  const node = (selector) => s.ui?.querySelector(selector);
  const isYouTube = () => /(^|\.)youtube\.com$/.test(location.hostname) && s.player?.matches('.html5-video-player');
  function status(text) { const element=node('.vvt-status'); if(element){element.textContent=text; element.title=text;} }
  function save() { chrome.storage.sync.set({videoVoiceTranslate:s.prefs}).catch(()=>{}); }
  function render() {
    if(!s.ui) return;
    for(const [key,selector] of [['source','.vvt-source'],['target','.vvt-target'],['voiceMode','.vvt-mode'],['originalVolume','.vvt-volume']]) node(selector).value=s.prefs[key];
    node('.vvt-captions').checked=s.prefs.showCaptions;
    node('.vvt-volume-value').textContent=`${s.prefs.originalVolume}%`;
    node('.vvt-toggle').textContent=s.active?'Выключить':s.starting?'Подготовка…':'Перевести и озвучить';
    node('.vvt-toggle').disabled=s.starting;
    s.ui.classList.toggle('vvt-active',s.active);
    s.subtitle.hidden=!s.active||!s.prefs.showCaptions||!s.subtitle.textContent;
  }
  function makeUi() {
    s.ui=document.createElement('div');
    s.ui.id='vvt-panel';
    s.ui.setAttribute('role','group');
    s.ui.setAttribute('aria-label','Перевод видео');
    s.ui.innerHTML=`<div class="vvt-bar"><span class="vvt-brand" aria-hidden="true">◉</span><button type="button" class="vvt-toggle">Перевести и озвучить</button><span class="vvt-divider"></span><label class="vvt-lang"><span>С</span><select class="vvt-source" aria-label="Исходный язык"></select></label><span class="vvt-arrow">→</span><label class="vvt-lang"><span>На</span><select class="vvt-target" aria-label="Язык перевода"></select></label><button type="button" class="vvt-more" aria-label="Настройки" aria-expanded="false">⋯</button></div><div class="vvt-status" role="status" aria-live="polite"></div><div class="vvt-menu" hidden><label class="vvt-row"><span>Голос</span><select class="vvt-mode"><option value="standard">Обычный</option><option value="natural">Живой</option></select></label><label class="vvt-row"><span>Субтитры перевода</span><input class="vvt-captions" type="checkbox"></label><label class="vvt-volume-row"><span>Громкость оригинала <output class="vvt-volume-value"></output></span><input class="vvt-volume" type="range" min="0" max="100" step="1"></label><button class="vvt-pip" type="button">▣ Открыть видео в отдельном окне</button><button class="vvt-options" type="button">⚙ Другие сайты и инкогнито</button></div>`;
    for(const [code,label] of LANGUAGES){
      for(const selector of code==='auto'?['.vvt-source']:['.vvt-source','.vvt-target']){
        const option=document.createElement('option'); option.value=code; option.textContent=label; node(selector).append(option);
      }
    }
    s.subtitle=document.createElement('div'); s.subtitle.id='vvt-subtitle'; s.subtitle.hidden=true;
    node('.vvt-toggle').addEventListener('click',()=>s.active?stop():start());
    for(const [key,selector] of [['source','.vvt-source'],['target','.vvt-target']]){
      node(selector).addEventListener('change',()=>{s.prefs[key]=node(selector).value;save();if(s.active||s.starting)stop();render();});
    }
    node('.vvt-mode').addEventListener('change',()=>{s.prefs.voiceMode=node('.vvt-mode').value;save();speechSynthesis.cancel();});
    node('.vvt-captions').addEventListener('change',()=>{s.prefs.showCaptions=node('.vvt-captions').checked;save();render();});
    node('.vvt-volume').addEventListener('input',()=>{s.prefs.originalVolume=Number(node('.vvt-volume').value);node('.vvt-volume-value').textContent=`${s.prefs.originalVolume}%`;if(s.active)applyVolume();save();});
    node('.vvt-more').addEventListener('click',()=>{const menu=node('.vvt-menu');menu.hidden=!menu.hidden;node('.vvt-more').setAttribute('aria-expanded',String(!menu.hidden));});
    node('.vvt-options').addEventListener('click',()=>chrome.runtime.openOptionsPage());
    node('.vvt-pip').addEventListener('click',async()=>{try{if(!s.video||!document.pictureInPictureEnabled)throw Error('Отдельное окно недоступно');if(document.pictureInPictureElement===s.video)await document.exitPictureInPicture();else await s.video.requestPictureInPicture();}catch(error){status(error.message||String(error));}});
    s.ui.addEventListener('click',event=>event.stopPropagation());
    s.ui.addEventListener('pointerdown',event=>event.stopPropagation());
    render();
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
    speechSynthesis.cancel();s.translator?.destroy?.();s.detector?.destroy?.();s.translator=s.detector=null;s.detected='';
    restoreCaptions();
    if(s.video?.isConnected&&s.originalVolume!==null){s.video.volume=s.originalVolume;s.video.muted=s.originalMuted;}
    s.originalVolume=s.originalMuted=null;s.last=s.pending='';
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
  function chooseVoice(){
    const voices=speechSynthesis.getVoices().filter(voice=>voice.lang.toLowerCase().split('-')[0]===s.prefs.target);
    if(s.prefs.voiceMode==='standard')return voices.find(voice=>voice.localService)||voices[0];
    return voices.find(voice=>/enhanced|premium|natural|neural|siri/i.test(voice.name))||voices.find(voice=>!voice.localService)||voices[0];
  }
  function speak(text,request){
    if(!s.active||request!==s.request||s.video.paused||s.video.ended)return;
    speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(text);
    utterance.lang=s.prefs.target;
    utterance.rate=Math.min(1.35,Math.max(1,s.video.playbackRate));
    const voice=chooseVoice();if(voice)utterance.voice=voice;
    speechSynthesis.speak(utterance);
    s.subtitle.textContent=text;render();status('Перевод включён');
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
    s.detected=best.detectedLanguage.toLowerCase().split('-')[0];status(`Определён язык: ${s.detected}`);return s.detected;
  }
  async function translateCaption(text,session,request){
    try{
      const source=await sourceFor(text);
      if(session!==s.session||request!==s.request)return;
      let translated=text;
      if(source!==s.prefs.target){
        if(!s.translator){status('Подготовка перевода…');s.translator=await Translator.create({sourceLanguage:source,targetLanguage:s.prefs.target});}
        translated=await s.translator.translate(text);
      }
      if(session!==s.session||request!==s.request||text!==captionText())return;
      speak(translated,request);
    }catch(error){if(session===s.session)status(error.message||String(error));}
  }
  function checkCaptions(){
    if(!s.active||!s.video||s.video.paused||s.video.ended)return;
    const text=captionText();
    if(!text){s.pending='';if(Date.now()-s.seen>10000)status('Ждём субтитры этого видео');return;}
    s.seen=Date.now();if(text===s.pending||text===s.last)return;
    s.pending=text;clearTimeout(s.timer);
    s.timer=setTimeout(()=>{if(!s.active||s.video.paused||captionText()!==s.pending)return;s.last=s.pending;translateCaption(s.pending,s.session,++s.request);},300);
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
      s.active=true;s.starting=false;s.seen=Date.now();render();status('Ждём субтитры этого видео');checkCaptions();
    }catch(error){if(session!==s.session)return;const message=error.message||String(error);stop();status(message);}
  }
  function onPauseOrSeek(){
    speechSynthesis.cancel();clearTimeout(s.timer);s.last=s.pending='';s.request++;
    if(s.subtitle){s.subtitle.textContent='';render();}
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
    const width=Math.min(620,Math.max(300,rect.width-20));
    s.ui.style.setProperty('--vvt-width',`${width}px`);
    s.ui.style.top=`${Math.max(12,rect.top+12)}px`;
    s.ui.style.right=`${Math.min(Math.max(12,innerWidth-rect.right+12),Math.max(12,innerWidth-width-12))}px`;
    s.subtitle.style.left=`${Math.max(8,rect.left+8)}px`;
    s.subtitle.style.width=`${Math.max(180,rect.width-16)}px`;
    s.subtitle.style.bottom=`${Math.max(20,innerHeight-rect.bottom+50)}px`;
  }
  function attach(){
    const found=findVideo();
    if(!found){if(s.active||s.starting)stop();s.ui?.remove();s.subtitle?.remove();s.video=s.player=null;return;}
    if(found.video!==s.video){
      if(s.active||s.starting)stop();
      if(s.video){s.video.removeEventListener('pause',onPauseOrSeek);s.video.removeEventListener('seeking',onPauseOrSeek);}
      s.video=found.video;s.player=found.player;
      s.video.addEventListener('pause',onPauseOrSeek);s.video.addEventListener('seeking',onPauseOrSeek);
    }
    const host=document.fullscreenElement||document.body;
    if(s.ui.parentElement!==host)host.append(s.ui);
    if(s.subtitle.parentElement!==host)host.append(s.subtitle);
    position();
  }
  makeUi();
  chrome.storage.sync.get({videoVoiceTranslate:DEFAULTS}).then(({videoVoiceTranslate})=>{
    for(const key of Object.keys(DEFAULTS)){if(typeof videoVoiceTranslate?.[key]===typeof DEFAULTS[key])s.prefs[key]=videoVoiceTranslate[key];}
    render();
  }).catch(()=>{});
  setInterval(()=>{if(location.href!==s.url){s.url=location.href;if(s.active||s.starting)stop();}attach();checkCaptions();},250);
  attach();
})();
