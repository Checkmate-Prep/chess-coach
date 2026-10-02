// Cloudflare Worker: serves the app (app/, via the ASSETS binding) and the /api endpoints.
// Settings per environment are in wrangler.toml.
import { json } from './http.js';
import { sync } from './sync.js';
import { event } from './events.js';
import { userOf } from './auth.js';
import { prep } from './prep.js';
import { games } from './games.js';
import { results } from './results.js';

export { PrepWorkflow } from './prep.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // One address per app, so one set of local data per user: www.checkmateprep.com -> checkmateprep.com.
    if (url.hostname.startsWith('www.')) { url.hostname = url.hostname.slice(4); return Response.redirect(url.href, 301); }
    // What this server offers. The app hides accounts when this is missing (GitHub Pages, a static server).
    if (url.pathname === '/api/config') {
      const auth = env.AUTH0_DOMAIN && env.AUTH0_CLIENT_ID && env.AUTH0_AUDIENCE
        ? { domain: env.AUTH0_DOMAIN, clientId: env.AUTH0_CLIENT_ID, audience: env.AUTH0_AUDIENCE } : null;
      return json({ auth });
    }
    if (url.pathname === '/api/health') return json({ ai: !!env.ANTHROPIC_API_KEY });
    if (url.pathname === '/api/prep') return prep(request, env);
    if (url.pathname === '/api/sync') return sync(request, env);
    if (url.pathname === '/api/results') return results(request, env, userOf);
    if (url.pathname === '/api/games') return games(request, env);
    if (url.pathname === '/api/event') return event(request, env, userOf);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    return env.ASSETS.fetch(request);
  },
};
