export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Public paths that don't require authentication
  const publicPaths = [
    '/',
    '/index.html',
    '/favicon.ico',
  ];

  const publicPrefixes = [
    '/styles/',
    '/assets/',
    '/data/',
    '/src/',
    '/api/auth/',
  ];

  // Check if path is public
  const isPublic = publicPaths.includes(path) || 
    publicPrefixes.some(prefix => path.startsWith(prefix));

  if (isPublic) {
    return next();
  }

  // Check for session cookie
  const cookie = request.headers.get('cookie') || '';
  const sessionMatch = cookie.match(/nr_session=([^;]+)/);
  
  if (!sessionMatch) {
    // Redirect to login instead of showing FORBIDDEN
    return Response.redirect(url.origin + '/', 302);
  }

  // Optional: Verify session signature here
  // For now, just check if cookie exists

  return next();
}
