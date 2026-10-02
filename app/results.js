// Keeps this device's analysis results on the account (worker/results.js), so another device picks them up
// instead of redoing them. What an item is and how copies merge: resultsdoc.js. Runs as part of sync.js's
// syncNow, only when signed in.
// localStorage: `results-dirty` = {player: {item: stamp}} waiting to upload; `results-at` = server time of the last pull.
import { idb, ls } from './store.js';
import { apply, idbKey, itemsOf } from './resultsdoc.js';

const BATCH = 800_000;                   // characters per upload
const BATCH_ITEMS = 200;
const OVERLAP = 60_000;                  // re-ask for a minute before the last pull: a write can land during a pull
const WAIT = 20_000;                     // most time analysis waits for a pull

/** Note that an item changed here and should be uploaded. */
export function markDirty(player, item) {
  const d = ls.get('results-dirty', {});
  (d[player] ||= {})[item] = Date.now() + Math.random();
  ls.set('results-dirty', d);
}

// Analysis waits for the pull that follows a sign-in, so a new device finds the reviews instead of redoing them.
let ready = Promise.resolve(), release = null;
/** A sync is starting: results that might arrive should be waited for. */
export function expectPull() {
  if (release) return;
  ready = new Promise((r) => { release = () => { release = null; r(); }; });
}
/** The sync ended (maybe before reaching the pull): stop waiting. */
export const endPull = () => release?.();
/** Resolves once the pull in progress (if any) is done, or after WAIT at most. */
export const resultsReady = () => Promise.race([ready, new Promise((r) => setTimeout(r, WAIT))]);

/** Mark every result this device holds for these players (first sync on a device: upload earlier work). */
async function markAll(players) {
  const d = ls.get('results-dirty', {});
  for (const p of players) {
    for (const key of [`review:${p}`, `traps:${p}:white`, `traps:${p}:black`, `aiprep:${p}`]) {
      for (const item of itemsOf(key, await idb.get(key))) (d[p] ||= {})[item] ??= 1;
    }
  }
  ls.set('results-dirty', d);
}

/** Merge pulled items into IndexedDB, one read and write per key. Returns the players whose data changed. */
async function merge(items) {
  const byKey = new Map();
  for (const it of items) {
    const k = idbKey(it.player, it.item);
    if (!byKey.has(k)) byKey.set(k, { player: it.player, items: [] });
    byKey.get(k).items.push(it);
  }
  const changed = new Set();
  for (const [k, { player, items: list }] of byKey) {
    let value = await idb.get(k), dirty = false;
    for (const it of list) {
      const next = apply(value, it.item, it.data);
      if (next) { value = next; dirty = true; }
    }
    if (dirty) { await idb.set(k, value); changed.add(player); }
  }
  return changed;
}

/** Upload what's marked, in batches; entries marked again meanwhile stay for the next sync. */
async function push(headers) {
  const d = ls.get('results-dirty', {});
  const todo = [];
  const cache = new Map();
  for (const [player, items] of Object.entries(d)) {
    for (const [item, stamp] of Object.entries(items)) {
      const k = idbKey(player, item);
      if (!cache.has(k)) cache.set(k, await idb.get(k));
      const v = cache.get(k);
      const data = item.startsWith('review:') ? v?.[item.slice(7)] : v;
      todo.push({ player, item, stamp, data });
    }
  }
  const sent = [];
  let batch = [], size = 0;
  const send = async () => {
    if (!batch.length) return;
    const r = await fetch('api/results', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ items: batch.map(({ player, item, data }) => ({ player, item, data })) }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `The server answered ${r.status}.`);
    sent.push(...batch); // saved, or refused as invalid (sending it again wouldn't help)
    batch = []; size = 0;
  };
  for (const t of todo) {
    if (!t.data) { sent.push(t); continue; } // gone from this device: nothing to send
    const n = JSON.stringify(t.data).length;
    if (batch.length && (size + n > BATCH || batch.length >= BATCH_ITEMS)) await send();
    batch.push(t); size += n;
  }
  await send();
  if (!sent.length) return;
  const now = ls.get('results-dirty', {});
  for (const t of sent) if (now[t.player]?.[t.item] === t.stamp) delete now[t.player][t.item];
  for (const p of Object.keys(now)) if (!Object.keys(now[p]).length) delete now[p];
  ls.set('results-dirty', now);
}

/**
 * Pull what other devices saved since the last time, merge it here, then upload what's marked.
 * `players`: me and the opponents (for the first sync on a device). Resolves to the players whose results changed.
 */
export async function syncResults(token, players) {
  const headers = { authorization: `Bearer ${token}` };
  let changed = new Set();
  try {
    const last = ls.get('results-at', 0);
    if (!last) await markAll(players);
    let since = Math.max(0, last - OVERLAP), at;
    for (;;) {
      const r = await fetch(`api/results?since=${since}`, { headers });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || `The server answered ${r.status}.`);
      changed = new Set([...changed, ...(await merge(out.items || []))]);
      at = out.at;
      if (!out.more || out.at === since) break; // (the same page again would never end)
      since = out.at;
    }
    ls.set('results-at', at);
  } finally { endPull(); }
  await push(headers);
  return [...changed];
}
