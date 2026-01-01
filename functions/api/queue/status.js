// functions/api/queue/status.js
// 대기열 시스템 v2 - 안정적인 사용자 ID + Heartbeat 시스템

const QUEUE_KEY = 'relay_queue';
const PLAYING_KEY = 'relay_playing';

// 타임아웃 설정
const PLAY_TIMEOUT_MS = 3 * 60 * 1000;      // 플레이 타임아웃: 3분 (heartbeat 없으면)
const HEARTBEAT_INTERVAL_MS = 30 * 1000;    // heartbeat 간격: 30초
const QUEUE_STALE_MS = 2 * 60 * 1000;       // 대기열 만료: 2분

// ============================================
// 사용자 ID 추출 (핵심 변경)
// ============================================
// 우선순위: nr_uid (안정적) > nr_session에서 추출 (fallback)
function getUserId(request) {
  const cookie = request.headers.get('cookie') || '';
  
  // 1. nr_uid 쿠키 우선 (안정적인 ID)
  const uidMatch = cookie.match(/nr_uid=([^;]+)/);
  if (uidMatch && uidMatch[1]) {
    return uidMatch[1];
  }
  
  // 2. fallback: nr_session에서 추출 (구버전 호환)
  const sessionMatch = cookie.match(/nr_session=([^;]+)/);
  if (sessionMatch) {
    return sessionMatch[1].split('.')[1]; // timestamp 부분
  }
  
  return null;
}

// 오래된 대기열 항목 정리
function cleanStaleQueue(queueData) {
  const now = Date.now();
  return queueData.filter(q => (now - q.joinedAt) < QUEUE_STALE_MS);
}

// 플레이 중 상태 검증 (heartbeat 체크)
function isPlayingValid(playingData) {
  if (!playingData) return false;
  
  const now = Date.now();
  const lastHeartbeat = playingData.lastHeartbeat || playingData.startedAt;
  
  // heartbeat가 타임아웃 시간보다 오래됐으면 무효
  if (now - lastHeartbeat > PLAY_TIMEOUT_MS) {
    return false;
  }
  
  return true;
}

