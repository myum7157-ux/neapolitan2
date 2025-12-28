function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function hmac(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return b64url(sig);
}

export async function onRequestPost({ request, env }) {
  const { password } = await request.json().catch(()=>({}));
  const expected = env.GAME_PASSWORD || '';
  if (!password || password !== expected) return new Response('DENIED', { status: 401 });

  const ts = Date.now();
  const payload = `v1.${ts}`;
  const sig = await hmac(env.SESSION_SECRET || 'dev_secret_change_me', payload);
  const token = `${payload}.${sig}`;

  const headers = new Headers({ 'content-type':'application/json' });
  headers.append('set-cookie', `nr_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
  return new Response(JSON.stringify({ ok:true }), { status: 200, headers });
}
