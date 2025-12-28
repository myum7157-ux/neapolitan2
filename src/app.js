// Napolitan Relay Starter — v11 (no KV/DO yet; auth is Worker/Pages Functions only)
const $ = (id) => document.getElementById(id);

const state = {
  images: null,
  audio: null,
  config: null,
  cases: null,
  // local-only feeds
  wills: [],
  deaths: [],
  rank: [],
};

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

async function fetchJSON(path){
  const r = await fetch(path, { cache:'no-store' });
  if(!r.ok) throw new Error('fetch failed: '+path);
  return await r.json();
}

function img(section, key){
  const I = state.images;
  if(!I) return null;
  if(section==='bg') return I.room1?.bg?.[key] ?? I._placeholder;
  if(section==='overlay') return I.global_overlays?.[key] ?? null;
  if(section==='death') return I.cards?.death_reports?.[key] ?? I._placeholder;
  if(section==='will') return I.cards?.will_cards?.[key] ?? I._placeholder;
  if(section==='rank') return I.cards?.rank_cards?.[key] ?? I._placeholder;
  if(section==='board') return I.boards?.[key] ?? I._placeholder;
  if(section==='feed') return I.feeds?.[key] ?? I._placeholder;
  if(section==='panel') return I.panels?.[key] ?? I._placeholder;
  if(section==='gate') return I.gate?.[key] ?? I._placeholder;
  if(section==='lobby') return I.lobby?.[key] ?? I._placeholder;
  if(section==='miniPerson') return I.minigame?.people?.[key] ?? I._placeholder;
  if(section==='miniUI') return I.minigame?.ui?.[key] ?? I._placeholder;
  if(section==='miniRule') return I.minigame?.torn_rules_01 ?? I._placeholder;
  if(section==='ending') return I.ending?.[key] ?? I._placeholder;
  return I._placeholder;
}

// -------- Gate (index.html) --------
function isGatePage(){ return document.body.classList.contains('gate'); }
function isPlayPage(){ return document.body.classList.contains('play'); }

async function gateLogin(password){
  const r = await fetch('/api/auth/login', {
    method:'POST',
    headers:{ 'content-type':'application/json' },
    body: JSON.stringify({ password })
  });
  if(!r.ok){
    const t = await r.text().catch(()=> '');
    throw new Error(t || 'DENIED');
  }
  return await r.json();
}

function bindGate(){
  const gateBg = $('gateBg');
  const gatePanel = $('gatePanel');
  const keypad = $('keypad');
  const pw = $('pw');
  const msg = $('gateMsg');
  const btnLogin = $('btnLogin');
  const btnToMini = $('btnToMini');

  const stampGranted = $('gateStampGranted');
  const stampDenied = $('gateStampDenied');
  const flash = $('gateFlash');

  // visuals
  gateBg.style.backgroundImage = `url('${img('gate', state.config.ui.gate.background)}')`;
  gatePanel.style.backgroundImage = `url('${img('gate', state.config.ui.gate.panel)}')`;
  keypad.style.backgroundImage = `url('${img('gate', state.config.ui.gate.keypad)}')`;
  stampGranted.style.backgroundImage = `url('${img('gate', state.config.ui.gate.stampGranted)}')`;
  stampDenied.style.backgroundImage = `url('${img('gate', state.config.ui.gate.stampDenied)}')`;

  const showStamp = (el) => {
    el.style.opacity = '1';
    el.style.transform = 'rotate(-12deg) scale(1)';
    setTimeout(()=>{ el.style.opacity='0'; el.style.transform='rotate(-12deg) scale(.95)'; }, 900);
  };
  const flashOnce = () => {
    flash.style.opacity = '1';
    setTimeout(()=> flash.style.opacity='0', 120);
  };

  keypad.addEventListener('click', (e)=>{
    const b = e.target.closest('button');
    if(!b) return;
    const k = b.dataset.k;
    if(k==='clr') pw.value='';
    else if(k==='del') pw.value = pw.value.slice(0,-1);
    else pw.value += k;
  });

  async function doLogin(){
    msg.textContent='';
    try{
      btnLogin.disabled = true;
      const res = await gateLogin(pw.value.trim());
      showStamp(stampGranted);
      msg.textContent = 'ACCESS GRANTED';
      setTimeout(()=> location.href='/play.html', 450);
      return res;
    }catch(err){
      flashOnce();
      showStamp(stampDenied);
      msg.textContent = 'ACCESS DENIED';
      pw.value='';
    }finally{
      btnLogin.disabled = false;
    }
  }

  btnLogin.addEventListener('click', doLogin);
  pw.addEventListener('keydown', (e)=>{ if(e.key==='Enter') doLogin(); });

  // mini panel
  const miniPanel = $('miniPanel');
  const btnBack = $('btnBackGate');
  btnToMini.addEventListener('click', ()=>{
    $('gatePanel').classList.add('hidden');
    miniPanel.classList.remove('hidden');
    startMini();
  });
  btnBack.addEventListener('click', ()=>{
    miniPanel.classList.add('hidden');
    $('gatePanel').classList.remove('hidden');
    msg.textContent='';
  });
}

