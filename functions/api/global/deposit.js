// functions/api/global/deposit.js
// POST /api/global/deposit
// - 전역 조각(shards) 누적 + 진행도(progress) 상승
// - 기부 보상: base * phaseBonus * (weekly shard_boost if any)
// - 최소한의 악성/중복 방지: 쿠키 기반 userId, 분당 rate limit, 동일 요청 단기 중복 차단
// - purity/sacrifice 트랙도 함께 상승 (purity는 daily cap 적용: config.dailyCaps.purity)

const GLOBAL_STATE_KEY = 'global_state';

// ------------------------------
// 기본 전역 상태 (state.js와 동일)
// ------------------------------
function getDefaultState() {
  return {
    seasonId: 'S1',
    phase: 0,
    progress: 0,

    shards: { cam: 0, map: 0, blood: 0, mirror: 0 },

    tracks: {
      purity: 0,
      taint: 0,
      sacrifice: 0,
      truth: 0,
      betrayal: 0,
      sealProgress: 0,
      escapeProgress: 0,
      rebuildProgress: 0
    },

    infrastructure: { power: 0, comm: 0, map: 0 },

    flags: {
      finalGateOpen: false,
      finalRunnerChosen: false,
      finalRunnerSuccess: false,
      emergencyLightsOn: false,
      elevatorsActive: false,
      radioActive: false
    },

    stats: {
      totalRuns: 0,
      totalDeaths: 0,
      totalClears: 0,
      maxRoomReached: 1,
      willCount: 0,
      ruleViolations: 0,
      depositsToday: 0
    },

    final: { runnerId: null, runnerResult: null },

    seasonEnded: false,
    lastUpdated: Date.now()
  };
}

// ------------------------------
// 유틸
// ------------------------------
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });
}

function parseCookies(cookieHeader = '') {
  const out = {};
  cookieHeader.split(';').forEach(part => {
    const [k, ...rest] = part.trim().split('=');
    if (!k) return;
    out[k] = decodeURIComponent(rest.join('=') || '');
  });
  return out;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getISODateKey(ts = Date.now()) {
  return new Date(ts).toISOString().split('T')[0];
}

// Phase 요구치 확인 및 업데이트 (state.js 로직과 동일)
function checkPhaseAdvance(state, config) {
  const currentPhase = state.phase;
  const nextPhase = currentPhase + 1;
  const nextReq = config.phaseRequirements?.[String(nextPhase)];
  if (!nextReq || !nextReq.requirements) return { state, advanced: false };

  const requirements = nextReq.requirements;
  let canAdvance = true;

  for (const [shardType, required] of Object.entries(requirements)) {
    if ((state.shards[shardType] || 0) < required) {
      canAdvance = false;
      break;
    }
  }

  if (canAdvance) {
    state.phase = nextPhase;
    state.progress = 0; // 새 phase 진입 시 progress 리셋
    return { state, advanced: true };
  }
  return { state, advanced: false };
}

// 시즌 시작 기준 day(1-indexed) 계산
function getSeasonDay(stateOrConfig) {
  const start = stateOrConfig?.seasonStartDate;
  if (!start) return null;
  const daysSince = Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24));
  return daysSince + 1; // 1일부터 시작
}

// 오늘 weeklyEvents 적용(해당 day 이벤트)
function getTodayWeeklyEvent(config, seasonDay) {
  if (!config?.weeklyEvents?.enabled) return null;
  if (!seasonDay) return null;
  const schedule = Array.isArray(config.weeklyEvents.schedule) ? config.weeklyEvents.schedule : [];
  return schedule.find(e => Number(e.day) === Number(seasonDay)) || null;
}

