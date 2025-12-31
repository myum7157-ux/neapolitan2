// Napolitan Relay — v16 (Full Redesign)
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
  
  // 저장 데이터
  wills: [],
  deaths: [],
  rank: [],
  
  // 플레이어 상태
  currentRoom: 1,
  currentStep: 0,      // 진행 단계 (선택지 통과 횟수)
  gameStartTime: null, // 생존 시간 측정
  timerInterval: null,
  
  // 현재 노드
  currentNode: null,
  
  // 대기열
  queue: {
    total: 0,
    position: 1,
    playing: 0
  },
  
  // 밴 상태
  isBanned: false,
  
  // 오디오
  audioInitialized: false,
  bgmPlayer: null,
  currentBgm: null,
  
  // 마지막 사망 정보 (카드 생성용)
  lastDeath: null
};

// ========================================
// Storage Keys
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
// 오디오 시스템 (수정됨)
// ========================================
function initAudio() {
  if (state.audioInitialized) return;
  
  state.bgmPlayer = new Audio();
  state.bgmPlayer.loop = true;
  state.bgmPlayer.volume = 0.3;
  state.audioInitialized = true;
}

function playBGM(key) {
  if (!state.audio?.bgm?.[key]) return;
  if (!state.bgmPlayer) initAudio();
  
  const src = state.audio.bgm[key];
  if (state.currentBgm === key) return;
  
  state.currentBgm = key;
  state.bgmPlayer.src = src;
  state.bgmPlayer.play().catch(() => {
    // 자동재생 차단됨 - 다음 클릭에서 재시도
  });
}

function stopBGM() {
  if (state.bgmPlayer) {
    state.bgmPlayer.pause();
    state.bgmPlayer.currentTime = 0;
    state.currentBgm = null;
  }
}

// SFX - 상황에 맞게 분리
function playSFX(key) {
  if (!state.audio?.sfx?.[key]) return;
  
  const audio = new Audio(state.audio.sfx[key]);
  audio.volume = 0.5;
  audio.play().catch(() => {});
}

// UI 클릭용 (가벼운 소리)
function playClick() {
  playSFX('sfx_ui_click_01');
  
  // BGM 자동재생 재시도
  if (state.bgmPlayer && state.currentBgm && state.bgmPlayer.paused) {
    state.bgmPlayer.play().catch(() => {});
  }
}

