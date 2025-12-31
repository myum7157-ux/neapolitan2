// 나폴리탄 릴레이 — v17
const $ = (id) => document.getElementById(id);

// ========================================
// 상태 관리
// ========================================
const state = {
  images: null,
  audio: null,
  config: null,
  cases: null,
  storyData: null,
  
  wills: [],
  deaths: [],
  rank: [],
  
  currentRoom: 1,
  currentStep: 0,
  gameStartTime: null,
  timerInterval: null,
  currentNode: null,
  
  // 🆕 상태 기반 시스템
  flags: {},        // { knows_exit_route: true, cctv_off: true, ... }
  inventory: [],    // ['map_17', 'keycard_a', ...]
  threat: 0,        // 위협 수치 (높을수록 위험)
  
  // 대기열 (서버 동기화)
  queue: {
    total: 0,
    position: 0,
    playing: 0,
    isMyTurn: false,
    isPlaying: false
  },
  queuePolling: null,
  
  isBanned: false,
  
  // 오디오
  audioInitialized: false,
  bgmPlayer: null,
  currentBgm: null,
  ambientPlayer: null,
  
  lastDeath: null
};

// ========================================
// 저장소 키
// ========================================
const STORAGE = {
  BAN_EXPIRY: 'nr_ban_expiry',
  WILLS: 'nr_wills',
  DEATHS: 'nr_deaths',
  RANK: 'nr_rank'
};

const BAN_DURATION = 24 * 60 * 60 * 1000;

// ========================================
// 유틸리티
// ========================================
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => 
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

async function fetchJSON(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error('fetch failed: ' + path);
  return r.json();
}

function img(section, key) {
  const I = state.images;
  if (!I) return '';
  if (section === 'bg') return I.room1?.bg?.[key] ?? I._placeholder;
  if (section === 'death') return I.cards?.death_reports?.[key] ?? I._placeholder;
  if (section === 'will') return I.cards?.will_cards?.[key] ?? I._placeholder;
  if (section === 'rank') return I.cards?.rank_cards?.[key] ?? I._placeholder;
  if (section === 'miniPerson') return I.minigame?.people?.[key] ?? I._placeholder;
  if (section === 'miniRule') return I.minigame?.torn_rules_01 ?? I._placeholder;
  return I._placeholder;
}

function isGatePage() { return document.body.classList.contains('gate'); }
function isPlayPage() { return document.body.classList.contains('play'); }

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ========================================
// 오디오 시스템
// ========================================
function initAudio() {
  if (state.audioInitialized) return;
  
  state.bgmPlayer = new Audio();
  state.bgmPlayer.loop = true;
  state.bgmPlayer.volume = 0.25;
  
  state.ambientPlayer = new Audio();
  state.ambientPlayer.loop = true;
  state.ambientPlayer.volume = 0.15;
  
  state.audioInitialized = true;
}

function playBGM(key) {
  if (!state.audio?.bgm?.[key]) {
    console.log('BGM not found:', key, 'available:', Object.keys(state.audio?.bgm || {}));
    return;
  }
  if (!state.bgmPlayer) initAudio();
  
  // 파일명에 특수문자(괄호, 공백, 퍼센트 등)가 있으면 인코딩 필요
  const src = encodeURI(state.audio.bgm[key]);
  if (state.currentBgm === key && !state.bgmPlayer.paused) return;
  
  console.log('Playing BGM:', key, src);
  state.currentBgm = key;
  state.bgmPlayer.src = src;
  state.bgmPlayer.play().catch(e => {
    console.log('BGM autoplay blocked, will retry on click:', e.message);
  });
}

function stopBGM() {
  if (state.bgmPlayer) {
    state.bgmPlayer.pause();
    state.bgmPlayer.currentTime = 0;
    state.currentBgm = null;
  }
}

function playAmbient(key) {
  if (!state.audio?.loops?.[key]) return;
  if (!state.ambientPlayer) initAudio();
  
  state.ambientPlayer.src = encodeURI(state.audio.loops[key]);
  state.ambientPlayer.play().catch(() => {});
}

function stopAmbient() {
  if (state.ambientPlayer) {
    state.ambientPlayer.pause();
    state.ambientPlayer.currentTime = 0;
  }
}

function playSFX(key) {
  if (!state.audio?.sfx?.[key]) return;
  
  const audio = new Audio(encodeURI(state.audio.sfx[key]));
  audio.volume = 0.4;
  audio.play().catch(() => {});
}

