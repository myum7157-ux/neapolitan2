// Napolitan Relay — v14 Redesign
const $ = (id) => document.getElementById(id);

const state = {
  images: null,
  audio: null,
  config: null,
  cases: null,
  storyData: null,
  
  // 게임 상태
  wills: [],
  deaths: [],
  rank: [],
  
  // 플레이어 스탯
  hp: 100,
  sanity: 100,
  progress: 0,
  
  // 현재 노드
  currentNode: null,
  
  // 대기열 (시뮬레이션)
  queue: {
    total: Math.floor(Math.random() * 20) + 5,
    position: Math.floor(Math.random() * 5) + 1,
    playing: 1
  }
};

// 유틸리티
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
  if (section === 'overlay') return I.global_overlays?.[key] ?? '';
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
// 24시간 밴 시스템
// ========================================
const BAN_KEY = 'nr_ban_expiry';
const BAN_DURATION = 24 * 60 * 60 * 1000; // 24시간

function checkGameOverBan() {
  const expiry = localStorage.getItem(BAN_KEY);
  if (!expiry) return false;
  
  const expiryTime = parseInt(expiry, 10);
  if (Date.now() >= expiryTime) {
    localStorage.removeItem(BAN_KEY);
    return false;
  }
  return true;
}

function setGameOverBan() {
  const expiry = Date.now() + BAN_DURATION;
  localStorage.setItem(BAN_KEY, expiry.toString());
}

function getBanTimeRemaining() {
  const expiry = localStorage.getItem(BAN_KEY);
  if (!expiry) return 0;
  return Math.max(0, parseInt(expiry, 10) - Date.now());
}