// -------- MiniGame (gate) --------
const mini = {
  case: null,
  lives: 3,
  usedHint: false,
  accused: null,
  saidIndex: { A:0, B:0, C:0, D:0, E:0 },
  finished: false,
};

function renderMini(){
  $('miniLives').textContent = '♥'.repeat(mini.lives) + '♡'.repeat(3-mini.lives);
  $('miniHintBadge').classList.toggle('hidden', !mini.usedHint);

  const peopleWrap = $('miniPeople');
  peopleWrap.innerHTML = '';
  ['A','B','C','D','E'].forEach((k)=>{
    const div = document.createElement('div');
    div.className = 'personCard';
    div.dataset.person = k;
    div.innerHTML = `
      <img alt="person ${k}" src="${img('miniPerson','person_'+k)}" />
      <div class="tag chip">${k}</div>
    `;
    peopleWrap.appendChild(div);
  });

  $('miniCaseTitle').textContent = mini.case?.title ?? '—';
  $('miniPrompt').textContent = mini.case?.prompt ?? '';
  $('miniRule').textContent = mini.case?.baseRule ?? '';
  $('miniSpeech').textContent = '카드를 눌러 발언을 확인해.';
  $('miniMsg').textContent = '';

  $('btnMiniHint').disabled = true;
  $('btnMiniAccuse').disabled = false;

  // rule reveal hidden initially
  $('miniRuleBox').classList.add('hidden');
  $('miniRuleImg').src = img('miniRule','torn_rules_01');
  $('miniRuleText').textContent = '';
}

function startMini(){
  mini.case = (state.cases && state.cases.length) ? state.cases[Math.floor(Math.random()*state.cases.length)] : null;
  mini.lives = 3;
  mini.usedHint = false;
  mini.accused = null;
  mini.saidIndex = { A:0, B:0, C:0, D:0, E:0 };
  mini.finished = false;
  renderMini();
}

function bindMini(){
  $('miniPeople').addEventListener('click', (e)=>{
    if(mini.finished) return;
    const card = e.target.closest('.personCard');
    if(!card) return;
    const who = card.dataset.person;
    mini.accused = who;

    const lines = mini.case?.statements?.[who] ?? [];
    const idx = mini.saidIndex[who] ?? 0;
    const line = lines[idx] ?? lines[lines.length-1] ?? '(...)';
    mini.saidIndex[who] = Math.min(idx+1, Math.max(0, lines.length-1));

    $('miniSpeech').textContent = `[${who}] ${line}`;
    $('miniMsg').textContent = `현재 선택: ${who}`;
  });

  $('btnMiniAccuse').addEventListener('click', ()=>{
    if(mini.finished || !mini.case) return;
    if(!mini.accused){
      $('miniMsg').textContent = '누군가를 먼저 선택해.';
      return;
    }
    const liar = mini.case.liar;
    if(mini.accused === liar){
      mini.finished = true;
      $('miniMsg').textContent = mini.usedHint ? '성공(힌트 사용: 랭킹 미등재)' : '성공';
      $('btnMiniHint').disabled = true;
      return;
    }

    // wrong
    mini.lives -= 1;
    $('miniMsg').textContent = `오답. 남은 목숨 ${mini.lives}/3`;
    if(mini.lives <= 0){
      mini.finished = true;
      $('miniMsg').textContent = '게임 오버';
      $('btnMiniHint').disabled = true;
      renderMini(); // reset visuals
      $('miniMsg').textContent = '게임 오버. RESTART';
      return;
    }

    // First fail -> reveal torn rules condition
    if(mini.lives === 2){
      $('miniRuleBox').classList.remove('hidden');
      $('miniRuleText').textContent = mini.case.ruleReveal ?? '';
    }

    // Second fail -> last chance, hint enabled
    if(mini.lives === 1){
      $('btnMiniHint').disabled = false;
      $('miniMsg').textContent += ' · 마지막 기회';
    }

    renderMini();
    $('miniMsg').textContent = `오답. 남은 목숨 ${mini.lives}/3` + (mini.lives===1?' · 마지막 기회':'');
    if(mini.lives===2){
      $('miniRuleBox').classList.remove('hidden');
      $('miniRuleText').textContent = mini.case.ruleReveal ?? '';
    }
  });

  $('btnMiniHint').addEventListener('click', ()=>{
    if(mini.finished || mini.usedHint) return;
    mini.usedHint = true;
    $('miniHintBadge').classList.remove('hidden');
    $('btnMiniHint').disabled = true;
    $('miniMsg').textContent = (mini.case?.hint ?? '힌트 없음') + ' (힌트 사용: 랭킹 미등재)';
  });

  $('btnMiniRestart').addEventListener('click', startMini);
}

