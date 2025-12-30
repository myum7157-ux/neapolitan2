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

    // IMPORTANT: env 값에 개행이 섞이는 경우가 많아서 trim
    const expectedPassword = String(env?.GAME_PASSWORD ?? '').trim();
    const sessionSecret = String(env?.SESSION_SECRET ?? '').trim();

    // env가 안 내려온 상태면 DENIED가 아니라 "서버 설정 문제"로 바로 드러내기
    if (!expectedPassword) {
      return new Response(
        JSON.stringify({
          error: 'SERVER_MISCONFIG',
          detail: 'GAME_PASSWORD is not set for this deployment environment.',
          // 값은 절대 노출 안 하고, 존재 여부만
          hasGamePassword: !!env?.GAME_PASSWORD,
          hasSessionSecret: !!env?.SESSION_SECRET,
        }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }

    if (!sessionSecret) {
      return new Response(
        JSON.stringify({
          error: 'SERVER_MISCONFIG',
          detail: 'SESSION_SECRET is not set for this deployment environment.',
          hasGamePassword: !!env?.GAME_PASSWORD,
          hasSessionSecret: !!env?.SESSION_SECRET,
        }),
        { status: 500, headers: { 'content-type': 'application/json' } }
      );
    }

    // 비밀번호 검증
    if (!providedPassword || providedPassword !== expectedPassword) {
      return new Response(JSON.stringify({ error: 'DENIED' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    // 세션 토큰 생성
    const ts = Date.now();
    const payload = `v1.${ts}`;
    const sig = await hmac(sessionSecret, payload);
    const token = `${payload}.${sig}`;

    const headers = new Headers({ 'content-type': 'application/json' });

    const isSecure = new URL(request.url).protocol === 'https:';
    const cookieFlags = [
      `nr_session=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=86400',
    ];
    if (isSecure) cookieFlags.push('Secure');

    headers.append('set-cookie', cookieFlags.join('; '));

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (e) {
    console.error('Login error:', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
