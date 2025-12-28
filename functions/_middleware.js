export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  const isPublic = (path === '/' || path === '/index.html' || path.startsWith('/styles/') || path.startsWith('/favicon') || path.startsWith('/api/auth/'));
  if (isPublic) return next();

  const cookie = request.headers.get('cookie') || '';
  const hasSession = cookie.includes('nr_session=');

  // Protect everything else (including /assets, /data, /src, /play.html)
  if (!hasSession) {
    return new Response('FORBIDDEN', { status: 403 });
  }

  return next();
}