function playClick() {
  playSFX('ui_click');
  
  // BGM 자동재생 재시도
  if (state.bgmPlayer && state.currentBgm && state.bgmPlayer.paused) {
    state.bgmPlayer.play().catch(() => {});
  }
}

function playDeathSound() {
  playSFX('death_hit');
  setTimeout(() => playSFX('death_impact'), 200);
}

// ========================================
// 밴 시스템
// ========================================
function checkBan() {
  const expiry = localStorage.getItem(STORAGE.BAN_EXPIRY);
  if (!expiry) return false;
  
  if (Date.now() >= parseInt(expiry, 10)) {
    localStorage.removeItem(STORAGE.BAN_EXPIRY);
    return false;
  }
  return true;
}

function setBan() {
  const expiry = Date.now() + BAN_DURATION;
  localStorage.setItem(STORAGE.BAN_EXPIRY, expiry.toString());
  state.isBanned = true;
}

function getBanRemaining() {
  const expiry = localStorage.getItem(STORAGE.BAN_EXPIRY);
  if (!expiry) return 0;
  return Math.max(0, parseInt(expiry, 10) - Date.now());
}

function formatBanTime(ms) {
  const h = Math.floor(ms / (1000 * 60 * 60));
  const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const s = Math.floor((ms % (1000 * 60)) / 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function showBanNotice() {
  const notice = $('banNotice');
  if (!notice) return;
  
  notice.classList.remove('hidden');
  
  function tick() {
    const remaining = getBanRemaining();
    if (remaining <= 0) {
      notice.classList.add('hidden');
      state.isBanned = false;
      updateQueueDisplay();
      return;
    }
    $('banCountdown').textContent = formatBanTime(remaining);
    setTimeout(tick, 1000);
  }
  tick();
}

// ========================================
// 대기열 시스템 (서버 연동 - KV 필수)
// ========================================
async function fetchQueueStatus() {
  try {
    const res = await fetch('/api/queue/status', { credentials: 'same-origin' });
    if (!res.ok) {
      console.error('Queue API error:', res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('Queue status fetch failed:', e);
    return null;
  }
}

async function joinQueue() {
  try {
    const res = await fetch('/api/queue/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ action: 'join' })
    });
    if (!res.ok) {
      console.error('Queue join error:', res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('Queue join failed:', e);
    return null;
  }
}

async function startGame() {
  try {
    const res = await fetch('/api/queue/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ action: 'start' })
    });
    if (!res.ok) {
      console.error('Game start error:', res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('Game start failed:', e);
    return null;
  }
}

async function endGame() {
  try {
    const res = await fetch('/api/queue/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ action: 'end' })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error('Game end failed:', e);
    return null;
  }
}

function startQueuePolling() {
  if (state.queuePolling) return;
  
  async function poll() {
    const data = await fetchQueueStatus();
    if (data && !data.error) {
      state.queue.total = data.total || 0;
      state.queue.position = data.position || 0;
      state.queue.playing = data.playing || 0;
      state.queue.isMyTurn = data.isMyTurn || false;
      state.queue.isPlaying = data.isPlaying || false;
      updateQueueDisplay();
      
      // 내 차례가 되면 알림
      if (data.isMyTurn && !state.queue.isPlaying && !state.isBanned) {
        playSFX('queue_call');
      }
    }
  }
  
  poll();
  state.queuePolling = setInterval(poll, 2000); // 2초마다 폴링
}

function stopQueuePolling() {
  if (state.queuePolling) {
    clearInterval(state.queuePolling);
    state.queuePolling = null;
  }
}

function updateQueueDisplay() {
  if ($('queueTotal')) $('queueTotal').textContent = state.queue.total;
  if ($('queuePosition')) $('queuePosition').textContent = state.queue.position || '-';
  if ($('queuePlaying')) $('queuePlaying').textContent = state.queue.playing;
  
  const startBtn = $('btnStartRun');
  if (startBtn) {
    if (state.isBanned) {
      startBtn.disabled = true;
      startBtn.textContent = '참가 제한';
    } else if (state.queue.isPlaying) {
      startBtn.disabled = true;
      startBtn.textContent = '진행 중';
    } else if (state.queue.position > 0 && !state.queue.isMyTurn) {
      startBtn.disabled = true;
      startBtn.textContent = `대기 중 (${state.queue.position}번)`;
    } else if (state.queue.isMyTurn) {
      startBtn.disabled = false;
      startBtn.textContent = '시작하기';
    } else {
      startBtn.disabled = false;
      startBtn.textContent = '대기열 참가';
    }
  }
}

// ========================================
// 데이터 저장/로드
// ========================================
function loadData() {
  try {
    const w = localStorage.getItem(STORAGE.WILLS);
    const d = localStorage.getItem(STORAGE.DEATHS);
    const r = localStorage.getItem(STORAGE.RANK);
    if (w) state.wills = JSON.parse(w);
    if (d) state.deaths = JSON.parse(d);
    if (r) state.rank = JSON.parse(r);
  } catch (e) { console.error(e); }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE.WILLS, JSON.stringify(state.wills));
    localStorage.setItem(STORAGE.DEATHS, JSON.stringify(state.deaths));
    localStorage.setItem(STORAGE.RANK, JSON.stringify(state.rank));
  } catch (e) { console.error(e); }
}

function addWill(text, deathInfo) {
  if (!text?.trim()) return;
  
  state.wills.unshift({
    text: text.trim(),
    room: deathInfo.room,
    step: deathInfo.step,
    deathType: deathInfo.type,
    time: new Date().toLocaleString('ko-KR'),
    timestamp: Date.now()
  });
  
  if (state.wills.length > 100) state.wills.pop();
  saveData();
}

function addDeath(type, msg, room, step, survivalTime) {
  const record = {
    type,
    msg,
    room,
    step,
    survivalTime,
    time: new Date().toLocaleString('ko-KR'),
    timestamp: Date.now()
  };
  
  state.deaths.unshift(record);
  if (state.deaths.length > 100) state.deaths.pop();
  saveData();
  
  state.rank.push({
    step,
    room,
    survivalTime,
    time: new Date().toLocaleString('ko-KR')
  });
  state.rank.sort((a, b) => b.step - a.step);
  if (state.rank.length > 50) state.rank.pop();
  saveData();
  
  return record;
}

// ========================================
// 게이트 페이지
// ========================================
async function gateLogin(password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ password })
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error('비밀번호가 틀렸습니다');
    throw new Error('로그인 실패');
  }
  return res.json();
}

function bindGate() {
  const pw = $('pw');
  const msg = $('gateMsg');
  const btnLogin = $('btnLogin');
  const keypad = $('keypad');

  keypad?.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    playClick();
    const k = b.dataset.k;
    if (k === 'clr') pw.value = '';
    else if (k === 'del') pw.value = pw.value.slice(0, -1);
    else pw.value += k;
  });

  async function doLogin() {
    if (!pw.value.trim()) {
      msg.textContent = '비밀번호를 입력하세요';
      msg.style.color = '#ffa94d';
      return;
    }

    msg.textContent = '확인 중...';
    msg.style.color = '#6b8aff';
    btnLogin.disabled = true;

    try {
      await gateLogin(pw.value.trim());
      playSFX('access_granted');
      msg.textContent = '접근 허가';
      msg.style.color = '#4dff88';
      setTimeout(() => location.href = '/play.html', 600);
    } catch (err) {
      playSFX('access_denied');
      msg.textContent = err.message || '접근 거부';
      msg.style.color = '#ff4d4d';
      pw.value = '';
    } finally {
      setTimeout(() => btnLogin.disabled = false, 500);
    }
  }

  btnLogin?.addEventListener('click', () => { playClick(); doLogin(); });
  pw?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  $('btnToMini')?.addEventListener('click', () => {
    playClick();
    $('gatePanel')?.classList.add('hidden');
    $('miniPanel')?.classList.remove('hidden');
    startMini();
  });

  $('btnBackGate')?.addEventListener('click', () => {
    playClick();
    $('miniPanel')?.classList.add('hidden');
    $('gatePanel')?.classList.remove('hidden');
  });
}

