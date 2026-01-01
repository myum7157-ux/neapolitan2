// functions/api/auth/login.js
// 안정적인 사용자 ID 시스템 추가

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function hmac(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return b64url(sig);
}

// 랜덤 ID 생성
function generateUID() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

// 기존 nr_uid 쿠키 추출
function getExistingUID(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/nr_uid=([^;]+)/);
  return match ? match[1] : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const providedPassword = String(body?.password ?? '').trim();
    const expectedPassword = String(env?.GAME_PASSWORD ?? '').trim();
    const sessionSecret = String(env?.SESSION_SECRET ?? '').trim();

    if (!expectedPassword) {
      return new Response(
        JSON.stringify({
          error: 'SERVER_MISCONFIG',
          detail: 'GAME_PASSWORD is not set',
        }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }

    if (!sessionSecret) {
      return new Response(
        JSON.stringify({
          error: 'SERVER_MISCONFIG',
          detail: 'SESSION_SECRET is not set',
        }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }

    if (!providedPassword || providedPassword !== expectedPassword) {
      return new Response(JSON.stringify({ error: 'DENIED' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    // ============================================
    // 핵심 변경: 안정적인 사용자 ID (nr_uid)
    // ============================================
    // 1. 기존 nr_uid가 있으면 재사용 (같은 브라우저 = 같은 ID)
    // 2. 없으면 새로 생성
    let uid = getExistingUID(request);
    const isNewUser = !uid;
    
    if (!uid) {
      uid = generateUID();
    }

    // 세션 토큰 생성 (기존 방식 유지, 하지만 ID로는 사용 안 함)
    const ts = Date.now();
    const payload = `v1.${ts}`;
    const sig = await hmac(sessionSecret, payload);
    const token = `${payload}.${sig}`;

    const headers = new Headers({ 'content-type': 'application/json' });
    const isSecure = new URL(request.url).protocol === 'https:';

    // 세션 쿠키 (24시간)
    const sessionFlags = [
      `nr_session=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=86400',
    ];
    if (isSecure) sessionFlags.push('Secure');
    headers.append('set-cookie', sessionFlags.join('; '));

    // 사용자 ID 쿠키 (30일, 안정적인 ID)
    const uidFlags = [
      `nr_uid=${uid}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=2592000', // 30일
    ];
    if (isSecure) uidFlags.push('Secure');
    headers.append('set-cookie', uidFlags.join('; '));

    return new Response(JSON.stringify({ ok: true, isNewUser }), { status: 200, headers });
  } catch (e) {
    console.error('Login error:', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
