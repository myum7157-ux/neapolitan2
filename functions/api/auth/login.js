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

export async function onRequestPost({ request, env }) {
  try {
    // Parse request body
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON' }),
        { 
          status: 400,
          headers: { 'content-type': 'application/json' }
        }
      );
    }

    const { password } = body;

    // Check environment variables
    const expectedPassword = env.GAME_PASSWORD || '';
    const sessionSecret = env.SESSION_SECRET || 'dev_secret_change_me';

    // Validate password
    if (!password || password !== expectedPassword) {
      return new Response(
        JSON.stringify({ error: 'DENIED' }),
        { 
          status: 401,
          headers: { 'content-type': 'application/json' }
        }
      );
    }

    // Create session token
    const ts = Date.now();
    const payload = `v1.${ts}`;
    const sig = await hmac(sessionSecret, payload);
    const token = `${payload}.${sig}`;

    // Set cookie with appropriate flags
    const headers = new Headers({ 'content-type': 'application/json' });
    
    // Use Secure flag only in production
    const isSecure = new URL(request.url).protocol === 'https:';
    const cookieFlags = [
      `nr_session=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=86400'
    ];
    
    if (isSecure) {
      cookieFlags.push('Secure');
    }
    
    headers.append('set-cookie', cookieFlags.join('; '));

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers }
    );

  } catch (error) {
    console.error('Login error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500,
        headers: { 'content-type': 'application/json' }
      }
    );
  }
}
