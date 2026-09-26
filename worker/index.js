// Cloudflare Worker: serves the app (app/, via the ASSETS binding) and the AI prep endpoint.
// The Anthropic key lives only here, as the ANTHROPIC_API_KEY secret. Limits and the model are
// set per environment in wrangler.toml.
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM, SCHEMA } from './prompt.js';

const MAX_BODY = 80_000;                 // bytes of statistics accepted per request
const CACHE_TTL = 30 * 24 * 3600;        // a plan for identical statistics is reused for 30 days
const USER = /^[a-z0-9_-]{2,30}$/;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ ai: !!env.ANTHROPIC_API_KEY });
    if (url.pathname === '/api/prep') {
      if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
      return prep(request, env, url);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    return env.ASSETS.fetch(request);
  },
};

async function prep(request, env, url) {
  // Browsers send Origin on POST: only the app's own pages may call this. (curl can still fake it;
  // the rate limits and the Anthropic workspace spend limit are what actually cap the cost.)
  if (request.headers.get('origin') !== url.origin) return json({ error: 'Forbidden.' }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'AI prep is not set up on this server.' }, 503);

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'Too much data.' }, 413);
  let data;
  try { data = JSON.parse(text); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!USER.test(data?.opp?.user || '') || !USER.test(data?.me?.user || '')) return json({ error: 'Missing players.' }, 400);

  const key = `plan:${env.MODEL}:${await sha256(text)}`;
  const hit = await env.PREP.get(key, 'json');
  if (hit) return json({ plan: hit, cached: true });

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!(await env.BURST.limit({ key: ip })).success) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);
  const day = new Date().toISOString().slice(0, 10);
  const [all, mine] = await Promise.all([count(env, `day:${day}`), count(env, `day:${day}:${ip}`)]);
  if (all >= +env.DAILY_LIMIT) return json({ error: 'The daily limit for AI prep is used up. Try again tomorrow.' }, 429);
  if (mine >= +env.PER_IP_DAILY) return json({ error: "You've reached today's limit for AI prep. Try again tomorrow." }, 429);
  await Promise.all([bump(env, `day:${day}`, all), bump(env, `day:${day}:${ip}`, mine)]);

  let msg;
  try {
    msg = await write(env, data);
  } catch (e) {
    console.error('anthropic', e?.status, e?.message);
    return json({ error: e?.status === 429 || e?.status === 529 ? 'The AI service is busy. Try again in a minute.' : 'The AI service failed. Try again later.' }, 502);
  }
  if (msg.stop_reason === 'refusal') return json({ error: 'The AI declined to write this plan.' }, 422);
  if (msg.stop_reason === 'max_tokens') return json({ error: 'The plan came out too long. Try again.' }, 502);
  let plan;
  try { plan = JSON.parse(msg.content.find((b) => b.type === 'text')?.text); } catch { return json({ error: 'The AI answer was malformed. Try again.' }, 502); }
  await env.PREP.put(key, JSON.stringify(plan), { expirationTtl: CACHE_TTL });
  console.log('plan', data.opp.user, env.MODEL, msg.usage?.input_tokens, msg.usage?.output_tokens);
  return json({ plan, cached: false });
}

function write(env, data) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const params = {
    model: env.MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `Write the prep file for ${data.me.user} against ${data.opp.name || data.opp.user}. Statistics:\n\n${JSON.stringify(data)}` }],
  };
  // FALLBACKS="default" re-runs a declined request on Anthropic's recommended fallback model.
  if (env.FALLBACKS) {
    return client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: env.FALLBACKS }).finalMessage();
  }
  return client.messages.stream(params).finalMessage();
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const count = async (env, k) => +(await env.PREP.get(k)) || 0;
const bump = (env, k, n) => env.PREP.put(k, String(n + 1), { expirationTtl: 2 * 24 * 3600 });
