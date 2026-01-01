// 엔딩 판정 시스템
// GET /api/global/ending - 현재 엔딩 상태 조회
// POST /api/global/ending - 시즌 종료 및 엔딩 확정

const GLOBAL_STATE_KEY = 'global_state';
const ENDING_HISTORY_KEY = 'ending_history';

// 엔딩 조건 평가 함수
function evaluateEnding(state, config) {
  const { tracks, flags, stats, shards } = state;
  
  const endings = [];
  
  // E1: 탈출 엔딩 - finalGateOpen && finalRunnerSuccess
  if (flags.finalGateOpen && flags.finalRunnerSuccess) {
    endings.push({
      id: 'escape',
      name: '탈출 엔딩',
      priority: 1,
      description: '최종 주자가 탈출에 성공했습니다. 시설을 벗어났습니다.',
      tone: 'victory'
    });
  }
  
  // E2: 봉인 엔딩 - sealProgress >= 100
  if ((tracks.sealProgress || 0) >= 100) {
    endings.push({
      id: 'seal',
      name: '봉인 엔딩',
      priority: 2,
      description: '시설이 영원히 봉인되었습니다. 아무도 나가지 못하지만, 그것도 나오지 못합니다.',
      tone: 'bittersweet'
    });
  }
  
  // E3: 진실 엔딩 - truth >= 500 && betrayal <= 100
  if ((tracks.truth || 0) >= 500 && (tracks.betrayal || 0) <= 100) {
    endings.push({
      id: 'truth',
      name: '진실 엔딩',
      priority: 3,
      description: '유언과 기록이 진실을 밝혔습니다. 세상은 이곳에서 일어난 일을 알게 됩니다.',
      tone: 'revelation'
    });
  }
  
  // E4: 희생 엔딩 - sacrifice >= 300
  if ((tracks.sacrifice || 0) >= 300) {
    endings.push({
      id: 'sacrifice',
      name: '희생 엔딩',
      priority: 4,
      description: '수많은 희생이 길을 열었습니다. 그들의 이름은 영원히 기억됩니다.',
      tone: 'solemn'
    });
  }
  
  // E5: 정화 엔딩 - purity > taint * 2
  if ((tracks.purity || 0) > (tracks.taint || 0) * 2) {
    endings.push({
      id: 'purification',
      name: '정화 엔딩',
      priority: 5,
      description: '빛이 어둠을 몰아냈습니다. 시설이 정화되었습니다.',
      tone: 'bright'
    });
  }
  
  // E6: 오염 엔딩 - taint > purity * 2
  if ((tracks.taint || 0) > (tracks.purity || 0) * 2) {
    endings.push({
      id: 'corruption',
      name: '오염 엔딩',
      priority: 6,
      description: '어둠이 모든 것을 삼켰습니다. 시설은 완전히 타락했습니다.',
      tone: 'dark'
    });
  }
  
  // E7: 침묵 엔딩 - 유언 사용률 낮고 규칙 준수율 높음
  const totalRuns = stats.totalRuns || 1;
  const willUsageRate = (stats.willCount || 0) / totalRuns;
  const ruleComplianceRate = 1 - ((stats.ruleViolations || 0) / totalRuns);
  
  if (willUsageRate < 0.2 && ruleComplianceRate > 0.8) {
    endings.push({
      id: 'silence',
      name: '침묵 엔딩',
      priority: 7,
      description: '말없이 규칙을 따랐습니다. 질서가 유지되었지만, 진실은 묻혔습니다.',
      tone: 'ambiguous'
    });
  }
  
  // E8: 시간초과 엔딩 (기본)
  endings.push({
    id: 'doomsday',
    name: '시간초과 엔딩',
    priority: 10,
    description: '시간이 다했습니다. 문은 열리지 않았고, 모두가 갇혔습니다.',
    tone: 'doom'
  });
  
  // 우선순위로 정렬 후 최우선 엔딩 반환
  endings.sort((a, b) => a.priority - b.priority);
  
  return {
    primary: endings[0],
    achieved: endings.filter(e => e.id !== 'doomsday'),
    all: endings
  };
}