// ========================================
// 미니게임
// ========================================
const mini = {
  case: null,
  lives: 3,
  usedHint: false,
  accused: null,
  saidIndex: { A:0, B:0, C:0, D:0, E:0 },
  finished: false
};

function renderMini() {
  $('miniLives').textContent = '♥'.repeat(mini.lives) + '♡'.repeat(3 - mini.lives);
  $('miniHintBadge')?.classList.toggle('hidden', !mini.usedHint);

  const peopleWrap = $('miniPeople');
  if (peopleWrap) {
    peopleWrap.innerHTML = '';
    ['A','B','C','D','E'].forEach(k => {
      const div = document.createElement('div');
      div.className = 'personCard';
      div.dataset.person = k;
      div.innerHTML = `
        <img alt="인물 ${k}" src="${img('miniPerson', 'person_' + k)}" />
        <div class="tag chip">${k}</div>
      `;
      peopleWrap.appendChild(div);
    });
  }

  if ($('miniCaseTitle')) $('miniCaseTitle').textContent = mini.case?.title ?? '—';
  if ($('miniPrompt')) $('miniPrompt').textContent = mini.case?.prompt ?? '';
  if ($('miniRule')) $('miniRule').textContent = mini.case?.baseRule ?? '';
  if ($('miniSpeech')) $('miniSpeech').textContent = '인물 카드를 눌러 발언을 확인하세요.';
  if ($('miniMsg')) {
    $('miniMsg').textContent = '';
    $('miniMsg').style.color = '';
  }

  if ($('btnMiniHint')) $('btnMiniHint').disabled = true;
  if ($('btnMiniAccuse')) $('btnMiniAccuse').disabled = false;
  $('miniRuleBox')?.classList.add('hidden');
  
  if ($('miniRuleImg')) $('miniRuleImg').src = img('miniRule', 'torn_rules_01');
  if ($('miniRuleText')) $('miniRuleText').textContent = '';
}

