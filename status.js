// 대기열 시스템 - Cloudflare KV 기반
// KV Namespace: QUEUE (wrangler.toml 또는 Dashboard에서 바인딩 필요)

const QUEUE_KEY = 'relay_queue';
const PLAYING_KEY = 'relay_playing';
const TIMEOUT_MS = 5 * 60 * 1000; // 5분 타임아웃

// 세션 ID 추출
function getSessionId(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/nr_session=([^;]+)/);
  return match ? match[1].split('.')[1] : null; // timestamp 부분을 ID로 사용
}

// GET /api/queue/status - 대기열 상태 조회
export async function onRequestGet(context) {
  const { env } = context;
  
  if (!env.QUEUE) {
    return new Response(JSON.stringify({ 
      error: 'KV_NOT_CONFIGURED',
      queue: [], 
      total: 0, 
      playing: null,
      position: 0
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }

  try {
    const queueData = await env.QUEUE.get(QUEUE_KEY, 'json') || [];
    const playingData = await env.QUEUE.get(PLAYING_KEY, 'json');
    
    // 타임아웃 체크 - 5분 이상 플레이 중이면 자동 종료
    if (playingData && Date.now() - playingData.startedAt > TIMEOUT_MS) {
      await env.QUEUE.delete(PLAYING_KEY);
      // 다음 사람 자동 입장
      if (queueData.length > 0) {
        const next = queueData.shift();
        await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));
        await env.QUEUE.put(PLAYING_KEY, JSON.stringify({
          id: next.id,
          startedAt: Date.now()
        }));
      }
    }

    const sessionId = getSessionId(context.request);
    const position = queueData.findIndex(q => q.id === sessionId) + 1;
    const isPlaying = playingData?.id === sessionId;

    return new Response(JSON.stringify({
      total: queueData.length,
      position: position,
      playing: playingData ? 1 : 0,
      isMyTurn: isPlaying || (queueData.length === 0 && !playingData) || (position === 1 && !playingData),
      isPlaying: isPlaying
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

// POST /api/queue/status - 대기열 참가/시작/종료
export async function onRequestPost(context) {
  const { request, env } = context;
  
  if (!env.QUEUE) {
    return new Response(JSON.stringify({ 
      error: 'KV_NOT_CONFIGURED',
      message: 'Cloudflare KV가 설정되지 않았습니다. Dashboard에서 QUEUE KV를 바인딩하세요.'
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }

  const sessionId = getSessionId(request);
  if (!sessionId) {
    return new Response(JSON.stringify({ error: '로그인이 필요합니다' }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const action = body.action;

  try {
    let queueData = await env.QUEUE.get(QUEUE_KEY, 'json') || [];
    let playingData = await env.QUEUE.get(PLAYING_KEY, 'json');

    // 타임아웃 체크
    if (playingData && Date.now() - playingData.startedAt > TIMEOUT_MS) {
      await env.QUEUE.delete(PLAYING_KEY);
      playingData = null;
    }

    switch (action) {
      case 'join': {
        // 이미 대기열에 있는지 확인
        const exists = queueData.find(q => q.id === sessionId);
        if (exists) {
          return new Response(JSON.stringify({ ok: true, message: '이미 대기열에 있습니다' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        
        // 현재 플레이 중인지 확인
        if (playingData?.id === sessionId) {
          return new Response(JSON.stringify({ ok: true, message: '이미 플레이 중입니다' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }

        // 대기열에 추가
        queueData.push({ id: sessionId, joinedAt: Date.now() });
        await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));

        return new Response(JSON.stringify({ 
          ok: true, 
          position: queueData.length,
          total: queueData.length
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      case 'start': {
        // 내 차례인지 확인
        const isFirst = queueData.length > 0 && queueData[0].id === sessionId;
        const noOneWaiting = queueData.length === 0 && !playingData;
        
        if (!isFirst && !noOneWaiting && playingData?.id !== sessionId) {
          return new Response(JSON.stringify({ 
            ok: false, 
            error: '아직 차례가 아닙니다',
            position: queueData.findIndex(q => q.id === sessionId) + 1
          }), {
            status: 403,
            headers: { 'content-type': 'application/json' }
          });
        }

        // 대기열에서 제거하고 플레이 상태로
        if (isFirst) {
          queueData.shift();
          await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));
        }
        
        await env.QUEUE.put(PLAYING_KEY, JSON.stringify({
          id: sessionId,
          startedAt: Date.now()
        }));

        return new Response(JSON.stringify({ ok: true, started: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      case 'end': {
        // 플레이 종료
        if (playingData?.id === sessionId) {
          await env.QUEUE.delete(PLAYING_KEY);
        }
        
        // 대기열에서도 제거
        queueData = queueData.filter(q => q.id !== sessionId);
        await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));

        return new Response(JSON.stringify({ ok: true, ended: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      case 'leave': {
        // 대기열에서 나가기
        queueData = queueData.filter(q => q.id !== sessionId);
        await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));

        return new Response(JSON.stringify({ ok: true, left: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      default:
        return new Response(JSON.stringify({ error: '알 수 없는 action' }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}
