// Which pages other than our own may call /api. The iOS app (Capacitor) runs its pages from
// capacitor://localhost and calls https://checkmateprep.com/api. Nothing else is allowed: no wildcard,
// no other origin. Every endpoint still checks the account token or applies the rate limits as before.
export const APP_ORIGINS = ['capacitor://localhost'];

/** Is this Origin header the Worker's own address or the native app? (null/absent -> false) */
export const allowedOrigin = (origin, own) => !!origin && (origin === own || APP_ORIGINS.includes(origin));

const PREFLIGHT = {
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

/** Runs an /api handler and adds CORS headers when the caller is the native app; answers its preflight. */
export async function withCors(request, handle) {
  const origin = request.headers.get('origin');
  const app = APP_ORIGINS.includes(origin);
  if (request.method === 'OPTIONS') {
    // A preflight from anyone else gets no CORS headers, so the browser blocks the real request.
    return new Response(null, { status: 204, headers: app ? { ...PREFLIGHT, 'access-control-allow-origin': origin, vary: 'origin' } : {} });
  }
  const res = await handle();
  const out = new Response(res.body, res);
  out.headers.append('vary', 'origin');
  if (app) out.headers.set('access-control-allow-origin', origin);
  return out;
}