function startMini() {
  mini.case = state.cases?.length ? state.cases[Math.floor(Math.random() * state.cases.length)] : null;
  mini.lives = 3;
  mini.usedHint = false;
  mini.accused = null;
  mini.saidIndex = { A:0, B:0, C:0, D:0, E:0 };
  mini.finished = false;
  renderMini();
}

function bindMini() {
  $('miniPeople')?.addEventListener('click', e => {
    if (mini.finished) return;
    const card = e.target.closest('.personCard');
    if (!card) return;
    
    playClick();
    
    const who = card.dataset.person;
    mini.accused = who;

    document.querySelectorAll('.personCard').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');

    const lines = mini.case?.statements?.[who] ?? [];
    const idx = mini.saidIndex[who] ?? 0;
    const line = lines[idx] ?? lines[lines.length - 1] ?? '(...)';
    mini.saidIndex[who] = Math.min(idx + 1, Math.max(0, lines.length - 1));

    if ($('miniSpeech')) $('miniSpeech').textContent = `[${who}] "${line}"`;
    if ($('miniMsg')) {
      $('miniMsg').textContent = `선택: ${who}`;
      $('miniMsg').style.color = '#6b8aff';
    }
  });

  $('btnMiniAccuse')?.addEventListener('click', () => {
    if (mini.finished || !mini.case) return;
    if (!mini.accused) {
      if ($('miniMsg')) {
        $('miniMsg').textContent = '먼저 인물을 선택하세요';
        $('miniMsg').style.color = '#ffa94d';
      }
      return;
    }

    playClick();

    if (mini.accused === mini.case.liar) {
      mini.finished = true;
      playSFX('ui_confirm');
      if ($('miniMsg')) {
        $('miniMsg').textContent = mini.usedHint ? '✓ 정답! (힌트 사용)' : '✓ 정답!';
        $('miniMsg').style.color = '#4dff88';
      }
      if ($('btnMiniAccuse')) $('btnMiniAccuse').disabled = true;
      return;
    }

    playSFX('ui_wrong');
    mini.lives -= 1;
    
    if (mini.lives <= 0) {
      mini.finished = true;
      if ($('miniMsg')) {
        $('miniMsg').textContent = `✗ 실패. 정답: ${mini.case.liar}`;
        $('miniMsg').style.color = '#ff4d4d';
      }
      if ($('btnMiniAccuse')) $('btnMiniAccuse').disabled = true;
      $('miniLives').textContent = '♡♡♡';
      return;
    }

    if (mini.lives === 2) {
      $('miniRuleBox')?.classList.remove('hidden');
      if ($('miniRuleText')) $('miniRuleText').textContent = mini.case.ruleReveal ?? '';
    }

    if (mini.lives === 1) {
      if ($('btnMiniHint')) $('btnMiniHint').disabled = false;
    }

    $('miniLives').textContent = '♥'.repeat(mini.lives) + '♡'.repeat(3 - mini.lives);
    
    if ($('miniMsg')) {
      $('miniMsg').textContent = `✗ 오답. 남은 기회 ${mini.lives}/3`;
      $('miniMsg').style.color = '#ff4d4d';
    }
  });

  $('btnMiniHint')?.addEventListener('click', () => {
    if (mini.finished || mini.usedHint) return;
    playClick();
    mini.usedHint = true;
    $('miniHintBadge')?.classList.remove('hidden');
    if ($('btnMiniHint')) $('btnMiniHint').disabled = true;
    
    if ($('miniMsg')) {
      $('miniMsg').textContent = mini.case?.hint ?? '힌트 없음';
      $('miniMsg').style.color = '#ffa94d';
    }
  });

  $('btnMiniRestart')?.addEventListener('click', () => {
    playClick();
    startMini();
  });
}

