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

    const normalize = (value) => {
      if (value == null) return '';
      return (typeof value === 'string' ? value : String(value)).trim();
    };
    const { password } = body;

    // Check environment variables
    const expectedPassword = normalize(env.GAME_PASSWORD);
    const sessionSecret = normalize(env.SESSION_SECRET) || 'dev_secret_change_me';

    if (!expectedPassword) {
      return new Response(
        JSON.stringify({ 
          error: 'CONFIG_MISSING', 
          message: 'GAME_PASSWORD is not configured. Set the environment variable and redeploy.' 
        }),
        { 
          status: 500,
          headers: { 'content-type': 'application/json' }
        }
      );
    }

    // Validate password
    const providedPassword = normalize(password);
    if (!providedPassword) {
      return new Response(
        JSON.stringify({ 
          error: 'MISSING_PASSWORD', 
          message: 'Password is required' 
        }),
        { 
          status: 400,
          headers: { 'content-type': 'application/json' }
        }
      );
    }

    if (providedPassword !== expectedPassword) {
      return new Response(
        JSON.stringify({ 
          error: 'INVALID_PASSWORD',
          message: 'Password is incorrect. Check GAME_PASSWORD in Cloudflare settings and redeploy.' 
        }),
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
