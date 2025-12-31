// Napolitan Relay — v15 (Fixed)
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
  
  // 게임 상태 (localStorage에서 복원)
  wills: [],
  deaths: [],
  rank: [],
  
  // 플레이어 스탯
  hp: 100,
  sanity: 100,
  score: 0,
  
  // 현재 노드
  currentNode: null,
  currentRoom: 1,
  
  // 게임 시작 시간 (점수 계산용)
  gameStartTime: null,
  
  // 대기열 (실제 서버 연동 전까지는 테스트 모드)
  queue: {
    total: 0,      // 테스트 모드: 나만 접속
    position: 1,   // 내 순번
    playing: 0     // 현재 플레이 중인 사람 수
  },
  
  // 밴 상태
  isBanned: false,
  
  // 오디오 객체
  bgmPlayer: null,
  sfxPlayers: {}
};

// ========================================
// LocalStorage 키
// ========================================
const STORAGE_KEYS = {
  BAN_EXPIRY: 'nr_ban_expiry',
  WILLS: 'nr_wills',
  DEATHS: 'nr_deaths',
  RANK: 'nr_rank'
};

const BAN_DURATION = 24 * 60 * 60 * 1000; // 24시간

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

// ========================================
// 오디오 시스템
// ========================================
function initAudio() {
  state.bgmPlayer = new Audio();
  state.bgmPlayer.loop = true;
  state.bgmPlayer.volume = 0.3;
}

function playBGM(key) {
  if (!state.audio?.bgm?.[key] || !state.bgmPlayer) return;
  
  const src = state.audio.bgm[key];
  if (state.bgmPlayer.src !== src) {
    state.bgmPlayer.src = src;
    state.bgmPlayer.play().catch(() => {
      // 자동 재생 차단됨 - 사용자 상호작용 필요
      console.log('BGM autoplay blocked');
    });
  }
}

function stopBGM() {
  if (state.bgmPlayer) {
    state.bgmPlayer.pause();
    state.bgmPlayer.currentTime = 0;
  }
}

function playSFX(key) {
  if (!state.audio?.sfx?.[key]) return;
  
  const audio = new Audio(state.audio.sfx[key]);
  audio.volume = 0.5;
  audio.play().catch(() => {});
}

// ========================================
// 24시간 밴 시스템
// ========================================
function checkGameOverBan() {
  const expiry = localStorage.getItem(STORAGE_KEYS.BAN_EXPIRY);
  if (!expiry) return false;
  
  const expiryTime = parseInt(expiry, 10);
  if (Date.now() >= expiryTime) {
    localStorage.removeItem(STORAGE_KEYS.BAN_EXPIRY);
    return false;
  }
  return true;
}

function setGameOverBan() {
  const expiry = Date.now() + BAN_DURATION;
  localStorage.setItem(STORAGE_KEYS.BAN_EXPIRY, expiry.toString());
  state.isBanned = true;
}

function getBanTimeRemaining() {
  const expiry = localStorage.getItem(STORAGE_KEYS.BAN_EXPIRY);
  if (!expiry) return 0;
  return Math.max(0, parseInt(expiry, 10) - Date.now());
}

