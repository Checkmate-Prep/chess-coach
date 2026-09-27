// Cloudflare Worker: serves the app (app/, via the ASSETS binding) and the /api endpoints.
// Settings per environment are in wrangler.toml.
import { json } from './http.js';
import { sync } from './sync.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // What this server offers. The app hides accounts when this is missing (GitHub Pages, a static server).
    if (url.pathname === '/api/config') {
      const auth = env.AUTH0_DOMAIN && env.AUTH0_CLIENT_ID && env.AUTH0_AUDIENCE
        ? { domain: env.AUTH0_DOMAIN, clientId: env.AUTH0_CLIENT_ID, audience: env.AUTH0_AUDIENCE } : null;
      return json({ auth });
    }
    if (url.pathname === '/api/sync') return sync(request, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    return env.ASSETS.fetch(request);
  },
};
