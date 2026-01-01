// Final Runner 추첨 시스템
// POST /api/global/final-runner - 추첨 등록/실행
// GET /api/global/final-runner - 현재 상태 조회

const GLOBAL_STATE_KEY = 'global_state';
const RUNNER_POOL_KEY = 'final_runner_pool';
const USER_ELIGIBILITY_PREFIX = 'user_eligibility_';

function getSessionId(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/nr_session=([^;]+)/);
  return match ? match[1].split('.')[1] : null;
}

// 가중치 기반 랜덤 선택
function weightedRandom(pool) {
  const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const entry of pool) {
    random -= entry.weight;
    if (random <= 0) {
      return entry;
    }
  }
  return pool[pool.length - 1];
}

// GET - 현재 Final Runner 상태 조회
export async function onRequestGet(context) {
  const { request, env } = context;
  
  if (!env.GLOBAL) {
    return new Response(JSON.stringify({ 
      error: 'KV_NOT_CONFIGURED',
      finalRunner: null
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }

  const sessionId = getSessionId(request);

  try {
    const state = await env.GLOBAL.get(GLOBAL_STATE_KEY, 'json');
    const pool = await env.GLOBAL.get(RUNNER_POOL_KEY, 'json') || [];
    
    let userEligibility = null;
    if (sessionId) {
      userEligibility = await env.GLOBAL.get(`${USER_ELIGIBILITY_PREFIX}${sessionId}`, 'json');
    }

    return new Response(JSON.stringify({
      finalRunner: state?.final || null,
      gateOpen: state?.flags?.finalGateOpen || false,
      poolSize: pool.length,
      userEligibility,
      phase: state?.phase || 0
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

// POST - 추첨 등록 또는 실행
export async function onRequestPost(context) {
  const { request, env } = context;
  
  if (!env.GLOBAL) {
    return new Response(JSON.stringify({ error: 'KV_NOT_CONFIGURED' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }

  const sessionId = getSessionId(request);
  
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  const { action } = body;

  try {
    let state = await env.GLOBAL.get(GLOBAL_STATE_KEY, 'json');
    let pool = await env.GLOBAL.get(RUNNER_POOL_KEY, 'json') || [];
    
    // 설정 로드
    let config;
    try {
      const configRes = await fetch(new URL('/data/global_config.json', request.url));
      config = await configRes.json();
    } catch {
      config = {
        finalRunner: {
          eligibility: { minDeposits: 5, maxBetrayalScore: 10, minRoomsCleared: 3 },
          weightFactors: { deposits: 2, purityContribution: 1.5, truthContribution: 1 }
        }
      };
    }

    switch (action) {
      case 'register': {
        // 추첨 등록
        if (!sessionId) {
          return new Response(JSON.stringify({ error: '로그인이 필요합니다' }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }

        // 이미 등록되었는지 확인
        if (pool.some(entry => entry.sessionId === sessionId)) {
          return new Response(JSON.stringify({ 
            error: '이미 등록되었습니다',
            registered: true 
          }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        // 유저 자격 조회
        const userElig = await env.GLOBAL.get(`${USER_ELIGIBILITY_PREFIX}${sessionId}`, 'json');
        if (!userElig) {
          return new Response(JSON.stringify({ 
            error: '자격 데이터가 없습니다. 먼저 게임을 플레이해주세요.' 
          }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        const elig = config.finalRunner.eligibility;
        
        // 자격 검증
        if (userElig.deposits < elig.minDeposits) {
          return new Response(JSON.stringify({ 
            error: `최소 ${elig.minDeposits}회 기부가 필요합니다 (현재: ${userElig.deposits})`,
            eligible: false
          }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (userElig.betrayalScore > elig.maxBetrayalScore) {
          return new Response(JSON.stringify({ 
            error: `배신 점수가 너무 높습니다 (${userElig.betrayalScore} > ${elig.maxBetrayalScore})`,
            eligible: false
          }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (userElig.roomsCleared < elig.minRoomsCleared) {
          return new Response(JSON.stringify({ 
            error: `최소 ${elig.minRoomsCleared}개 방을 클리어해야 합니다`,
            eligible: false
          }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        // 가중치 계산
        const factors = config.finalRunner.weightFactors;
        const weight = 
          (userElig.deposits * factors.deposits) +
          (userElig.purityContribution * factors.purityContribution) +
          (userElig.truthContribution * factors.truthContribution);

        // 풀에 등록
        pool.push({
          sessionId,
          weight: Math.max(1, weight),
          registeredAt: Date.now(),
          stats: userElig
        });

        await env.GLOBAL.put(RUNNER_POOL_KEY, JSON.stringify(pool));

        return new Response(JSON.stringify({
          ok: true,
          registered: true,
          weight,
          poolSize: pool.length,
          message: 'Final Runner 추첨에 등록되었습니다!'
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      case 'draw': {
        // 추첨 실행 (Final Gate가 열렸을 때만)
        if (!state?.flags?.finalGateOpen) {
          return new Response(JSON.stringify({ 
            error: 'Final Gate가 아직 열리지 않았습니다' 
          }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (state?.final?.runnerId) {
          return new Response(JSON.stringify({ 
            error: '이미 Final Runner가 선택되었습니다',
            runnerId: state.final.runnerId
          }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        if (pool.length === 0) {
          return new Response(JSON.stringify({ 
            error: '등록된 참가자가 없습니다' 
          }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        // 가중치 기반 추첨
        const winner = weightedRandom(pool);
        
        state.final = {
          runnerId: winner.sessionId,
          runnerResult: null,
          selectedAt: Date.now(),
          poolSize: pool.length,
          winnerWeight: winner.weight
        };
        
        state.flags.finalRunnerChosen = true;

        await env.GLOBAL.put(GLOBAL_STATE_KEY, JSON.stringify(state));

        return new Response(JSON.stringify({
          ok: true,
          finalRunner: state.final,
          message: 'Final Runner가 선택되었습니다!'
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      case 'complete': {
        // Final Run 결과 기록
        const { success } = body;
        
        if (!state?.final?.runnerId) {
          return new Response(JSON.stringify({ error: 'Final Runner가 없습니다' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }

        state.final.runnerResult = success ? 'SUCCESS' : 'FAILED';
        state.final.completedAt = Date.now();
        
        if (success) {
          state.flags.finalRunnerSuccess = true;
        }

        await env.GLOBAL.put(GLOBAL_STATE_KEY, JSON.stringify(state));

        return new Response(JSON.stringify({
          ok: true,
          result: state.final.runnerResult,
          message: success ? '탈출 성공! 시즌 클리어!' : 'Final Run 실패...'
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      case 'update_eligibility': {
        // 유저 자격 데이터 업데이트 (기부/플레이 시 호출)
        if (!sessionId) {
          return new Response(JSON.stringify({ error: '로그인 필요' }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          });
        }

        const { deposits, roomsCleared, purityContribution, truthContribution, betrayalScore } = body;
        
        let userElig = await env.GLOBAL.get(`${USER_ELIGIBILITY_PREFIX}${sessionId}`, 'json') || {
          deposits: 0,
          roomsCleared: 0,
          purityContribution: 0,
          truthContribution: 0,
          betrayalScore: 0
        };

        // 증분 업데이트
        if (deposits) userElig.deposits += deposits;
        if (roomsCleared) userElig.roomsCleared = Math.max(userElig.roomsCleared, roomsCleared);
        if (purityContribution) userElig.purityContribution += purityContribution;
        if (truthContribution) userElig.truthContribution += truthContribution;
        if (betrayalScore) userElig.betrayalScore += betrayalScore;

        await env.GLOBAL.put(`${USER_ELIGIBILITY_PREFIX}${sessionId}`, JSON.stringify(userElig));

        return new Response(JSON.stringify({
          ok: true,
          eligibility: userElig
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        });
    }
  } catch (e) {
    console.error('Final runner error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}