// ========================================
// 플레이 페이지
// ========================================
function bindTabs() {
  document.querySelectorAll('.tab').forEach(b => {
    b.addEventListener('click', () => {
      playClick();
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tabPane').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      $('tab-' + b.dataset.tab)?.classList.add('active');
    });
  });
}

function updateStats() {
  if ($('statRoom')) $('statRoom').textContent = state.currentRoom;
  if ($('statStep')) $('statStep').textContent = state.currentStep;
  
  if (state.gameStartTime && $('statTime')) {
    const elapsed = Math.floor((Date.now() - state.gameStartTime) / 1000);
    $('statTime').textContent = formatTime(elapsed);
  }
}

function startTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    if (state.gameStartTime && $('statTime')) {
      const elapsed = Math.floor((Date.now() - state.gameStartTime) / 1000);
      $('statTime').textContent = formatTime(elapsed);
    }
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function nodeById(id) {
  return state.storyData?.nodes?.find(n => n.id === id) ?? null;
}

// 🆕 조건 체크
function checkRequires(requires) {
  if (!requires) return true;
  
  // 아이템 체크
  if (requires.items) {
    for (const item of requires.items) {
      if (!state.inventory.includes(item)) return false;
    }
  }
  
  // 플래그 체크
  if (requires.flags) {
    for (const flag of requires.flags) {
      if (!state.flags[flag]) return false;
    }
  }
  
  // 위협 수치 체크
  if (requires.maxThreat !== undefined && state.threat > requires.maxThreat) return false;
  if (requires.minThreat !== undefined && state.threat < requires.minThreat) return false;
  
  return true;
}

// 🆕 효과 적용
function applyEffects(effects) {
  if (!effects) return;
  
  // 아이템 추가
  if (effects.addItems) {
    for (const item of effects.addItems) {
      if (!state.inventory.includes(item)) {
        state.inventory.push(item);
        console.log('아이템 획득:', item);
      }
    }
  }
  
  // 아이템 제거
  if (effects.removeItems) {
    for (const item of effects.removeItems) {
      const idx = state.inventory.indexOf(item);
      if (idx > -1) state.inventory.splice(idx, 1);
    }
  }
  
  // 플래그 설정
  if (effects.setFlags) {
    for (const flag of effects.setFlags) {
      state.flags[flag] = true;
      console.log('플래그 설정:', flag);
    }
  }
  
  // 플래그 해제
  if (effects.clearFlags) {
    for (const flag of effects.clearFlags) {
      delete state.flags[flag];
    }
  }
  
  // 위협 수치 변경
  if (effects.threat !== undefined) {
    state.threat = Math.max(0, state.threat + effects.threat);
    console.log('위협 수치:', state.threat);
  }
}