function formatTimeRemaining(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// 밴 상태 표시 (게임 차단하지 않고 배너로만 표시)
function showBanNotice() {
  const banNotice = $('banNotice');
  if (!banNotice) return;
  
  banNotice.classList.remove('hidden');
  
  function updateCountdown() {
    const remaining = getBanTimeRemaining();
    if (remaining <= 0) {
      banNotice.classList.add('hidden');
      state.isBanned = false;
      updateQueueDisplay();
      return;
    }
    $('banCountdown').textContent = formatTimeRemaining(remaining);
    setTimeout(updateCountdown, 1000);
  }
  
  updateCountdown();
}

// ========================================
// LocalStorage 데이터 관리
// ========================================
function loadStoredData() {
  try {
    const willsJson = localStorage.getItem(STORAGE_KEYS.WILLS);
    const deathsJson = localStorage.getItem(STORAGE_KEYS.DEATHS);
    const rankJson = localStorage.getItem(STORAGE_KEYS.RANK);
    
    if (willsJson) state.wills = JSON.parse(willsJson);
    if (deathsJson) state.deaths = JSON.parse(deathsJson);
    if (rankJson) state.rank = JSON.parse(rankJson);
  } catch (e) {
    console.error('Failed to load stored data:', e);
  }
}

function saveStoredData() {
  try {
    localStorage.setItem(STORAGE_KEYS.WILLS, JSON.stringify(state.wills));
    localStorage.setItem(STORAGE_KEYS.DEATHS, JSON.stringify(state.deaths));
    localStorage.setItem(STORAGE_KEYS.RANK, JSON.stringify(state.rank));
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

function addWill(text, deathType) {
  if (!text || !text.trim()) return;
  
  state.wills.unshift({
    text: text.trim(),
    time: new Date().toLocaleString('ko-KR'),
    deathType: deathType || 'UNKNOWN',
    room: state.currentRoom
  });
  
  // 최대 100개까지만 저장
  if (state.wills.length > 100) state.wills.pop();
  saveStoredData();
}

function addDeath(type, msg) {
  state.deaths.unshift({
    type: type || 'UNKNOWN',
    msg: msg || '',
    time: new Date().toLocaleString('ko-KR'),
    room: state.currentRoom,
    score: state.score
  });
  
  if (state.deaths.length > 100) state.deaths.pop();
  saveStoredData();
}

function addToRank(name, score, clearTime) {
  state.rank.push({ name, score, time: clearTime });
  state.rank.sort((a, b) => b.score - a.score);
  if (state.rank.length > 50) state.rank.pop();
  saveStoredData();
}

// ========================================
// 게이트 페이지 (로그인)
// ========================================
async function gateLogin(password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ password })
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error('API를 찾을 수 없습니다');
    if (response.status === 401) throw new Error('비밀번호가 틀렸습니다');
    throw new Error('로그인 실패');
  }

  return response.json();
}

