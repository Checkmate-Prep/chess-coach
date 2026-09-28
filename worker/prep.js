// AI-written prep: turns a player's statistics into a plan with Claude.
//   POST /api/prep          the statistics -> { plan } when already written, else { job } and the writing starts
//   GET  /api/prep?job=<id> -> { plan }, { error } or { pending: true, progress }
// The writing runs in a Workflow (PrepWorkflow), not in the request, so it finishes and is cached even if
// the app is closed meanwhile; the app polls with GET, also after being reopened. While it writes, the
// Workflow saves its progress (stage, lines started, Claude's latest thought) to D1 for the app to show.
// The Anthropic key lives only here, as the ANTHROPIC_API_KEY secret. Limits and the model are
// set per environment in wrangler.toml.
import Anthropic from '@anthropic-ai/sdk';
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { json } from './http.js';
import { SYSTEM, SCHEMA } from './prompt.js';
import { lastSentences } from './thought.js';

const MAX_BODY = 80_000;                 // bytes of statistics accepted per request
const CACHE_TTL = 30 * 24 * 3600;        // a plan for identical statistics is reused for 30 days
const JOB_TTL = 3600;                    // how long identical statistics join the job already writing
const USER = /^[a-z0-9_-]{2,30}$/;
const JOB = /^[a-f0-9]{32}-[a-z0-9]{1,12}$/;
const RUNNING = ['queued', 'running', 'waiting', 'paused', 'waitingForPause'];
const PROGRESS_EVERY = 3000;             // ms between progress saves (D1 writes) while a plan streams

// Progress lives in D1, not KV: KV's free tier allows 1,000 writes a day, D1 100,000.
let ready;
const schema = (env) => (ready ||= env.DB.exec('CREATE TABLE IF NOT EXISTS prep_progress (job TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL)')
  .catch((e) => { ready = null; throw e; }));
async function saveProgress(env, job, json) {
  await schema(env);
  await env.DB.prepare('INSERT OR REPLACE INTO prep_progress (job, data, at) VALUES (?, ?, ?)').bind(job, json, Date.now()).run();
}
async function readProgress(env, job) {
  try { await schema(env); const row = await env.DB.prepare('SELECT data FROM prep_progress WHERE job = ?').bind(job).first(); return row ? JSON.parse(row.data) : undefined; } catch { return undefined; }
}
async function dropProgress(env, job) {
  try { await schema(env); await env.DB.prepare('DELETE FROM prep_progress WHERE job = ? OR at < ?').bind(job, Date.now() - 3600_000).run(); } catch { /* only progress */ }
}

export async function prep(request, env) {
  if (request.method === 'GET') return poll(new URL(request.url).searchParams.get('job'), env);
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const url = new URL(request.url);
  // Browsers send Origin on POST: only the app's own pages may call this. (curl can still fake it;
  // the rate limits and the Anthropic workspace spend limit are what actually cap the cost.)
  if (request.headers.get('origin') !== url.origin) return json({ error: 'Forbidden.' }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'AI prep is not set up on this server.' }, 503);

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'Too much data.' }, 413);
  let data;
  try { data = JSON.parse(text); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!USER.test(data?.opp?.user || '') || !USER.test(data?.me?.user || '')) return json({ error: 'Missing players.' }, 400);

  const hash = await sha256(`${env.MODEL}\n${text}`);
  const key = `plan:${env.MODEL}:${hash}`;
  const hit = await env.PREP.get(key, 'json');
  if (hit) return json({ plan: hit, cached: true });

  // The same statistics already being written (a second tap, or the app reopened): join that job for free.
  const running = await env.PREP.get(`job:${hash}`);
  if (running && RUNNING.includes(await jobStatus(env, running))) return json({ job: running }, 202);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!(await env.AI_BURST.limit({ key: ip })).success) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429);
  const day = new Date().toISOString().slice(0, 10);
  const [all, mine] = await Promise.all([count(env, `day:${day}`), count(env, `day:${day}:${ip}`)]);
  if (all >= +env.DAILY_LIMIT) return json({ error: 'The daily limit for AI prep is used up. Try again tomorrow.' }, 429);
  if (mine >= +env.PER_IP_DAILY) return json({ error: "You've reached today's limit for AI prep. Try again tomorrow." }, 429);
  await Promise.all([bump(env, `day:${day}`, all), bump(env, `day:${day}:${ip}`, mine)]);

  const job = `${hash.slice(0, 32)}-${Date.now().toString(36)}`;
  await env.PREP_JOBS.create({ id: job, params: { data, key, job } });
  await env.PREP.put(`job:${hash}`, job, { expirationTtl: JOB_TTL });
  return json({ job }, 202);
}

