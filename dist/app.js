'use strict';
const $ = (id) => document.getElementById(id);
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const memory = { get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } } };
let favorites = memory.get('kuaiting.favorites', []);
if (!Array.isArray(favorites)) favorites = [];
favorites = favorites.filter(f => f && typeof f.name === 'string' && typeof f.url === 'string').slice(0,100);
const preferences = memory.get('kuaiting.preferences', {});
let speed = [1,1.1,1.2,1.5].includes(preferences?.speed) ? preferences.speed : 1;
let volume = Number.isFinite(preferences?.volume) ? Math.max(0, Math.min(100, preferences.volume)) : 75;
let playing = false, started = false, elapsed = 0, lastTick = 0, audioContext, gainNode, audioBuffer, source, toastTimer, savedUrl, previousVolume = volume || 75;
let liveMode = false, liveStatus = 'idle', liveRoom = null, liveError = '', liveInputURL = '';
const livePlayer = new KuaitingLivePlayer((state, details) => {
  liveMode = true; liveStatus = state; liveRoom = details.room || liveRoom;
  liveError = details.message || ''; playing = state === 'playing'; started = true;
  lastTick = performance.now();
  if (state === 'error') { setError(liveError, false); toast(liveError); }
  updatePlayer();
});
const reduced = Boolean(preferences?.reduced);
$('reduce-motion').checked = reduced;
document.body.classList.toggle('reduced-motion', reduced);
for (let i = 0; i < 109; i++) { const bar = document.createElement('span'); bar.style.height = `${5 + (Math.sin(i * 1.8) + 1) * 10 + (Math.sin(i * .63) + 1) * 5}px`; bar.style.setProperty('--delay', `${-i * .071}s`); $('waveform').append(bar); }
document.querySelectorAll('.disc-inner span').forEach((bar,i) => bar.style.setProperty('--delay', `${-i * .17}s`));
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 3600); }
function setError(message, invalid = true) { $('url-error').textContent = message; $('url-error').hidden = !message; $('room-url').setAttribute('aria-invalid', String(!!message && invalid)); }
function parseRoom(value) { return KuaitingRoomLink.parse(value).url; }
function validatedRoom() { try { const url = parseRoom($('room-url').value); setError(''); return url; } catch (e) { setError(e.message); toast(e.message); $('room-url').focus(); return null; } }
function savePreferences() { if ($('remember-settings').checked) memory.set('kuaiting.preferences', {speed, volume, reduced: $('reduce-motion').checked}); }
function setVolume(value) { volume = value; $('volume').value = value; $('volume-value').textContent = `${value}%`; $('mute-button').setAttribute('aria-label', value === 0 ? '取消静音' : '静音'); $('mute-button').style.opacity = value === 0 ? '.4' : '1'; if (gainNode) gainNode.gain.value = volume / 100 * .3; livePlayer.setVolume(volume / 100); savePreferences(); }
function setSpeed(value) { speed = value; document.querySelectorAll('[data-speed]').forEach(b => { const active = Number(b.dataset.speed) === speed; b.classList.toggle('selected', active); b.setAttribute('aria-pressed', String(active)); }); if (source) source.playbackRate.value = speed; livePlayer.setSpeed(speed); savePreferences(); }
function updateTime() { const seconds = Math.floor(elapsed); $('elapsed').textContent = `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`; }
function updatePlayer() {
  const busy = liveMode && ['connecting', 'buffering', 'reconnecting'].includes(liveStatus);
  $('quick-play').disabled = busy;
  $('quick-play').innerHTML = icon('play') + (busy ? '正在连接…' : '快速播放');
  $('toggle-play').disabled = liveMode && liveStatus === 'connecting';
  $('stage').classList.toggle('is-playing', playing);
  $('toggle-play').innerHTML = icon(playing ? 'pause' : 'play');
  $('toggle-play').setAttribute('aria-label', playing ? '暂停试听' : started ? '继续试听' : '播放试听提示音');
  $('stop-button').disabled = !started;
  $('status').classList.toggle('playing', playing);
  if (liveMode) {
    const label = { connecting: '正在解析', buffering: '正在缓冲', reconnecting: '自动重连中', playing: '正在收听', paused: '已暂停', error: '连接失败' }[liveStatus];
    $('status').innerHTML = '<i></i><span></span>';
    $('status').lastElementChild.textContent = label;
    $('room-title').textContent = liveRoom?.title || '淘宝直播间';
    $('room-subtitle').textContent = liveRoom ? `直播间 ${liveRoom.liveId} · ${livePlayer.isRTC ? 'RTC 超低延时' : 'FLV 纯音频'}` : '正在获取直播音频来源';
    $('stage-title').textContent = { connecting: '正在连接你的直播间', buffering: '声音马上就来', reconnecting: '正在自动恢复声音', playing: '只听声音，专注这一刻', paused: '收听已暂停', error: '这次没能连上直播' }[liveStatus];
    $('stage-description').textContent = liveError || (liveStatus === 'paused' ? '继续收听将重新连接到当前直播进度' : '本地音频播放 · 不解码画面 · 提前量需与手机实测');
    $('transport-label').textContent = label;
    $('footer-status').textContent = liveStatus === 'playing' ? (livePlayer.isRTC ? 'RTC 低延时音频已连接' : 'FLV 音频已连接') : label;
    $('buffer-status').textContent = liveStatus === 'playing' ? (livePlayer.isRTC ? 'RTC 实时收听 · 无缓冲积压' : `本地缓冲 ${livePlayer.bufferSeconds.toFixed(1)} 秒 · 非直播总延迟`) : '等待音频播放';
    $('demo-button').innerHTML = icon(playing ? 'pause' : 'play') + (playing ? '暂停收听' : liveStatus === 'paused' ? '继续收听' : liveStatus === 'error' ? '重新连接' : '正在连接…');
    $('demo-button').disabled = busy;
    $('toggle-play').setAttribute('aria-label', playing ? '暂停直播' : '继续收听直播');
    return;
  }
  $('demo-button').disabled = false;
  $('buffer-status').textContent = '音频连接后显示本地缓冲';
  if (started) {
    $('status').innerHTML = `<i></i><span>${playing ? '正在试听' : '已暂停'}</span>`;
    $('room-title').textContent = '快听 · 声音体验';
    $('room-subtitle').textContent = '提示音试听 · 非真实直播';
    $('stage-title').textContent = playing ? '听见声音，找到节奏' : '暂停片刻，随时继续';
    $('stage-description').textContent = '这是本地提示音，用来体验音量、倍速和播放控制';
    $('demo-button').innerHTML = icon(playing ? 'pause' : 'play') + (playing ? '暂停试听' : '继续试听');
    $('transport-label').textContent = playing ? '提示音试听' : '试听已暂停';
    $('footer-status').textContent = '本地提示音 · 非直播音频';
  } else {
    $('status').innerHTML = '<i></i><span>等待连接</span>';
    $('room-title').textContent = '准备好，听见心动';
    $('room-subtitle').textContent = '添加一个直播间，开启你的收听时刻';
    $('stage-title').textContent = '把注意力，留给声音';
    $('stage-description').textContent = '粘贴直播间链接，声音即刻有了专属位置';
    $('demo-button').innerHTML = icon('play') + '试听一下<span>体验提示音</span>';
    $('transport-label').textContent = '尚未播放';
    $('footer-status').textContent = '等待添加直播间';
  }
}
async function setupAudio() {
  if (!audioContext) {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('当前浏览器不支持提示音试听，请使用新版浏览器。');
    audioContext = new Audio(); gainNode = audioContext.createGain(); gainNode.gain.value = volume / 100 * .3; gainNode.connect(audioContext.destination);
    audioBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 4, audioContext.sampleRate);
    const data = audioBuffer.getChannelData(0), notes = [523.25,659.25,783.99,659.25];
    for (let i=0;i<data.length;i++) { const time = i/audioContext.sampleRate, local = time % 1; const envelope = Math.min(local/.02,1)*Math.exp(-local*6); data[i] = Math.sin(2*Math.PI*notes[Math.floor(time)%4]*local)*envelope*.4; }
  }
  await audioContext.resume();
}
async function togglePlayback() {
  if (liveMode) {
    if (['playing', 'buffering'].includes(liveStatus)) livePlayer.pause();
    else if (liveStatus !== 'connecting') startLive(liveInputURL);
    return;
  }
  if (!started && $('room-url').value.trim()) { const url = validatedRoom(); if (url) startLive(url); return; }
  return toggleDemo();
}
async function toggleDemo() {
  if (playing) { if(source){source.stop();source=null;} playing=false; updatePlayer(); return; }
  try { await setupAudio(); source = audioContext.createBufferSource(); source.buffer = audioBuffer; source.loop = true; source.playbackRate.value = speed; source.connect(gainNode); source.start(0,elapsed%4); started=true;playing=true;lastTick=performance.now();updatePlayer(); }
  catch(e){toast(e.message || '声音未能播放，请重试。');}
}
function stopPlayback() { livePlayer.stop(); liveMode=false; liveStatus='idle'; liveRoom=null; liveError=''; if(source){source.stop();source=null;}playing=false;started=false;elapsed=0;updateTime();updatePlayer(); }
function startLive(url) { stopPlayback(); setError(''); setTab('player'); liveInputURL=url; livePlayer.connect(url); }
setInterval(()=>{const now=performance.now();if(playing){elapsed+=(now-lastTick)/1000;updateTime();if(liveMode&&!livePlayer.isRTC)$('buffer-status').textContent=`本地缓冲 ${livePlayer.bufferSeconds.toFixed(1)} 秒 · 非直播总延迟`;}lastTick=now;},250);
function loadRoom(url) { $('room-url').value=url;$('clear-url').hidden=false;setError('');setTab('player');$('room-url').focus();toast('链接已填入，可点击快速播放。'); }
function setTab(tab) { const selected = tab === 'favorites' ? 'favorites' : 'player'; $('player-view').hidden=selected!=='player';$('favorites-view').hidden=selected!=='favorites';document.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===selected);b.setAttribute('aria-current',b.dataset.tab===selected?'page':'false');}); }
function makeFavorite(item,compact=false) { const row=document.createElement('div');row.className='favorite-item';const badge=document.createElement('span');badge.className='mini-mark';badge.innerHTML=icon('headphones');const info=document.createElement('div');info.className='favorite-info';const name=document.createElement('strong');name.textContent=item.name;const url=document.createElement('p');url.textContent=compact?'淘宝直播间':item.url;info.append(name,url);const play=document.createElement('button');play.className='load-favorite';play.innerHTML=compact?icon('arrow'):'打开';play.setAttribute('aria-label',`打开 ${item.name}`);play.onclick=()=>loadRoom(item.url);row.append(badge,info,play);if(!compact){const remove=document.createElement('button');remove.className='icon-button';remove.innerHTML=icon('close');remove.setAttribute('aria-label',`删除收藏 ${item.name}`);remove.onclick=()=>{favorites=favorites.filter(f=>f.url!==item.url);if(!memory.set('kuaiting.favorites',favorites))toast('浏览器无法保存更改，刷新后可能恢复。');renderFavorites();};row.append(remove);}return row; }
function renderFavorites() { $('favorite-count').textContent=favorites.length;$('favorites-list').replaceChildren();$('favorite-preview-content').replaceChildren();$('favorite-preview-content').className=favorites.length?'':'favorite-empty';if(!favorites.length){$('favorites-list').innerHTML=`<div class="empty-collection">${icon('star')}<h3>把喜欢的直播间收藏起来</h3><p>粘贴直播间链接后，点击「收藏」，下次无需重新寻找。</p></div>`;$('favorite-preview-content').innerHTML=`<span class="empty-star">${icon('star')}</span><p>喜欢的直播间，留在这里</p><span>点击链接旁的「收藏」，下次更快找到</span>`;}else{favorites.forEach(f=>$('favorites-list').append(makeFavorite(f)));favorites.slice(0,2).forEach(f=>$('favorite-preview-content').append(makeFavorite(f,true)));} }
$('room-form').addEventListener('submit',e=>{e.preventDefault();const url=validatedRoom();if(url)startLive(url);});
$('room-url').addEventListener('input',()=>{setError('');$('clear-url').hidden=!$('room-url').value;});
$('clear-url').onclick=()=>{$('room-url').value='';$('clear-url').hidden=true;setError('');$('room-url').focus();};
$('paste-button').onclick=async()=>{try{$('room-url').value=await (window.kuaitingDesktop ? window.kuaitingDesktop.readClipboard() : navigator.clipboard.readText());$('clear-url').hidden=!$('room-url').value;setError('');$('room-url').focus();}catch{toast('请点击输入框，使用 ⌘V 或 Ctrl+V 粘贴。');$('room-url').focus();}};
$('save-button').onclick=()=>{const url=validatedRoom();if(!url)return;if(favorites.some(f=>f.url===url)){toast('这个直播间已经在收藏里了。');return;}savedUrl=url;$('favorite-name').value='';$('save-dialog').showModal();$('favorite-name').focus();};
$('save-form').onsubmit=e=>{e.preventDefault();const name=$('favorite-name').value.trim();if(!name){$('favorite-name').setCustomValidity('请填写直播间名称。');$('favorite-name').reportValidity();return;}favorites.unshift({name,url:savedUrl});favorites=favorites.slice(0,100);const persisted=memory.set('kuaiting.favorites',favorites);renderFavorites();$('save-dialog').close();toast(persisted?'已收藏，下次更快找到。':'已临时收藏；浏览器存储不可用，关闭页面后将丢失。');};
$('favorite-name').oninput=()=>$('favorite-name').setCustomValidity('');
$('demo-button').onclick=()=>liveMode?togglePlayback():toggleDemo();$('toggle-play').onclick=togglePlayback;$('stop-button').onclick=stopPlayback;
$('volume').oninput=e=>setVolume(Number(e.target.value));$('mute-button').onclick=()=>{if(volume>0){previousVolume=volume;setVolume(0);}else setVolume(previousVolume);};
document.querySelectorAll('[data-speed]').forEach(b=>b.onclick=()=>setSpeed(Number(b.dataset.speed)));
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));$('all-favorites').onclick=()=>setTab('favorites');
$('help-button').onclick=$('how-link').onclick=()=>$('help-dialog').showModal();$('settings-button').onclick=()=>$('settings-dialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('reduce-motion').onchange=()=>{document.body.classList.toggle('reduced-motion',$('reduce-motion').checked);savePreferences();};$('remember-settings').onchange=()=>{if($('remember-settings').checked)savePreferences();else{try{localStorage.removeItem('kuaiting.preferences');}catch{}}};
setVolume(volume);setSpeed(speed);renderFavorites();
if (window.kuaitingDesktop) {
  document.documentElement.dataset.desktop = window.kuaitingDesktop.platform;
  const previewLabel = document.querySelector('.version');
  if (previewLabel) previewLabel.textContent = 'Mac 测试版 0.2';
  window.kuaitingDesktop.ready();
}
const modelContext=document.modelContext;
if(modelContext?.registerTool){const lifecycle=new AbortController();const tool={name:'stage_taobao_live_link',title:'填入淘宝直播间链接',description:'校验并将淘宝直播间链接填入快听，不开始播放。',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute(input){if(!input||typeof input.url!=='string')throw new Error('url 必须是字符串');const url=parseRoom(input.url);loadRoom(url);return{url,status:'staged',livePlaybackAvailable:!!window.kuaitingDesktop?.resolveLive};}};try{Promise.resolve(modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});}