// 엔딩 변주 계산 (같은 엔딩이라도 트랙에 따라 연출이 달라짐)
function calculateEndingVariation(ending, tracks) {
  const variation = {
    endingId: ending.id,
    modifiers: []
  };
  
  // 정화/오염 비율에 따른 변주
  const purityRatio = (tracks.purity || 0) / Math.max(1, (tracks.purity || 0) + (tracks.taint || 0));
  if (purityRatio > 0.7) {
    variation.modifiers.push({ type: 'bright', description: '빛이 함께합니다' });
  } else if (purityRatio < 0.3) {
    variation.modifiers.push({ type: 'dark', description: '어둠이 깊습니다' });
  }
  
  // 희생 수준에 따른 변주
  if ((tracks.sacrifice || 0) > 200) {
    variation.modifiers.push({ type: 'sacrifice', description: '희생의 흔적이 남았습니다' });
  }
  
  // 진실 수준에 따른 변주
  if ((tracks.truth || 0) > 300) {
    variation.modifiers.push({ type: 'truth', description: '진실이 기록되었습니다' });
  }
  
  // 배신 수준에 따른 변주
  if ((tracks.betrayal || 0) > 50) {
    variation.modifiers.push({ type: 'betrayal', description: '배신의 상처가 있습니다' });
  }
  
  return variation;
}

// GET - 현재 엔딩 상태 조회
export async function onRequestGet(context) {
  const { env } = context;
  
  if (!env.GLOBAL) {
    return new Response(JSON.stringify({ 
      error: 'KV_NOT_CONFIGURED',
      ending: null
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }

  try {
    const state = await env.GLOBAL.get(GLOBAL_STATE_KEY, 'json');
    
    if (!state) {
      return new Response(JSON.stringify({ 
        ending: null,
        message: '시즌이 시작되지 않았습니다'
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    
    // 현재 상태로 가능한 엔딩들 평가
    const endingResult = evaluateEnding(state, null);
    
    // 엔딩 변주 계산
    const variation = calculateEndingVariation(endingResult.primary, state.tracks);
    
    return new Response(JSON.stringify({
      seasonId: state.seasonId,
      phase: state.phase,
      currentEndings: endingResult,
      variation,
      tracks: state.tracks,
      flags: state.flags,
      stats: state.stats,
      isSeasonEnded: state.seasonEnded || false
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

// POST - 시즌 종료 및 엔딩 확정
export async function onRequestPost(context) {
  const { request, env } = context;
  
  if (!env.GLOBAL) {
    return new Response(JSON.stringify({ error: 'KV_NOT_CONFIGURED' }), {
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

  const { action } = body;

  try {
    let state = await env.GLOBAL.get(GLOBAL_STATE_KEY, 'json');
    
    if (!state) {
      return new Response(JSON.stringify({ error: '시즌 데이터가 없습니다' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    switch (action) {
      case 'end_season': {
        // 시즌 종료 처리
        if (state.seasonEnded) {
          return new Response(JSON.stringify({ 
            error: '시즌이 이미 종료되었습니다',
            ending: state.finalEnding
          }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          });
        }
        
        // 최종 엔딩 결정
        const endingResult = evaluateEnding(state, null);
        const variation = calculateEndingVariation(endingResult.primary, state.tracks);
        
        state.seasonEnded = true;
        state.seasonEndedAt = Date.now();
        state.finalEnding = {
          ...endingResult.primary,
          variation,
          achievedEndings: endingResult.achieved.map(e => e.id),
          finalStats: {
            totalRuns: state.stats.totalRuns,
            totalDeaths: state.stats.totalDeaths,
            maxRoomReached: state.stats.maxRoomReached,
            totalShards: Object.values(state.shards).reduce((a, b) => a + b, 0),
            purity: state.tracks.purity,
            taint: state.tracks.taint,
            sacrifice: state.tracks.sacrifice,
            truth: state.tracks.truth
          }
        };
        
        // 엔딩 히스토리에 추가
        let history = await env.GLOBAL.get(ENDING_HISTORY_KEY, 'json') || [];
        history.push({
          seasonId: state.seasonId,
          ending: state.finalEnding,
          endedAt: state.seasonEndedAt
        });
        await env.GLOBAL.put(ENDING_HISTORY_KEY, JSON.stringify(history));
        
        await env.GLOBAL.put(GLOBAL_STATE_KEY, JSON.stringify(state));

        return new Response(JSON.stringify({
          ok: true,
          message: '시즌이 종료되었습니다',
          ending: state.finalEnding
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      
      case 'get_history': {
        // 과거 시즌 엔딩 히스토리 조회
        const history = await env.GLOBAL.get(ENDING_HISTORY_KEY, 'json') || [];
        
        return new Response(JSON.stringify({
          history,
          count: history.length
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      
      case 'preview': {
        // 현재 상태로 엔딩 미리보기 (종료 없이)
        const endingResult = evaluateEnding(state, null);
        const variation = calculateEndingVariation(endingResult.primary, state.tracks);
        
        return new Response(JSON.stringify({
          preview: true,
          currentEnding: endingResult.primary,
          variation,
          achievedEndings: endingResult.achieved,
          allPossible: endingResult.all
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
    console.error('Ending error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}
