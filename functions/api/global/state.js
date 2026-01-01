// 전역 상태 시스템 - Cloudflare KV 기반
// KV Namespace: GLOBAL (wrangler.toml에서 바인딩 필요)

const GLOBAL_STATE_KEY = 'global_state';
const DAILY_STATS_PREFIX = 'daily_stats_';

// 기본 전역 상태
function getDefaultState() {
  return {
    seasonId: 'S1',
    phase: 0,
    progress: 0,
    
    shards: {
      cam: 0,
      map: 0,
      blood: 0,
      mirror: 0
    },
    
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
    
    infrastructure: {
      power: 0,
      comm: 0,
      map: 0
    },
    
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
    
    final: {
      runnerId: null,
      runnerResult: null
    },
    
    seasonEnded: false,
    lastUpdated: Date.now()
  };
}

// Phase 요구치 확인 및 업데이트
function checkPhaseAdvance(state, config) {
  const currentPhase = state.phase;
  const nextPhase = currentPhase + 1;
  const nextReq = config.phaseRequirements?.[String(nextPhase)];
  
  if (!nextReq || !nextReq.requirements) return state;
  
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
    state.progress = 0; // Reset progress for new phase
    console.log(`Phase advanced to ${nextPhase}`);
  }
  
  return state;
}