// -------- Play (play.html) --------
function bindTabs(){
  document.querySelectorAll('.tab').forEach((b)=>{
    b.addEventListener('click', ()=>{
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.tabPane').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      const t = b.dataset.tab;
      $( 'tab-'+t ).classList.add('active');
    });
  });
}

function setBG(key){
  const el = $('bg');
  el.style.backgroundImage = `url('${img('bg', key)}')`;
}
function setOverlays(keys){
  const [a,b,c] = keys;
  $('ov1').style.backgroundImage = a?`url('${img('overlay',a)}')`:'';
  $('ov2').style.backgroundImage = b?`url('${img('overlay',b)}')`:'';
  $('ov3').style.backgroundImage = c?`url('${img('overlay',c)}')`:'';
}

function renderLobby(){
  $('lobbyStatusImg').src = img('lobby', state.config.ui.lobby.statusBoard);
  $('willBoardImg').src = img('board','will_board_01_stack');
  $('deathFeedImg').src = img('feed','death_feed_01_pile');
  $('rankPanelImg').src = img('lobby', state.config.ui.lobby.rankPanel);

  $('willList').innerHTML = state.wills.map(w=>`<div class="feedItem">${esc(w)}</div>`).join('') || '<div class="feedItem muted">비어있음</div>';
  $('deathList').innerHTML = state.deaths.map(d=>`<div class="feedItem">${esc(d)}</div>`).join('') || '<div class="feedItem muted">비어있음</div>';
  $('rankList').innerHTML = state.rank.map(r=>`<div class="feedItem">${esc(r)}</div>`).join('') || '<div class="feedItem muted">비어있음</div>';
}

const room1Story = {
  cur: null,
  data: null,
};
function nodeById(id){ return room1Story.data?.nodes?.find(n=>n.id===id) ?? null; }
function goNode(id){
  room1Story.cur = nodeById(id);
  if(!room1Story.cur) return;
  $('phaseChip').textContent = 'ROOM 1';
  setBG(room1Story.cur.bg || state.config.ui.room1.defaultBg);
  setOverlays(room1Story.cur.overlays || state.config.ui.room1.defaultOverlays);

  $('storyPanel').innerHTML = `<div>${esc(room1Story.cur.text)}</div>`;
  const choices = $('choices');
  choices.innerHTML='';
  (room1Story.cur.choices||[]).forEach(ch=>{
    const btn=document.createElement('button');
    btn.className='btn choiceBtn';
    btn.textContent = ch.label;
    btn.addEventListener('click', ()=>{
      if(ch.type==='death'){
        openDeath(ch.deathType || 'death_report_01_rulebreak', ch.will || '');
      }else{
        goNode(ch.next);
      }
    });
    choices.appendChild(btn);
  });
}

function openDeath(cardKey, willText){
  const modal=$('deathModal');
  $('deathCardImg').src = img('death', cardKey);
  modal.classList.remove('hidden');
  // store
  if(willText){
    state.wills.unshift(willText);
  }
  state.deaths.unshift(`사망: ${cardKey} · ${new Date().toLocaleString()}`);
  renderLobby();
}

function bindPlay(){
  bindTabs();
  $('btnCloseDeath').addEventListener('click', ()=> $('deathModal').classList.add('hidden'));
  $('btnStartRun').addEventListener('click', ()=> goNode('n1'));
  $('btnMiniFromLobby').addEventListener('click', ()=> location.href='/?mini=1');

  $('btnLogout').addEventListener('click', async ()=>{
    await fetch('/api/auth/logout', {method:'POST'}).catch(()=>{});
    location.href='/';
  });
}

async function init(){
  state.images = await fetchJSON('/data/manifests/images.json');
  state.audio = await fetchJSON('/data/manifests/audio.json');
  state.config = await fetchJSON('/data/config.json');
  state.cases = await fetchJSON('/data/minigame_cases.json');

  // simple room1 story
  room1Story.data = await fetchJSON('/data/room1_story.json');

  if(isGatePage()){
    // gate background fallback if missing
    bindGate();
    bindMini();
    const url = new URL(location.href);
    if(url.searchParams.get('mini')==='1'){
      $('gatePanel').classList.add('hidden');
      $('miniPanel').classList.remove('hidden');
      startMini();
    }else{
      // preload mini case
      startMini();
    }
  }

  if(isPlayPage()){
    // default visuals
    setBG(state.config.ui.room1.defaultBg);
    setOverlays(state.config.ui.room1.defaultOverlays);
    $('phaseChip').textContent='LOBBY';
    bindPlay();
    renderLobby();
  }
}
init().catch((e)=>{
  console.error(e);
  document.body.innerHTML = `<pre style="white-space:pre-wrap;color:#ddd;padding:18px">${esc(e.stack||e.message||String(e))}</pre>`;
});