function bindGate() {
  const pw = $('pw');
  const msg = $('gateMsg');
  const btnLogin = $('btnLogin');
  const keypad = $('keypad');
  const stampGranted = $('gateStampGranted');
  const stampDenied = $('gateStampDenied');
  const flash = $('gateFlash');

  const showStamp = (el) => {
    if (!el) return;
    el.style.opacity = '1';
    el.style.transform = 'rotate(-12deg) scale(1)';
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'rotate(-12deg) scale(.9)';
    }, 900);
  };

  const flashOnce = () => {
    if (!flash) return;
    flash.style.opacity = '1';
    setTimeout(() => flash.style.opacity = '0', 120);
  };

  if (keypad) {
    keypad.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      playSFX('sfx_ui_click_01');
      const k = b.dataset.k;
      if (k === 'clr') pw.value = '';
      else if (k === 'del') pw.value = pw.value.slice(0, -1);
      else pw.value += k;
    });
  }

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
      const res = await gateLogin(pw.value.trim());
      if (res.ok) {
        playSFX('sfx_access_granted_01');
        showStamp(stampGranted);
        msg.textContent = 'ACCESS GRANTED';
        msg.style.color = '#4dff88';
        setTimeout(() => location.href = '/play.html', 800);
      }
    } catch (err) {
      playSFX('sfx_access_denied_01');
      flashOnce();
      showStamp(stampDenied);
      msg.textContent = err.message || 'ACCESS DENIED';
      msg.style.color = '#ff4d4d';
      pw.value = '';
    } finally {
      setTimeout(() => btnLogin.disabled = false, 500);
    }
  }

  btnLogin?.addEventListener('click', doLogin);
  pw?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  // 미니게임 패널 전환
  const gatePanel = $('gatePanel');
  const miniPanel = $('miniPanel');
  
  $('btnToMini')?.addEventListener('click', () => {
    playSFX('sfx_ui_click_01');
    gatePanel?.classList.add('hidden');
    miniPanel?.classList.remove('hidden');
    startMini();
  });

  $('btnBackGate')?.addEventListener('click', () => {
    playSFX('sfx_ui_click_01');
    miniPanel?.classList.add('hidden');
    gatePanel?.classList.remove('hidden');
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

  const hintBtn = $('btnMiniHint');
  if (hintBtn) hintBtn.disabled = true;
  
  const accuseBtn = $('btnMiniAccuse');
  if (accuseBtn) accuseBtn.disabled = false;

  $('miniRuleBox')?.classList.add('hidden');
  
  const ruleImg = $('miniRuleImg');
  if (ruleImg) ruleImg.src = img('miniRule', 'torn_rules_01');
  
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
    
    playSFX('sfx_ui_click_01');
    
    const who = card.dataset.person;
    mini.accused = who;

    // 선택 표시
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

    playSFX('sfx_ui_click_01');

    const liar = mini.case.liar;
    if (mini.accused === liar) {
      mini.finished = true;
      playSFX('sfx_access_granted_01');
      const msg = $('miniMsg');
      if (msg) {
        msg.textContent = mini.usedHint ? '✓ 정답! (힌트 사용으로 랭킹 미등재)' : '✓ 정답입니다!';
        msg.style.color = '#4dff88';
      }
      if ($('btnMiniHint')) $('btnMiniHint').disabled = true;
      if ($('btnMiniAccuse')) $('btnMiniAccuse').disabled = true;
      return;
    }

    // 오답
    playSFX('sfx_access_denied_01');
    mini.lives -= 1;
    
    if (mini.lives <= 0) {
      mini.finished = true;
      if ($('miniMsg')) {
        $('miniMsg').textContent = `✗ 게임 오버. 정답은 ${liar}였습니다.`;
        $('miniMsg').style.color = '#ff4d4d';
      }
      if ($('btnMiniHint')) $('btnMiniHint').disabled = true;
      if ($('btnMiniAccuse')) $('btnMiniAccuse').disabled = true;
      $('miniLives').textContent = '♡♡♡';
      return;
    }

    // 목숨 2개 남음 → 규칙 공개
    if (mini.lives === 2) {
      $('miniRuleBox')?.classList.remove('hidden');
      if ($('miniRuleText')) $('miniRuleText').textContent = mini.case.ruleReveal ?? '';
    }

    // 목숨 1개 남음 → 힌트 사용 가능
    if (mini.lives === 1) {
      if ($('btnMiniHint')) $('btnMiniHint').disabled = false;
    }

    // 상태 업데이트
    $('miniLives').textContent = '♥'.repeat(mini.lives) + '♡'.repeat(3 - mini.lives);
    
    const msg = $('miniMsg');
    if (msg) {
      msg.textContent = `✗ 오답. 남은 기회 ${mini.lives}/3` + (mini.lives === 1 ? ' · 마지막 기회!' : '');
      msg.style.color = '#ff4d4d';
    }
  });

  $('btnMiniHint')?.addEventListener('click', () => {
    if (mini.finished || mini.usedHint) return;
    playSFX('sfx_ui_click_01');
    mini.usedHint = true;
    $('miniHintBadge')?.classList.remove('hidden');
    if ($('btnMiniHint')) $('btnMiniHint').disabled = true;
    
    const msg = $('miniMsg');
    if (msg) {
      msg.textContent = mini.case?.hint ?? '힌트 없음';
      msg.style.color = '#ffa94d';
    }
  });

  $('btnMiniRestart')?.addEventListener('click', () => {
    playSFX('sfx_ui_click_01');
    startMini();
  });
}

// ========================================
// 플레이 페이지
// ========================================
function bindTabs() {
  document.querySelectorAll('.tab').forEach(b => {
    b.addEventListener('click', () => {
      playSFX('sfx_ui_click_01');
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tabPane').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const t = b.dataset.tab;
      $('tab-' + t)?.classList.add('active');
    });
  });
}

function updateStats() {
  if ($('statHp')) $('statHp').textContent = state.hp;
  if ($('statSanity')) $('statSanity').textContent = state.sanity;
  if ($('statScore')) $('statScore').textContent = state.score;
}