function goNode(id) {
  const node = nodeById(id);
  if (!node) return;
  
  state.currentNode = node;
  state.currentStep++;
  
  if (node.room) state.currentRoom = node.room;
  
  // 🆕 노드 진입 시 효과 적용
  if (node.onEnter) applyEffects(node.onEnter);
  
  updateStats();
  
  $('phaseChip').textContent = `${state.currentRoom}번 방`;
  
  // 진행도에 따른 BGM 변경
  if (state.currentStep < 5) {
    playBGM('TENSION_LOW');
  } else if (state.currentStep < 10) {
    playBGM('TENSION_MID');
  } else if (state.currentStep < 15) {
    playBGM('TENSION_HIGH');
  } else {
    playBGM('NEAR_END');
  }
  
  playAmbient('fluorescent');

  const sceneImg = $('sceneImage');
  if (sceneImg) sceneImg.src = img('bg', node.bg || 'r1_bg_lobby_01');

  if ($('storyText')) $('storyText').textContent = node.text;

  const choicesEl = $('choices');
  if (choicesEl) {
    choicesEl.innerHTML = '';
    (node.choices || []).forEach((ch, i) => {
      // 🆕 조건 미충족 시 선택지 숨김 또는 비활성화
      const meetsRequires = checkRequires(ch.requires);
      
      const btn = document.createElement('button');
      btn.className = 'choiceBtn';
      
      // 조건 미충족 시 잠금 표시
      if (!meetsRequires && ch.requiresHint) {
        btn.classList.add('locked');
        btn.innerHTML = `
          <span class="tag">🔒</span>
          <span class="text">${esc(ch.requiresHint)}</span>
        `;
        btn.disabled = true;
      } else if (!meetsRequires && ch.hidden) {
        // hidden이면 아예 안 보임
        return;
      } else {
        btn.innerHTML = `
          <span class="tag">${String.fromCharCode(65 + i)}</span>
          <span class="text">${esc(ch.label)}</span>
        `;
        
        if (!meetsRequires) {
          btn.disabled = true;
          btn.classList.add('locked');
        }
      }
      
      btn.addEventListener('click', () => {
        if (!meetsRequires) return;
        
        playClick();
        
        // 🆕 선택 효과 적용
        applyEffects(ch.effects);
        
        if (ch.type === 'death') {
          handleDeath(ch.deathType || '함정', ch.deathMsg || '당신은 죽었습니다');
        } else {
          goNode(ch.next);
        }
      });
      choicesEl.appendChild(btn);
    });
  }
}

async function handleDeath(type, msg) {
  playDeathSound();
  stopBGM();
  stopAmbient();
  stopTimer();
  
  // 서버에 게임 종료 알림
  await endGame();
  
  const survivalTime = state.gameStartTime ? Math.floor((Date.now() - state.gameStartTime) / 1000) : 0;
  
  state.lastDeath = addDeath(type, msg, state.currentRoom, state.currentStep, survivalTime);
  state.lastDeath.survivalTimeStr = formatTime(survivalTime);
  
  openDeathModal(type, msg);
}

function openDeathModal(type, msg) {
  const modal = $('deathModal');
  if (!modal) return;

  const bgImg = $('deathBgImg');
  if (bgImg) bgImg.src = img('death', 'death_report_02_trap');
  
  if ($('deathType')) $('deathType').textContent = type;
  if ($('deathMsg')) $('deathMsg').textContent = msg;

  const willInput = $('willInput');
  if (willInput) {
    willInput.value = '';
    willInput.oninput = () => {
      if ($('charCount')) $('charCount').textContent = willInput.value.length;
    };
  }
  if ($('charCount')) $('charCount').textContent = '0';

  modal.classList.remove('hidden');
}

function closeDeathModal(willText) {
  $('deathModal')?.classList.add('hidden');

  if (willText?.trim() && state.lastDeath) {
    addWill(willText.trim(), {
      room: state.lastDeath.room,
      step: state.lastDeath.step,
      type: state.lastDeath.type
    });
    state.lastDeath.willText = willText.trim();
  }

  renderFeeds();
  openShareModal();

  setBan();
  showBanNotice();
  updateQueueDisplay();
}

// ========================================
// 유언 카드 공유 시스템
// ========================================
function openShareModal() {
  const modal = $('shareModal');
  if (!modal || !state.lastDeath) return;
  
  if ($('previewHeader')) $('previewHeader').textContent = '사망 보고서';
  if ($('previewBody')) $('previewBody').textContent = state.lastDeath.willText || '(유언 없음)';
  if ($('previewFooter')) {
    $('previewFooter').textContent = `${state.lastDeath.room}번 방 · ${state.lastDeath.step}단계 · ${state.lastDeath.type} · ${state.lastDeath.survivalTimeStr || '0:00'}`;
  }
  
  modal.classList.remove('hidden');
}

function closeShareModal() {
  $('shareModal')?.classList.add('hidden');
  resetGameState();
  startQueuePolling();
}