async function poll(job, env) {
  if (!JOB.test(job || '')) return json({ error: 'Unknown job.' }, 400);
  let s;
  try { s = await (await env.PREP_JOBS.get(job)).status(); } catch { return json({ error: 'This plan was lost. Try again.' }, 404); }
  if (s.status === 'complete') return s.output?.plan ? json({ plan: s.output.plan }) : json({ error: s.output?.error || 'The AI service failed. Try again later.' });
  if (RUNNING.includes(s.status)) return json({ pending: true, progress: await readProgress(env, job) });
  console.error('prep job', job, s.status, s.error);
  return json({ error: 'The AI service failed. Try again later.' });
}

async function jobStatus(env, job) {
  try { return (await (await env.PREP_JOBS.get(job)).status()).status; } catch { return 'unknown'; }
}

export class PrepWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { data, key, job } = event.payload;
    // A busy or failing API is retried; an answer that can't become a plan ends the job with an error.
    const out = await step.do('write', { retries: { limit: 2, delay: '20 seconds', backoff: 'exponential' }, timeout: '15 minutes' }, async () => {
      let msg;
      try {
        msg = await write(this.env, data, job);
      } catch (e) {
        console.error('anthropic', e?.status, e?.message);
        if (e?.status === 400 || e?.status === 401 || e?.status === 403) return { error: 'The AI service failed. Try again later.' };
        throw e;
      }
      if (msg.stop_reason === 'refusal') return { error: 'The AI declined to write this plan.' };
      if (msg.stop_reason === 'max_tokens') {
        console.error('max_tokens', data.opp.user, this.env.MODEL, msg.usage?.input_tokens, msg.usage?.output_tokens);
        return { error: 'Claude ran out of room while writing the plan. Try again.' };
      }
      try {
        const plan = JSON.parse(msg.content.find((b) => b.type === 'text')?.text);
        console.log('plan', data.opp.user, this.env.MODEL, msg.usage?.input_tokens, msg.usage?.output_tokens);
        return { plan };
      } catch { return { error: 'The AI answer was malformed. Try again.' }; }
    }).catch(() => ({ error: 'The AI service is busy. Try again in a few minutes.' }));
    if (out.plan) await step.do('cache', () => this.env.PREP.put(key, JSON.stringify(out.plan), { expirationTtl: CACHE_TTL }));
    if (job) await dropProgress(this.env, job);
    return out;
  }
}

function write(env, data, job) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });
  const params = {
    model: env.MODEL,
    // Sonnet 5 and Opus 5 think by default (adaptive, effort high), and the hidden thinking counts toward
    // max_tokens: 16000 ran out before the plan was written. Streaming allows this much without timeouts.
    max_tokens: 64000,
    // Thinking as before; summarized makes its summaries readable, so the app can show what Claude considers.
    thinking: { type: 'adaptive', display: 'summarized' },
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `Write the prep file for ${data.me.user} against ${data.opp.name || data.opp.user}. Statistics:\n\n${JSON.stringify(data)}` }],
  };
  // FALLBACKS="default" re-runs a declined request on Anthropic's recommended fallback model.
  const stream = env.FALLBACKS
    ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: env.FALLBACKS })
    : client.messages.stream(params);
  if (job) followProgress(env, job, stream);
  return stream.finalMessage();
}

/** Save what the stream shows (stage, latest thought, lines started) to D1, at most every few seconds. */
function followProgress(env, job, stream) {
  const p = { stage: 'reading' };
  // One write at a time; a newer state waiting behind it replaces any older one, so a stage change is never lost.
  let last = 0, saving = false, queued = null;
  const flush = () => {
    const json = queued;
    queued = null;
    saving = true;
    saveProgress(env, job, json).catch((e) => console.error('progress', e?.message))
      .finally(() => { saving = false; if (queued) flush(); });
  };
  const save = (force) => {
    if (!force && Date.now() - last < PROGRESS_EVERY) return;
    last = Date.now();
    queued = JSON.stringify(p);
    if (!saving) flush();
  };
  stream.on('thinking', (_, snapshot) => {
    const thought = lastSentences(snapshot);
    const changed = p.stage !== 'thinking';
    p.stage = 'thinking';
    if (thought) p.thought = thought;
    save(changed);
  });
  stream.on('text', (_, snapshot) => {
    const changed = p.stage !== 'writing';
    p.stage = 'writing';
    p.plans = (snapshot.match(/"you_play"/g) || []).length;
    p.section = snapshot.includes('"checklist"') ? 'checklist' : snapshot.includes('"weak"') ? 'weak' : 'plans';
    save(changed);
  });
  save(true);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const count = async (env, k) => +(await env.PREP.get(k)) || 0;
const bump = (env, k, n) => env.PREP.put(k, String(n + 1), { expirationTtl: 2 * 24 * 3600 });