function formatTimeRemaining(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function showGameOverScreen() {
  const screen = $('gameOverScreen');
  if (!screen) return;
  
  screen.classList.remove('hidden');
  
  function updateCountdown() {
    const remaining = getBanTimeRemaining();
    if (remaining <= 0) {
      screen.classList.add('hidden');
      location.reload();
      return;
    }
    $('banCountdown').textContent = formatTimeRemaining(remaining);
    setTimeout(updateCountdown, 1000);
  }
  
  updateCountdown();
  
  $('btnGoHome')?.addEventListener('click', () => {
    location.href = '/';
  });
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
        showStamp(stampGranted);
        msg.textContent = 'ACCESS GRANTED';
        msg.style.color = '#4dff88';
        setTimeout(() => location.href = '/play.html', 800);
      }
    } catch (err) {
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

  // 미니게임 패널 전환 (로그아웃 없이!)
  const gatePanel = $('gatePanel');
  const miniPanel = $('miniPanel');
  
  $('btnToMini')?.addEventListener('click', () => {
    gatePanel?.classList.add('hidden');
    miniPanel?.classList.remove('hidden');
    startMini();
  });

  $('btnBackGate')?.addEventListener('click', () => {
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
  if ($('miniSpeech')) $('miniSpeech').textContent = '카드를 눌러 발언을 확인해.';
  if ($('miniMsg')) $('miniMsg').textContent = '';

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
    
    const who = card.dataset.person;
    mini.accused = who;

    // 선택 표시
    document.querySelectorAll('.personCard').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');

    const lines = mini.case?.statements?.[who] ?? [];
    const idx = mini.saidIndex[who] ?? 0;
    const line = lines[idx] ?? lines[lines.length - 1] ?? '(...)';
    mini.saidIndex[who] = Math.min(idx + 1, Math.max(0, lines.length - 1));

    if ($('miniSpeech')) $('miniSpeech').textContent = `[${who}] ${line}`;
    if ($('miniMsg')) $('miniMsg').textContent = `현재 선택: ${who}`;
  });

  $('btnMiniAccuse')?.addEventListener('click', () => {
    if (mini.finished || !mini.case) return;
    if (!mini.accused) {
      if ($('miniMsg')) $('miniMsg').textContent = '누군가를 먼저 선택해.';
      return;
    }

    const liar = mini.case.liar;
    if (mini.accused === liar) {
      mini.finished = true;
      const msg = $('miniMsg');
      if (msg) {
        msg.textContent = mini.usedHint ? '✓ 성공! (힌트 사용: 랭킹 미등재)' : '✓ 성공!';
        msg.style.color = '#4dff88';
      }
      if ($('btnMiniHint')) $('btnMiniHint').disabled = true;
      return;
    }

    mini.lives -= 1;
    
    if (mini.lives <= 0) {
      mini.finished = true;
      if ($('miniMsg')) {
        $('miniMsg').textContent = '게임 오버. RESTART를 눌러 다시 시작.';
        $('miniMsg').style.color = '#ff4d4d';
      }
      if ($('btnMiniHint')) $('btnMiniHint').disabled = true;
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
    renderMini();
    
    const msg = $('miniMsg');
    if (msg) {
      msg.textContent = `✗ 오답. 남은 목숨 ${mini.lives}/3` + (mini.lives === 1 ? ' · 마지막 기회' : '');
      msg.style.color = '#ff4d4d';
    }
    
    // 규칙 유지
    if (mini.lives <= 2) {
      $('miniRuleBox')?.classList.remove('hidden');
      if ($('miniRuleText')) $('miniRuleText').textContent = mini.case.ruleReveal ?? '';
    }
  });

  $('btnMiniHint')?.addEventListener('click', () => {
    if (mini.finished || mini.usedHint) return;
    mini.usedHint = true;
    $('miniHintBadge')?.classList.remove('hidden');
    if ($('btnMiniHint')) $('btnMiniHint').disabled = true;
    
    const msg = $('miniMsg');
    if (msg) {
      msg.textContent = (mini.case?.hint ?? '힌트 없음') + ' (힌트 사용됨)';
      msg.style.color = '#ffa94d';
    }
  });

  $('btnMiniRestart')?.addEventListener('click', startMini);
}

// ========================================
// 플레이 페이지
// ========================================
function bindTabs() {
  document.querySelectorAll('.tab').forEach(b => {
    b.addEventListener('click', () => {
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
  if ($('statProgress')) $('statProgress').textContent = state.progress + '%';
}

function updateQueueDisplay() {
  if ($('queueTotal')) $('queueTotal').textContent = state.queue.total;
  if ($('queuePosition')) $('queuePosition').textContent = state.queue.position;
  if ($('queuePlaying')) $('queuePlaying').textContent = state.queue.playing;
}

function nodeById(id) {
  return state.storyData?.nodes?.find(n => n.id === id) ?? null;
}

function goNode(id) {
  const node = nodeById(id);
  if (!node) return;
  
  state.currentNode = node;
  $('phaseChip').textContent = 'ROOM 1';

  // 이미지 업데이트
  const sceneImg = $('sceneImage');
  if (sceneImg) {
    sceneImg.src = img('bg', node.bg || 'r1_bg_lobby_01');
  }

  // 스탯 변경 적용
  if (node.statChange) {
    if (node.statChange.hp) state.hp = Math.max(0, Math.min(100, state.hp + node.statChange.hp));
    if (node.statChange.sanity) state.sanity = Math.max(0, Math.min(100, state.sanity + node.statChange.sanity));
    if (node.statChange.progress) state.progress = Math.max(0, Math.min(100, state.progress + node.statChange.progress));
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
        if (ch.type === 'death') {
          openDeathModal(ch.deathType || 'death_report_01_rulebreak', ch.deathMsg || '당신은 죽었습니다');
        } else if (ch.type === 'stat') {
          // 스탯 변경 후 다음 노드로
          if (ch.statChange) {
            if (ch.statChange.hp) state.hp = Math.max(0, Math.min(100, state.hp + ch.statChange.hp));
            if (ch.statChange.sanity) state.sanity = Math.max(0, Math.min(100, state.sanity + ch.statChange.sanity));
            if (ch.statChange.progress) state.progress = Math.max(0, Math.min(100, state.progress + ch.statChange.progress));
            updateStats();
          }
          goNode(ch.next);
        } else {
          goNode(ch.next);
        }
      });
      choicesEl.appendChild(btn);
    });
  }
}

function openDeathModal(deathType, deathMsg) {
  const modal = $('deathModal');
  if (!modal) return;

  // 이미지 및 텍스트 설정
  const bgImg = $('deathBgImg');
  if (bgImg) bgImg.src = img('death', deathType);
  
  if ($('deathType')) $('deathType').textContent = deathType.replace('death_report_', '').toUpperCase();
  if ($('deathMsg')) $('deathMsg').textContent = deathMsg;

  // 입력 초기화
  const willInput = $('willInput');
  if (willInput) {
    willInput.value = '';
    willInput.addEventListener('input', () => {
      if ($('charCount')) $('charCount').textContent = willInput.value.length;
    });
  }
  if ($('charCount')) $('charCount').textContent = '0';

  modal.classList.remove('hidden');
}

function closeDeathModal(willText) {
  const modal = $('deathModal');
  if (modal) modal.classList.add('hidden');

  // 유언 저장
  if (willText && willText.trim()) {
    state.wills.unshift({
      text: willText.trim(),
      time: new Date().toLocaleString('ko-KR'),
      deathType: $('deathType')?.textContent || 'UNKNOWN'
    });
  }

  // 사망 기록 저장
  state.deaths.unshift({
    type: $('deathType')?.textContent || 'UNKNOWN',
    msg: $('deathMsg')?.textContent || '',
    time: new Date().toLocaleString('ko-KR')
  });

  // 피드 업데이트
  renderFeeds();

  // 24시간 밴 설정
  setGameOverBan();
  showGameOverScreen();
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
            <div class="willText">${esc(w.text)}</div>
            <div class="meta">${esc(w.deathType)} · ${esc(w.time)}</div>
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
            <div class="willText">${esc(d.type)}: ${esc(d.msg)}</div>
            <div class="meta">${esc(d.time)}</div>
          </div>
        </div>
      `).join('');
    }
  }
  if (deathCount) deathCount.textContent = state.deaths.length;

  // RANK (샘플 데이터)
  const rankList = $('rankList');
  if (rankList && state.rank.length === 0) {
    // 샘플 데이터
    state.rank = [
      { name: 'Player_A', score: 100, time: '12:34' },
      { name: 'Player_B', score: 85, time: '15:22' },
      { name: 'Player_C', score: 72, time: '18:45' }
    ];
  }
  if (rankList) {
    rankList.innerHTML = state.rank.map((r, i) => `
      <div class="feedItem">
        <img class="bgImg" src="${img('rank', 'rank_card_01_normal')}" alt="" />
        <div class="content">
          <div class="willText">#${i + 1} ${esc(r.name)}</div>
          <div class="meta">Score: ${r.score} · Time: ${r.time}</div>
        </div>
      </div>
    `).join('');
  }
}

function bindPlay() {
  // 밴 체크
  if (checkGameOverBan()) {
    showGameOverScreen();
    return;
  }

  bindTabs();
  updateStats();
  updateQueueDisplay();
  renderFeeds();

  // 시작 버튼
  $('btnStartRun')?.addEventListener('click', () => {
    state.hp = 100;
    state.sanity = 100;
    state.progress = 0;
    updateStats();
    goNode('n1');
  });

  // 미니게임 버튼 (로그아웃 없이 게이트로)
  $('btnMiniFromLobby')?.addEventListener('click', () => {
    location.href = '/?mini=1';
  });

  // 로그아웃
  $('btnLogout')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });

  // 사망 모달 버튼
  $('btnSkipWill')?.addEventListener('click', () => closeDeathModal(''));
  $('btnSubmitWill')?.addEventListener('click', () => {
    const willText = $('willInput')?.value || '';
    closeDeathModal(willText);
  });

  // 초기 이미지 설정
  const sceneImg = $('sceneImage');
  if (sceneImg && state.config?.ui?.room1?.defaultBg) {
    sceneImg.src = img('bg', state.config.ui.room1.defaultBg);
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