// daily cap (유저별) 적용해서 트랙 업데이트
async function addTrackWithCap(env, config, state, { track, delta, userId }) {
  if (!state.tracks || state.tracks[track] === undefined) return { applied: 0 };

  const dailyCaps = config?.dailyCaps || {};
  const cap = dailyCaps[track];

  // 캡 없는 트랙
  if (!cap) {
    const next = Math.max(0, (state.tracks[track] || 0) + delta);
    const applied = next - (state.tracks[track] || 0);
    state.tracks[track] = next;
    return { applied };
  }

  // 캡 있는 트랙: 유저별 일일 사용량 체크
  const todayKey = getISODateKey();
  const usageKey = `daily_${track}_${userId}_${todayKey}`;
  const used = (await env.GLOBAL.get(usageKey, 'json')) || 0;

  if (used >= cap) return { applied: 0 };

  const effective = Math.min(delta, cap - used);
  state.tracks[track] = Math.max(0, (state.tracks[track] || 0) + effective);

  await env.GLOBAL.put(usageKey, JSON.stringify(used + effective), { expirationTtl: 86400 });
  return { applied: effective };
}

// ------------------------------
// CORS 프리플라이트(필요하면)
// ------------------------------
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}

// ------------------------------
// 메인: POST /api/global/deposit
// ------------------------------
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.GLOBAL) {
    return json({ ok: false, error: 'KV_NOT_CONFIGURED' }, 500);
  }

  // 바디 파싱
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400);
  }

  const shardType = String(body.shardType || '').trim();
  const roomId = body.roomId ?? null;
  const runStats = body.runStats ?? null;

  // shardType 검증
  const allowed = new Set(['cam', 'map', 'blood', 'mirror']);
  if (!allowed.has(shardType)) {
    return json({ ok: false, error: 'INVALID_SHARD_TYPE' }, 400);
  }

  // config 로드
  let config = {};
  try {
    const configRes = await fetch(new URL('/data/global_config.json', request.url));
    config = await configRes.json();
  } catch {
    config = {};
  }

  // state 로드
  let state = (await env.GLOBAL.get(GLOBAL_STATE_KEY, 'json')) || getDefaultState();

  // ------------------------------
  // userId 결정(최소 방어)
  // - 쿠키 nr_uid 우선
  // - 없으면 ip+ua 해시로 만들고 쿠키로 심음
  // ------------------------------
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  let userId = cookies.nr_uid;

  // cf-connecting-ip는 Cloudflare에서 제공
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = request.headers.get('user-agent') || '';
  let setCookieHeader = null;

  if (!userId) {
    // 동일 기기/동일 브라우저/동일 IP일 때는 최소한 동일하게 잡히는 수준
    userId = (await sha256Hex(`${ip}::${ua}`)).slice(0, 24);
    // 30일 유지 (시크릿 탭은 새 쿠키라 뚫릴 수 있음 = “최소 방어”)
    setCookieHeader =
      `nr_uid=${encodeURIComponent(userId)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax; Secure`;
  }

  // ------------------------------
  // rate limit (유저별 분당 5회)
  // ------------------------------
  const minute = Math.floor(Date.now() / 60000);
  const rateKey = `rate_deposit_${userId}_${minute}`;
  const rate = (await env.GLOBAL.get(rateKey, 'json')) || 0;
  if (rate >= 5) {
    return json({ ok: false, error: 'RATE_LIMIT' }, 429, setCookieHeader ? { 'set-cookie': setCookieHeader } : {});
  }
  await env.GLOBAL.put(rateKey, JSON.stringify(rate + 1), { expirationTtl: 120 });

  // ------------------------------
  // 단기 중복 차단(같은 shardType/room/step로 30초 내 반복 호출 방지)
  // ------------------------------
  const sigRaw = JSON.stringify({
    shardType,
    roomId,
    step: runStats?.step ?? null
  });
  const sig = (await sha256Hex(sigRaw)).slice(0, 16);
  const dupKey = `dup_deposit_${userId}_${sig}`;
  const dup = await env.GLOBAL.get(dupKey);
  if (dup) {
    return json(
      { ok: false, error: 'DUPLICATE_REQUEST' },
      409,
      setCookieHeader ? { 'set-cookie': setCookieHeader } : {}
    );
  }
  await env.GLOBAL.put(dupKey, '1', { expirationTtl: 30 });

  // ------------------------------
  // 보상 계산
  // ------------------------------
  const base = Number(config?.depositRewards?.base ?? 1) || 1;
  const phaseBonus = Number(config?.depositRewards?.phaseBonus?.[String(state.phase)] ?? 1) || 1;

  let value = base * phaseBonus;

  // weeklyEvents(오늘)이 shard_boost면 추가 곱
  const seasonDay = getSeasonDay(state);
  const todayEvent = getTodayWeeklyEvent(config, seasonDay);

  if (todayEvent?.event === 'shard_boost' && todayEvent?.target === shardType) {
    const m = Number(todayEvent.multiplier ?? 1) || 1;
    value *= m;
  }

  // value는 최소 1 정수로
  value = Math.max(1, Math.round(value));

  // ------------------------------
  // 상태 업데이트
  // ------------------------------
  const beforePhase = state.phase;

  // 1) shards 누적
  state.shards[shardType] = (state.shards[shardType] || 0) + value;

  // 2) progress(표시용) 상승: 0~100
  //    (정교한 퍼센트 계산은 나중에 phaseRequirements 기준으로 바꾸면 됨)
  state.progress = clamp((state.progress || 0) + value, 0, 100);

  // 3) 트랙 상승 (기부 = sacrifice + purity)
  // sacrifice는 캡 없이, purity는 daily cap 적용
  state.tracks.sacrifice = Math.max(0, (state.tracks.sacrifice || 0) + value);

  // purity daily cap 적용
  await addTrackWithCap(env, config, state, { track: 'purity', delta: value, userId });

  // week2에 sacrifice track_boost가 있는 날이면 sacrifice 추가 부스트(옵션)
  if (todayEvent?.event === 'track_boost' && todayEvent?.target === 'sacrifice') {
    const m = Number(todayEvent.multiplier ?? 1) || 1;
    const bonus = Math.max(0, Math.round(value * (m - 1)));
    if (bonus > 0) state.tracks.sacrifice = Math.max(0, (state.tracks.sacrifice || 0) + bonus);
  }

  // 4) 통계
  state.stats.depositsToday = (state.stats.depositsToday || 0) + 1;

  // 5) Phase 진행 체크
  const phaseCheck = checkPhaseAdvance(state, config);
  state = phaseCheck.state;
  const phaseAdvanced = phaseCheck.advanced;

  // 6) 최종 관문 체크(Phase 3 + escapeProgress>=100일 때)
  //    (escapeProgress는 다른 곳에서 올리겠지만, 여기서도 한 번 체크)
  if (state.phase >= 3) {
    const phase3Req = config.phaseRequirements?.['3'];
    if (phase3Req) {
      let canOpen = true;
      for (const [t, req] of Object.entries(phase3Req.requirements || {})) {
        if ((state.shards[t] || 0) < req) { canOpen = false; break; }
      }
      if (canOpen && (state.tracks.escapeProgress || 0) >= 100) {
        state.flags.finalGateOpen = true;
      }
    }
  }

  state.lastUpdated = Date.now();

  // 저장
  await env.GLOBAL.put(GLOBAL_STATE_KEY, JSON.stringify(state));

  // app.js에서 state.global에 merge할 값만 담아서 반환
  const returnState = {
    phase: state.phase,
    progress: state.progress,
    shards: state.shards,
    tracks: state.tracks,
    infrastructure: state.infrastructure,
    stats: state.stats,
    flags: state.flags
  };

  const headers = {};
  if (setCookieHeader) headers['set-cookie'] = setCookieHeader;

  return json(
    {
      ok: true,
      deposited: {
        shardType,
        value,
        // 디버그/표시용
        phaseBefore: beforePhase,
        phaseAfter: state.phase,
        phaseAdvanced
      },
      state: returnState
    },
    200,
    headers
  );
}