function generateWillCard() {
  const canvas = $('willCardCanvas');
  if (!canvas || !state.lastDeath) return null;
  
  const ctx = canvas.getContext('2d');
  const W = 600;
  const H = 400;
  canvas.width = W;
  canvas.height = H;
  
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  
  ctx.strokeStyle = '#ff4d4d';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  
  ctx.fillStyle = '#ff4d4d';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('사망 보고서', 30, 50);
  
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(30, 70);
  ctx.lineTo(W - 30, 70);
  ctx.stroke();
  
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '20px sans-serif';
  const text = state.lastDeath.willText || '(유언 없음)';
  
  const maxWidth = W - 60;
  const lines = [];
  let line = '';
  for (const char of text) {
    const testLine = line + char;
    if (ctx.measureText(testLine).width > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = testLine;
    }
  }
  lines.push(line);
  
  let y = 130;
  for (const l of lines.slice(0, 5)) {
    ctx.fillText(`"${l}"`, 30, y);
    y += 36;
  }
  
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(30, H - 80);
  ctx.lineTo(W - 30, H - 80);
  ctx.stroke();
  
  ctx.fillStyle = '#888';
  ctx.font = '12px monospace';
  ctx.fillText(`${state.lastDeath.room}번 방 · ${state.lastDeath.step}단계`, 30, H - 50);
  ctx.fillText(`${state.lastDeath.type} · ${state.lastDeath.survivalTimeStr || '0:00'}`, 30, H - 30);
  
  ctx.fillStyle = '#555';
  ctx.textAlign = 'right';
  ctx.fillText(state.lastDeath.time, W - 30, H - 30);
  ctx.textAlign = 'left';
  
  return canvas.toDataURL('image/png');
}

function downloadWillCard() {
  playClick();
  playSFX('share');
  const dataUrl = generateWillCard();
  if (!dataUrl) return;
  
  const link = document.createElement('a');
  link.download = `사망보고서_${Date.now()}.png`;
  link.href = dataUrl;
  link.click();
}

function copyShareLink() {
  playClick();
  
  const url = new URL(window.location.origin);
  
  navigator.clipboard.writeText(url.toString()).then(() => {
    const btn = $('btnCopyLink');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '복사 완료!';
      setTimeout(() => btn.textContent = orig, 1500);
    }
  }).catch(() => {
    alert('링크 복사에 실패했습니다.');
  });
}

function resetGameState() {
  state.currentRoom = 1;
  state.currentStep = 0;
  state.currentNode = null;
  state.gameStartTime = null;
  state.lastDeath = null;
  state.queue.isPlaying = false;
  
  // 🆕 상태 초기화
  state.flags = {};
  state.inventory = [];
  state.threat = 0;
  
  updateStats();
  
  $('phaseChip').textContent = '로비';
  if ($('storyText')) {
    $('storyText').textContent = state.isBanned ? 
      '24시간 참가 제한 중입니다. 유언, 사망기록, 랭킹 탭에서 기록을 열람할 수 있습니다.' : 
      '시작하기 버튼을 눌러 릴레이에 참가하세요.';
  }
  if ($('choices')) $('choices').innerHTML = '';
  if ($('statTime')) $('statTime').textContent = '0:00';
  
  const sceneImg = $('sceneImage');
  if (sceneImg) sceneImg.src = img('bg', 'r1_bg_lobby_01');
}

function renderFeeds() {
  const willList = $('willList');
  const willCount = $('willCount');
  if (willList) {
    if (state.wills.length === 0) {
      willList.innerHTML = '<div class="emptyState">아직 유언이 없습니다</div>';
    } else {
      willList.innerHTML = state.wills.map(w => `
        <div class="feedItem">
          <img class="bgImg" src="${img('will', 'will_card_01_clean')}" alt="" />
          <div class="content">
            <div class="willText">"${esc(w.text)}"</div>
            <div class="meta">${w.room}번 방 · ${w.step}단계 · ${esc(w.deathType)} · ${esc(w.time)}</div>
          </div>
        </div>
      `).join('');
    }
  }
  if (willCount) willCount.textContent = state.wills.length;

  const deathList = $('deathList');
  const deathCount = $('deathCount');
  if (deathList) {
    if (state.deaths.length === 0) {
      deathList.innerHTML = '<div class="emptyState">아직 사망 기록이 없습니다</div>';
    } else {
      deathList.innerHTML = state.deaths.map(d => `
        <div class="feedItem">
          <img class="bgImg" src="${img('death', 'death_report_02_trap')}" alt="" />
          <div class="content">
            <div class="willText">${esc(d.type)}</div>
            <div class="meta">${esc(d.msg)} · ${d.room}번 방 · ${d.step}단계 · ${formatTime(d.survivalTime)}</div>
          </div>
        </div>
      `).join('');
    }
  }
  if (deathCount) deathCount.textContent = state.deaths.length;

  const rankList = $('rankList');
  if (rankList) {
    if (state.rank.length === 0) {
      rankList.innerHTML = '<div class="emptyState">아직 랭킹 데이터가 없습니다</div>';
    } else {
      rankList.innerHTML = state.rank.map((r, i) => `
        <div class="feedItem">
          <img class="bgImg" src="${img('rank', 'rank_card_01_normal')}" alt="" />
          <div class="content">
            <div class="willText">#${i + 1} · ${r.step}단계</div>
            <div class="meta">${r.room}번 방 · ${formatTime(r.survivalTime)} · ${esc(r.time)}</div>
          </div>
        </div>
      `).join('');
    }
  }
}