function updateQueueDisplay() {
  // 밴 상태면 플레이 불가
  if (state.isBanned) {
    state.queue.total = 0;
    state.queue.position = 0;
    state.queue.playing = 0;
  }
  
  if ($('queueTotal')) $('queueTotal').textContent = state.queue.total;
  if ($('queuePosition')) $('queuePosition').textContent = state.queue.position;
  if ($('queuePlaying')) $('queuePlaying').textContent = state.queue.playing;
  
  // START 버튼 비활성화 (밴 상태)
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
  $('phaseChip').textContent = `ROOM ${state.currentRoom}`;
  
  // BGM 변경
  playBGM('ROOM_BASE_LOOP');

  // 이미지 업데이트
  const sceneImg = $('sceneImage');
  if (sceneImg) {
    sceneImg.src = img('bg', node.bg || 'r1_bg_lobby_01');
  }

  // 스탯 변경 적용
  if (node.statChange) {
    if (node.statChange.hp) state.hp = Math.max(0, Math.min(100, state.hp + node.statChange.hp));
    if (node.statChange.sanity) state.sanity = Math.max(0, Math.min(100, state.sanity + node.statChange.sanity));
    if (node.statChange.score) state.score = Math.max(0, state.score + node.statChange.score);
    updateStats();
  }

  // 텍스트 업데이트
  if ($('storyText')) $('storyText').textContent = node.text;

  // 선택지 렌더링
  const choicesEl = $('choices');
  if (choicesEl) {
    choicesEl.innerHTML = '';
    (node.choices || []).forEach((ch, i) => {
      const btn = document.createElement('button');
      btn.className = 'choiceBtn' + (ch.dangerHint ? ' danger-hint' : '');
      btn.innerHTML = `
        <span class="tag">${String.fromCharCode(65 + i)}</span>
        <span class="text">${esc(ch.label)}</span>
      `;
      btn.addEventListener('click', () => {
        playSFX('sfx_ui_click_01');
        
        if (ch.type === 'death') {
          openDeathModal(ch.deathType || 'death_report_01_rulebreak', ch.deathMsg || '당신은 죽었습니다');
        } else if (ch.type === 'stat') {
          // 스탯 변경 후 다음 노드로
          if (ch.statChange) {
            if (ch.statChange.hp) state.hp = Math.max(0, Math.min(100, state.hp + ch.statChange.hp));
            if (ch.statChange.sanity) state.sanity = Math.max(0, Math.min(100, state.sanity + ch.statChange.sanity));
            if (ch.statChange.score) state.score = Math.max(0, state.score + ch.statChange.score);
            updateStats();
          }
          goNode(ch.next);
        } else if (ch.type === 'clear') {
          // 룸 클리어
          handleRoomClear();
        } else {
          goNode(ch.next);
        }
      });
      choicesEl.appendChild(btn);
    });
  }
}

function handleRoomClear() {
  // 클리어 시간 계산
  const clearTime = state.gameStartTime ? Math.floor((Date.now() - state.gameStartTime) / 1000) : 0;
  const minutes = Math.floor(clearTime / 60);
  const seconds = clearTime % 60;
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;
  
  // 점수 보너스
  state.score += 100 + Math.max(0, 300 - clearTime); // 빨리 클리어할수록 보너스
  updateStats();
  
  // 랭킹 등록 (익명)
  addToRank(`Player_${Date.now().toString(36).slice(-4)}`, state.score, timeStr);
  
  // 다음 룸으로 (현재는 room1만 있으므로 클리어 메시지)
  openDeathModal('death_report_05_special', `Room ${state.currentRoom} 클리어!\n점수: ${state.score}\n시간: ${timeStr}`);
}

function openDeathModal(deathType, deathMsg) {
  const modal = $('deathModal');
  if (!modal) return;
  
  playSFX('sfx_death_hit_01');
  stopBGM();

  // 이미지 및 텍스트 설정
  const bgImg = $('deathBgImg');
  if (bgImg) bgImg.src = img('death', deathType);
  
  const typeLabel = deathType.replace('death_report_', '').replace(/_/g, ' ').toUpperCase();
  if ($('deathType')) $('deathType').textContent = typeLabel;
  if ($('deathMsg')) $('deathMsg').textContent = deathMsg;

  // 입력 초기화
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
  const modal = $('deathModal');
  if (modal) modal.classList.add('hidden');

  const deathType = $('deathType')?.textContent || 'UNKNOWN';
  const deathMsg = $('deathMsg')?.textContent || '';

  // 유언 저장
  if (willText && willText.trim()) {
    addWill(willText.trim(), deathType);
  }

  // 사망 기록 저장
  addDeath(deathType, deathMsg);

  // 피드 업데이트
  renderFeeds();

  // 클리어가 아닌 경우에만 밴
  if (!deathType.includes('SPECIAL')) {
    setGameOverBan();
    showBanNotice();
    updateQueueDisplay();
  }
  
  // 로비로 복귀
  resetGameState();
}

