export async function onRequestGet({ env }) {
  const out = {
    hasGamePassword: !!(env && env.GAME_PASSWORD && String(env.GAME_PASSWORD).trim().length > 0),
    hasSessionSecret: !!(env && env.SESSION_SECRET && String(env.SESSION_SECRET).trim().length > 0),
    // 값은 절대 노출 안 함. 존재 여부만.
  };

  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