async function bindPlay() {
  loadData();
  
  state.isBanned = checkBan();
  if (state.isBanned) showBanNotice();

  bindTabs();
  updateStats();
  renderFeeds();
  
  initAudio();
  playBGM('TENSION_LOW');
  
  // 대기열 폴링 시작
  startQueuePolling();

  // 시작하기
  $('btnStartRun')?.addEventListener('click', async () => {
    if (state.isBanned) return;
    
    playClick();
    
    // 이미 대기열에 없으면 참가
    if (state.queue.position === 0 && !state.queue.isMyTurn) {
      const joinResult = await joinQueue();
      if (joinResult?.ok) {
        // 대기열 상태 갱신
        const status = await fetchQueueStatus();
        if (status) {
          state.queue.total = status.total || 0;
          state.queue.position = status.position || 0;
          state.queue.playing = status.playing || 0;
          state.queue.isMyTurn = status.isMyTurn || false;
          updateQueueDisplay();
        }
      }
      return;
    }
    
    // 내 차례면 게임 시작
    if (state.queue.isMyTurn) {
      const result = await startGame();
      if (result?.ok || result?.started) {
        stopQueuePolling();
        state.currentRoom = 1;
        state.currentStep = 0;
        state.gameStartTime = Date.now();
        state.queue.isPlaying = true;
        updateStats();
        updateQueueDisplay();
        startTimer();
        goNode('n1');
      } else if (result?.error) {
        alert(result.error);
      }
    }
  });

  // 미니게임
  $('btnMiniFromLobby')?.addEventListener('click', () => {
    playClick();
    location.href = '/?mini=1';
  });

  // 로그아웃
  $('btnLogout')?.addEventListener('click', async () => {
    playClick();
    stopQueuePolling();
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });

  // 사망 모달
  $('btnSkipWill')?.addEventListener('click', () => {
    playClick();
    closeDeathModal('');
  });
  $('btnSubmitWill')?.addEventListener('click', () => {
    playClick();
    closeDeathModal($('willInput')?.value || '');
  });

  // 공유 모달
  $('btnDownloadCard')?.addEventListener('click', downloadWillCard);
  $('btnCopyLink')?.addEventListener('click', copyShareLink);
  $('btnCloseShare')?.addEventListener('click', () => {
    playClick();
    closeShareModal();
  });

  const sceneImg = $('sceneImage');
  if (sceneImg) sceneImg.src = img('bg', 'r1_bg_lobby_01');
  
  if ($('storyText')) {
    $('storyText').textContent = state.isBanned ? 
      '24시간 참가 제한 중입니다. 유언, 사망기록, 랭킹 탭에서 기록을 열람할 수 있습니다.' : 
      '시작하기 버튼을 눌러 릴레이에 참가하세요.';
  }
}

// ========================================
// 초기화
// ========================================
async function init() {
  try {
    state.images = await fetchJSON('/data/manifests/images.json');
    state.audio = await fetchJSON('/data/manifests/audio.json');
    state.config = await fetchJSON('/data/config.json');
    state.cases = await fetchJSON('/data/minigame_cases.json');
    state.storyData = await fetchJSON('/data/room1_story.json');

    if (isGatePage()) {
      bindGate();
      bindMini();
      
      const url = new URL(location.href);
      if (url.searchParams.get('mini') === '1') {
        $('gatePanel')?.classList.add('hidden');
        $('miniPanel')?.classList.remove('hidden');
        startMini();
      } else {
        startMini();
      }
    }

    if (isPlayPage()) {
      bindPlay();
    }
    
  } catch (e) {
    console.error('Init error:', e);
  }
}

init();