function resetGameState() {
  state.hp = 100;
  state.sanity = 100;
  state.score = 0;
  state.currentNode = null;
  state.gameStartTime = null;
  
  updateStats();
  
  $('phaseChip').textContent = 'LOBBY';
  if ($('storyText')) $('storyText').textContent = state.isBanned ? 
    '24시간 밴 상태입니다. 유언, 사망기록, 랭킹은 열람 가능합니다.' : 
    'START 버튼을 눌러 게임을 시작하세요.';
  if ($('choices')) $('choices').innerHTML = '';
  
  const sceneImg = $('sceneImage');
  if (sceneImg && state.config?.ui?.room1?.defaultBg) {
    sceneImg.src = img('bg', state.config.ui.room1.defaultBg);
  }
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
            <div class="meta">${esc(w.deathType)} · Room ${w.room || 1} · ${esc(w.time)}</div>
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
            <div class="meta">${esc(d.msg)} · Score: ${d.score || 0} · ${esc(d.time)}</div>
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
            <div class="willText">#${i + 1} ${esc(r.name)}</div>
            <div class="meta">Score: ${r.score} · Clear Time: ${r.time}</div>
          </div>
        </div>
      `).join('');
    }
  }
}

function bindPlay() {
  // 저장된 데이터 로드
  loadStoredData();
  
  // 밴 체크
  state.isBanned = checkGameOverBan();
  if (state.isBanned) {
    showBanNotice();
  }

  bindTabs();
  updateStats();
  updateQueueDisplay();
  renderFeeds();
  
  // BGM 시작
  playBGM('LOBBY_WAIT_LOOP');

  // 시작 버튼
  $('btnStartRun')?.addEventListener('click', () => {
    if (state.isBanned) return;
    
    playSFX('sfx_ui_click_01');
    state.hp = 100;
    state.sanity = 100;
    state.score = 0;
    state.gameStartTime = Date.now();
    state.queue.playing = 1;
    updateStats();
    updateQueueDisplay();
    goNode('n1');
  });

  // 미니게임 버튼
  $('btnMiniFromLobby')?.addEventListener('click', () => {
    playSFX('sfx_ui_click_01');
    location.href = '/?mini=1';
  });

  // 로그아웃
  $('btnLogout')?.addEventListener('click', async () => {
    playSFX('sfx_ui_click_01');
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });

  // 사망 모달 버튼
  $('btnSkipWill')?.addEventListener('click', () => {
    playSFX('sfx_ui_click_01');
    closeDeathModal('');
  });
  $('btnSubmitWill')?.addEventListener('click', () => {
    playSFX('sfx_ui_click_01');
    const willText = $('willInput')?.value || '';
    closeDeathModal(willText);
  });

  // 초기 이미지 설정
  const sceneImg = $('sceneImage');
  if (sceneImg && state.config?.ui?.room1?.defaultBg) {
    sceneImg.src = img('bg', state.config.ui.room1.defaultBg);
  }
  
  // 초기 메시지
  if ($('storyText')) {
    $('storyText').textContent = state.isBanned ? 
      '24시간 밴 상태입니다. 유언, 사망기록, 랭킹은 열람 가능합니다.' : 
      'START 버튼을 눌러 게임을 시작하세요.';
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
    
    initAudio();

    if (isGatePage()) {
      bindGate();
      bindMini();
      
      // URL 파라미터로 미니게임 시작
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
    document.body.innerHTML = `
      <div style="padding:24px;color:#ff4d4d;font-family:monospace">
        <h2>초기화 오류</h2>
        <pre style="white-space:pre-wrap;color:#ddd;padding:18px;background:rgba(0,0,0,.5);border-radius:8px">${esc(e.stack || e.message || String(e))}</pre>
      </div>
    `;
  }
}

init();