// GET /api/global/state - 전역 상태 조회
export async function onRequestGet(context) {
  const { env } = context;
  
  if (!env.GLOBAL) {
    return new Response(JSON.stringify({ 
      error: 'KV_NOT_CONFIGURED',
      state: getDefaultState()
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }

  try {
    let state = await env.GLOBAL.get(GLOBAL_STATE_KEY, 'json');
    
    if (!state) {
      state = getDefaultState();
      await env.GLOBAL.put(GLOBAL_STATE_KEY, JSON.stringify(state));
    }
    
    // 조각 부족도 계산 (드랍 밸런싱용)
    const totalShards = Object.values(state.shards).reduce((a, b) => a + b, 0);
    const avgShards = totalShards / Object.keys(state.shards).length;
    
    const shardNeeds = {};
    const shardWeights = {};
    for (const [type, count] of Object.entries(state.shards)) {
      const need = Math.max(0, avgShards - count);
      shardNeeds[type] = need;
      // 가중치: 부족할수록 높음 (1.0 ~ 2.0)
      shardWeights[type] = need > 0 ? 1 + (need / Math.max(1, avgShards)) : 0.7;
    }
    
    // 현재 주차 계산
    let currentWeek = 1;
    let weeklyBoost = null;
    if (state.seasonStartDate) {
      const daysSinceStart = Math.floor((Date.now() - state.seasonStartDate) / (1000 * 60 * 60 * 24));
      currentWeek = Math.min(4, Math.floor(daysSinceStart / 7) + 1);
      
      // 설정에서 주간 부스트 정보 가져오기 (간단히 처리)
      const weekKey = `week${currentWeek}`;
      weeklyBoost = {
        week: currentWeek,
        boostTrack: weekKey === 'week1' ? 'truth' : 
                    weekKey === 'week2' ? 'sacrifice' :
                    weekKey === 'week3' ? ['purity', 'taint'] :
                    ['sealProgress', 'escapeProgress']
      };
    }
    
    return new Response(JSON.stringify({
      ...state,
      shardNeeds,
      shardWeights,
      currentWeek,
      weeklyBoost,
      serverTime: Date.now()
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}

// POST /api/global/state - 전역 상태 업데이트
export async function onRequestPost(context) {
  const { request, env } = context;
  
  if (!env.GLOBAL) {
    return new Response(JSON.stringify({ 
      error: 'KV_NOT_CONFIGURED'
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  const action = body.action;

  try {
    let state = await env.GLOBAL.get(GLOBAL_STATE_KEY, 'json') || getDefaultState();
    let config;
    
    try {
      const configRes = await fetch(new URL('/data/global_config.json', request.url));
      config = await configRes.json();
    } catch {
      config = { phaseRequirements: {} };
    }

    switch (action) {
      case 'increment_stat': {
        const { stat, amount = 1 } = body;
        if (state.stats[stat] !== undefined) {
          state.stats[stat] += amount;
        }
        break;
      }
      
      case 'update_track': {
        const { track, delta } = body;
        if (state.tracks[track] !== undefined) {
          state.tracks[track] = Math.max(0, state.tracks[track] + delta);
        }
        break;
      }
      
      case 'set_flag': {
        const { flag, value } = body;
        state.flags[flag] = value;
        break;
      }
      
      case 'update_max_room': {
        const { room } = body;
        if (room > state.stats.maxRoomReached) {
          state.stats.maxRoomReached = room;
        }
        break;
      }
      
      case 'update_infrastructure': {
        // 인프라 복구 (power, comm, map)
        const { type, delta = 1 } = body;
        if (state.infrastructure && state.infrastructure.hasOwnProperty(type)) {
          const maxLevel = config.infrastructure?.[type]?.max || 3;
          state.infrastructure[type] = Math.min(maxLevel, (state.infrastructure[type] || 0) + delta);
          
          // 인프라 해금에 따른 플래그 설정
          const unlocks = config.infrastructure?.[type]?.unlocks || [];
          const currentLevel = state.infrastructure[type];
          for (let i = 0; i < currentLevel && i < unlocks.length; i++) {
            state.flags[unlocks[i]] = true;
          }
          
          // rebuildProgress 증가
          state.tracks.rebuildProgress = (state.tracks.rebuildProgress || 0) + delta * 10;
        }
        break;
      }
      
      case 'update_track_with_cap': {
        // 일일 캡이 적용되는 트랙 업데이트
        const { track, delta, userId } = body;
        const dailyCaps = config.dailyCaps || {};
        
        if (state.tracks[track] !== undefined) {
          // 캡이 있는 트랙인지 확인
          if (dailyCaps[track]) {
            // 일일 사용량 체크 (유저별)
            const todayKey = new Date().toISOString().split('T')[0];
            const userDailyKey = `daily_${track}_${userId}_${todayKey}`;
            const userDailyUsage = await env.GLOBAL.get(userDailyKey, 'json') || 0;
            
            if (userDailyUsage >= dailyCaps[track]) {
              // 캡 초과 - 무시
              break;
            }
            
            const effectiveDelta = Math.min(delta, dailyCaps[track] - userDailyUsage);
            state.tracks[track] = Math.max(0, state.tracks[track] + effectiveDelta);
            
            // 일일 사용량 업데이트
            await env.GLOBAL.put(userDailyKey, JSON.stringify(userDailyUsage + effectiveDelta), {
              expirationTtl: 86400
            });
          } else {
            state.tracks[track] = Math.max(0, state.tracks[track] + delta);
          }
        }
        break;
      }
      
      case 'check_final_gate': {
        // 최종 관문 오픈 조건 체크
        const phase3Req = config.phaseRequirements?.['3'];
        if (state.phase >= 3 && phase3Req) {
          let canOpen = true;
          for (const [shardType, required] of Object.entries(phase3Req.requirements || {})) {
            if ((state.shards[shardType] || 0) < required) {
              canOpen = false;
              break;
            }
          }
          if (canOpen && (state.tracks.escapeProgress || 0) >= 100) {
            state.flags.finalGateOpen = true;
          }
        }
        break;
      }
      
      case 'reset_season': {
        // 시즌 리셋 (관리자 전용)
        state = getDefaultState();
        state.seasonId = body.newSeasonId || 'S' + (Date.now() % 1000);
        break;
      }
      
      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        });
    }
    
    // Phase 진행 체크
    state = checkPhaseAdvance(state, config);
    state.lastUpdated = Date.now();
    
    await env.GLOBAL.put(GLOBAL_STATE_KEY, JSON.stringify(state));

    return new Response(JSON.stringify({ ok: true, state }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}