// 사망용
function playDeathSound() {
  playSFX('sfx_death_hit_01');
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
  
  // 랭킹에도 추가 (진행 단계 기준)
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

    msg.textContent = '처리중...';
    msg.style.color = '#6b8aff';
    btnLogin.disabled = true;

    try {
      await gateLogin(pw.value.trim());
      msg.textContent = 'ACCESS GRANTED';
      msg.style.color = '#4dff88';
      setTimeout(() => location.href = '/play.html', 600);
    } catch (err) {
      msg.textContent = err.message || 'ACCESS DENIED';
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
        <img alt="person ${k}" src="${img('miniPerson', 'person_' + k)}" />
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
      $('miniMsg').textContent = `현재 선택: ${who}`;
      $('miniMsg').style.color = '#6b8aff';
    }
  });

  $('btnMiniAccuse')?.addEventListener('click', () => {
    if (mini.finished || !mini.case) return;
    if (!mini.accused) {
      if ($('miniMsg')) {
        $('miniMsg').textContent = '먼저 인물을 선택하세요.';
        $('miniMsg').style.color = '#ffa94d';
      }
      return;
    }

    playClick();

    if (mini.accused === mini.case.liar) {
      mini.finished = true;
      if ($('miniMsg')) {
        $('miniMsg').textContent = mini.usedHint ? '✓ 정답! (힌트 사용)' : '✓ 정답!';
        $('miniMsg').style.color = '#4dff88';
      }
      if ($('btnMiniAccuse')) $('btnMiniAccuse').disabled = true;
      return;
    }

    mini.lives -= 1;
    
    if (mini.lives <= 0) {
      mini.finished = true;
      if ($('miniMsg')) {
        $('miniMsg').textContent = `✗ 게임 오버. 정답: ${mini.case.liar}`;
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
  if ($('statRoom')) $('statRoom').textContent = `Room ${state.currentRoom}`;
  if ($('statStep')) $('statStep').textContent = state.currentStep;
  
  // 생존 시간
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

function updateQueueDisplay() {
  if (state.isBanned) {
    state.queue.total = 0;
    state.queue.position = 0;
    state.queue.playing = 0;
  }
  
  if ($('queueTotal')) $('queueTotal').textContent = state.queue.total;
  if ($('queuePosition')) $('queuePosition').textContent = state.queue.position;
  if ($('queuePlaying')) $('queuePlaying').textContent = state.queue.playing;
  
  const startBtn = $('btnStartRun');
  if (startBtn) {
    startBtn.disabled = state.isBanned;
    startBtn.textContent = state.isBanned ? 'BANNED' : 'START';
  }
}

function nodeById(id) {
  return state.storyData?.nodes?.find(n => n.id === id) ?? null;
}

function goNode(id) {
  const node = nodeById(id);
  if (!node) return;
  
  state.currentNode = node;
  state.currentStep++;
  
  // 방 번호 업데이트 (노드 ID에서 추출 가능하면)
  if (node.room) state.currentRoom = node.room;
  
  updateStats();
  
  $('phaseChip').textContent = `Room ${state.currentRoom}`;
  
  // BGM
  playBGM('ROOM_BASE_LOOP');

  // 이미지
  const sceneImg = $('sceneImage');
  if (sceneImg) sceneImg.src = img('bg', node.bg || 'r1_bg_lobby_01');

  // 텍스트
  if ($('storyText')) $('storyText').textContent = node.text;

  // 선택지 (함정 표시 없음 - 모두 동일하게)
  const choicesEl = $('choices');
  if (choicesEl) {
    choicesEl.innerHTML = '';
    (node.choices || []).forEach((ch, i) => {
      const btn = document.createElement('button');
      btn.className = 'choiceBtn'; // 함정 표시 없음
      btn.innerHTML = `
        <span class="tag">${String.fromCharCode(65 + i)}</span>
        <span class="text">${esc(ch.label)}</span>
      `;
      btn.addEventListener('click', () => {
        playClick();
        
        if (ch.type === 'death') {
          handleDeath(ch.deathType || 'TRAP', ch.deathMsg || '당신은 죽었습니다');
        } else {
          goNode(ch.next);
        }
      });
      choicesEl.appendChild(btn);
    });
  }
}

function handleDeath(type, msg) {
  playDeathSound();
  stopBGM();
  stopTimer();
  
  const survivalTime = state.gameStartTime ? Math.floor((Date.now() - state.gameStartTime) / 1000) : 0;
  
  // 사망 기록 저장
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

  // 유언 저장
  if (willText?.trim() && state.lastDeath) {
    addWill(willText.trim(), {
      room: state.lastDeath.room,
      step: state.lastDeath.step,
      type: state.lastDeath.type
    });
    state.lastDeath.willText = willText.trim();
  }

  // 피드 업데이트
  renderFeeds();

  // 유언 카드 공유 모달 열기
  openShareModal();

  // 밴 설정
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
  
  // 프리뷰 업데이트
  if ($('previewHeader')) $('previewHeader').textContent = 'DEATH REPORT';
  if ($('previewBody')) $('previewBody').textContent = state.lastDeath.willText || '(유언 없음)';
  if ($('previewFooter')) {
    $('previewFooter').textContent = `Room ${state.lastDeath.room} · Step ${state.lastDeath.step} · ${state.lastDeath.type} · ${state.lastDeath.survivalTimeStr || '0:00'}`;
  }
  
  modal.classList.remove('hidden');
}

function closeShareModal() {
  $('shareModal')?.classList.add('hidden');
  resetGameState();
}

function generateWillCard() {
  const canvas = $('willCardCanvas');
  if (!canvas || !state.lastDeath) return null;
  
  const ctx = canvas.getContext('2d');
  const W = 600;
  const H = 400;
  canvas.width = W;
  canvas.height = H;
  
  // 배경
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  
  // 테두리
  ctx.strokeStyle = '#ff4d4d';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  
  // 헤더
  ctx.fillStyle = '#ff4d4d';
  ctx.font = '14px "JetBrains Mono", monospace';
  ctx.letterSpacing = '3px';
  ctx.fillText('DEATH REPORT', 30, 50);
  
  // 구분선
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(30, 70);
  ctx.lineTo(W - 30, 70);
  ctx.stroke();
  
  // 유언 텍스트
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '22px "Noto Sans KR", sans-serif';
  const text = state.lastDeath.willText || '(유언 없음)';
  
  // 줄바꿈 처리
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
  
  // 구분선
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(30, H - 80);
  ctx.lineTo(W - 30, H - 80);
  ctx.stroke();
  
  // 푸터 정보
  ctx.fillStyle = '#888';
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.fillText(`Room ${state.lastDeath.room} · Step ${state.lastDeath.step}`, 30, H - 50);
  ctx.fillText(`${state.lastDeath.type} · ${state.lastDeath.survivalTimeStr || '0:00'}`, 30, H - 30);
  
  // 타임스탬프
  ctx.fillStyle = '#555';
  ctx.textAlign = 'right';
  ctx.fillText(state.lastDeath.time, W - 30, H - 30);
  ctx.textAlign = 'left';
  
  return canvas.toDataURL('image/png');
}

function downloadWillCard() {
  playClick();
  const dataUrl = generateWillCard();
  if (!dataUrl) return;
  
  const link = document.createElement('a');
  link.download = `death_report_${Date.now()}.png`;
  link.href = dataUrl;
  link.click();
}

function copyShareLink() {
  playClick();
  
  // 현재 URL + 공유 파라미터
  const url = new URL(window.location.origin);
  url.searchParams.set('shared', '1');
  
  navigator.clipboard.writeText(url.toString()).then(() => {
    const btn = $('btnCopyLink');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '복사됨!';
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
  
  updateStats();
  
  $('phaseChip').textContent = 'LOBBY';
  if ($('storyText')) {
    $('storyText').textContent = state.isBanned ? 
      '24시간 참가 제한 중입니다. WILLS, DEATH, RANK 탭에서 기록을 열람할 수 있습니다.' : 
      'START 버튼을 눌러 릴레이에 참가하세요.';
  }
  if ($('choices')) $('choices').innerHTML = '';
  if ($('statTime')) $('statTime').textContent = '0:00';
  
  const sceneImg = $('sceneImage');
  if (sceneImg) sceneImg.src = img('bg', 'r1_bg_lobby_01');
}

function renderFeeds() {
  // WILLS
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
            <div class="meta">Room ${w.room} · Step ${w.step} · ${esc(w.deathType)} · ${esc(w.time)}</div>
          </div>
        </div>
      `).join('');
    }
  }
  if (willCount) willCount.textContent = state.wills.length;

  // DEATHS
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
            <div class="meta">${esc(d.msg)} · Room ${d.room} · Step ${d.step} · ${formatTime(d.survivalTime)}</div>
          </div>
        </div>
      `).join('');
    }
  }
  if (deathCount) deathCount.textContent = state.deaths.length;

  // RANK
  const rankList = $('rankList');
  if (rankList) {
    if (state.rank.length === 0) {
      rankList.innerHTML = '<div class="emptyState">아직 랭킹 데이터가 없습니다</div>';
    } else {
      rankList.innerHTML = state.rank.map((r, i) => `
        <div class="feedItem">
          <img class="bgImg" src="${img('rank', 'rank_card_01_normal')}" alt="" />
          <div class="content">
            <div class="willText">#${i + 1} · Step ${r.step}</div>
            <div class="meta">Room ${r.room} · ${formatTime(r.survivalTime)} · ${esc(r.time)}</div>
          </div>
        </div>
      `).join('');
    }
  }
}

function bindPlay() {
  loadData();
  
  state.isBanned = checkBan();
  if (state.isBanned) showBanNotice();

  bindTabs();
  updateStats();
  updateQueueDisplay();
  renderFeeds();
  
  initAudio();
  playBGM('LOBBY_WAIT_LOOP');

  // START
  $('btnStartRun')?.addEventListener('click', () => {
    if (state.isBanned) return;
    
    playClick();
    state.currentRoom = 1;
    state.currentStep = 0;
    state.gameStartTime = Date.now();
    state.queue.playing = 1;
    updateStats();
    updateQueueDisplay();
    startTimer();
    goNode('n1');
  });

  // MINI GAME
  $('btnMiniFromLobby')?.addEventListener('click', () => {
    playClick();
    location.href = '/?mini=1';
  });

  // LOGOUT
  $('btnLogout')?.addEventListener('click', async () => {
    playClick();
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

  // 초기 이미지
  const sceneImg = $('sceneImage');
  if (sceneImg) sceneImg.src = img('bg', 'r1_bg_lobby_01');
  
  if ($('storyText')) {
    $('storyText').textContent = state.isBanned ? 
      '24시간 참가 제한 중입니다. WILLS, DEATH, RANK 탭에서 기록을 열람할 수 있습니다.' : 
      'START 버튼을 눌러 릴레이에 참가하세요.';
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