// ============================================
// GET /api/queue/status - 상태 조회
// ============================================
export async function onRequestGet(context) {
  const { request, env } = context;
  
  if (!env.QUEUE) {
    return new Response(JSON.stringify({ 
      error: 'KV_NOT_CONFIGURED',
      total: 0, 
      playing: 0,
      position: 0,
      isMyTurn: true  // KV 없으면 그냥 바로 플레이 허용
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }

  try {
    const userId = getUserId(request);
    let queueData = await env.QUEUE.get(QUEUE_KEY, 'json') || [];
    let playingData = await env.QUEUE.get(PLAYING_KEY, 'json');
    
    // 1. 오래된 대기열 항목 정리
    const cleanedQueue = cleanStaleQueue(queueData);
    if (cleanedQueue.length !== queueData.length) {
      queueData = cleanedQueue;
      await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));
    }
    
    // 2. 플레이 중 상태 검증 (heartbeat 체크)
    if (playingData && !isPlayingValid(playingData)) {
      console.log(`Expired playing session: ${playingData.id?.substring(0, 8)}`);
      await env.QUEUE.delete(PLAYING_KEY);
      playingData = null;
    }
    
    // 3. 플레이 중인 사람이 없고 대기열이 있으면 다음 사람 자동 승격
    if (!playingData && queueData.length > 0) {
      const next = queueData.shift();
      playingData = {
        id: next.id,
        startedAt: Date.now(),
        lastHeartbeat: Date.now()
      };
      await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));
      await env.QUEUE.put(PLAYING_KEY, JSON.stringify(playingData));
    }

    // 4. 내 상태 계산
    const position = userId ? queueData.findIndex(q => q.id === userId) + 1 : 0;
    const isPlaying = playingData?.id === userId;
    const isMyTurn = isPlaying || (!playingData && queueData.length === 0);

    return new Response(JSON.stringify({
      total: queueData.length,
      position: position,
      playing: playingData ? 1 : 0,
      isMyTurn: isMyTurn,
      isPlaying: isPlaying,
      // 디버그 (프로덕션에서는 제거 가능)
      _debug: {
        myId: userId?.substring(0, 8),
        playingId: playingData?.id?.substring(0, 8),
        queueSize: queueData.length,
        playingValid: playingData ? isPlayingValid(playingData) : null
      }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    console.error('Queue GET error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}

// ============================================
// POST /api/queue/status - 대기열 조작
// ============================================
export async function onRequestPost(context) {
  const { request, env } = context;
  
  if (!env.QUEUE) {
    return new Response(JSON.stringify({ 
      error: 'KV_NOT_CONFIGURED',
      message: 'Cloudflare KV가 설정되지 않았습니다.'
    }), {
      status: 500,
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

  // ============================================
  // 관리자용: 대기열 완전 초기화
  // ============================================
  if (action === 'reset') {
    await env.QUEUE.delete(QUEUE_KEY);
    await env.QUEUE.delete(PLAYING_KEY);
    return new Response(JSON.stringify({ 
      ok: true, 
      message: '대기열 완전 초기화 완료' 
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }

  // 일반 액션은 로그인 필요
  const userId = getUserId(request);
  if (!userId) {
    return new Response(JSON.stringify({ error: '로그인이 필요합니다' }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }

  try {
    let queueData = await env.QUEUE.get(QUEUE_KEY, 'json') || [];
    let playingData = await env.QUEUE.get(PLAYING_KEY, 'json');

    // 정리 작업
    queueData = cleanStaleQueue(queueData);
    if (playingData && !isPlayingValid(playingData)) {
      await env.QUEUE.delete(PLAYING_KEY);
      playingData = null;
    }

    switch (action) {
      // ============================================
      // JOIN: 대기열 참가
      // ============================================
      case 'join': {
        // 이미 플레이 중이면 바로 성공
        if (playingData?.id === userId) {
          return jsonResponse({ 
            ok: true, 
            isPlaying: true, 
            message: '이미 플레이 중입니다' 
          });
        }
        
        // 이미 대기열에 있으면 갱신
        const existingIdx = queueData.findIndex(q => q.id === userId);
        if (existingIdx >= 0) {
          queueData[existingIdx].joinedAt = Date.now();
          await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));
          return jsonResponse({ 
            ok: true, 
            position: existingIdx + 1,
            message: '대기열 갱신됨' 
          });
        }

        // 아무도 없으면 바로 플레이 시작
        if (queueData.length === 0 && !playingData) {
          playingData = {
            id: userId,
            startedAt: Date.now(),
            lastHeartbeat: Date.now()
          };
          await env.QUEUE.put(PLAYING_KEY, JSON.stringify(playingData));
          return jsonResponse({ 
            ok: true, 
            isMyTurn: true,
            started: true,
            message: '바로 시작!' 
          });
        }

        // 대기열에 추가
        queueData.push({ id: userId, joinedAt: Date.now() });
        await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));

        return jsonResponse({ 
          ok: true, 
          position: queueData.length,
          total: queueData.length,
          message: '대기열 등록됨'
        });
      }

      // ============================================
      // START: 게임 시작
      // ============================================
      case 'start': {
        // 이미 플레이 중이면 성공 (heartbeat 갱신)
        if (playingData?.id === userId) {
          playingData.lastHeartbeat = Date.now();
          await env.QUEUE.put(PLAYING_KEY, JSON.stringify(playingData));
          return jsonResponse({ ok: true, started: true });
        }
        
        // 아무도 플레이 중이 아닌 경우
        if (!playingData) {
          const position = queueData.findIndex(q => q.id === userId);
          
          // 대기열이 비었거나 내가 1번이면 시작
          if (queueData.length === 0 || position === 0) {
            if (position === 0) {
              queueData.shift();
              await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));
            }
            
            playingData = {
              id: userId,
              startedAt: Date.now(),
              lastHeartbeat: Date.now()
            };
            await env.QUEUE.put(PLAYING_KEY, JSON.stringify(playingData));
            return jsonResponse({ ok: true, started: true });
          }
          
          // 내 차례 아님
          return jsonResponse({ 
            ok: false, 
            error: '차례가 아닙니다',
            position: position + 1
          }, 403);
        }
        
        // 다른 사람이 플레이 중
        return jsonResponse({ 
          ok: false, 
          error: '다른 플레이어가 진행 중입니다',
          position: queueData.findIndex(q => q.id === userId) + 1
        }, 403);
      }

      // ============================================
      // HEARTBEAT: 플레이 중임을 알림 (핵심!)
      // ============================================
      case 'heartbeat': {
        if (playingData?.id === userId) {
          playingData.lastHeartbeat = Date.now();
          await env.QUEUE.put(PLAYING_KEY, JSON.stringify(playingData));
          return jsonResponse({ ok: true, heartbeat: true });
        }
        return jsonResponse({ ok: false, error: '플레이 중이 아닙니다' }, 400);
      }

      // ============================================
      // END: 게임 종료
      // ============================================
      case 'end': {
        // 내가 플레이 중이면 해제
        if (playingData?.id === userId) {
          await env.QUEUE.delete(PLAYING_KEY);
        }
        
        // 대기열에서도 제거
        queueData = queueData.filter(q => q.id !== userId);
        await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));

        return jsonResponse({ ok: true, ended: true });
      }

      // ============================================
      // LEAVE: 대기열 나가기
      // ============================================
      case 'leave': {
        queueData = queueData.filter(q => q.id !== userId);
        await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));
        return jsonResponse({ ok: true, left: true });
      }

      // ============================================
      // FORCE_END: 강제 종료 (내 세션만)
      // ============================================
      case 'force_end': {
        // 내 ID로 된 플레이 상태 강제 해제
        if (playingData?.id === userId) {
          await env.QUEUE.delete(PLAYING_KEY);
        }
        // 대기열에서도 제거
        queueData = queueData.filter(q => q.id !== userId);
        await env.QUEUE.put(QUEUE_KEY, JSON.stringify(queueData));
        return jsonResponse({ ok: true, forceEnded: true });
      }

      default:
        return jsonResponse({ error: '알 수 없는 action' }, 400);
    }
  } catch (e) {
    console.error('Queue POST error:', e);
    return jsonResponse({ error: e.message }, 500);
  }
}

// 응답 헬퍼
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
