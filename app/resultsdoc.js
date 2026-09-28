// Analysis results kept per account, shared by the app (results.js) and the Worker (worker/results.js).
// Games are rebuilt from the shared game store; what the device computed from them is kept here so another
// device doesn't redo it: Stockfish's review of each game, the trap scans and Claude's plan.
//
// One item per result, stored exactly as the app keeps it in IndexedDB:
//   'review:<game url>'   one game's review (analysis.js reviewGame)  -> IndexedDB review:<player> = {url: review}
//   'traps:white|black'   one trap scan (analysis.js findTraps)       -> IndexedDB traps:<player>:<color>
//   'aiprep'              Claude's plan (app.js saveAi)               -> IndexedDB aiprep:<player>
// `rankOf` says which of two copies wins: a review never changes (the first copy stays), the trap scan of more
// games wins, the newest plan wins.

export const USER = /^[a-z0-9_-]{2,30}$/;
const GAME = /^https:\/\/www\.chess\.com\/game\/(live|daily)\/[a-z0-9]{1,24}$/;
const ITEM = /^(review:.+|traps:(white|black)|aiprep)$/;
export const MAX_ITEM = 60_000;            // characters of JSON per item

export const isItem = (item) => typeof item === 'string' && ITEM.test(item) && (!item.startsWith('review:') || GAME.test(item.slice(7)));

/** The IndexedDB key that holds an item. */
export function idbKey(player, item) {
  if (item.startsWith('review:')) return `review:${player}`;
  if (item.startsWith('traps:')) return `traps:${player}:${item.slice(6)}`;
  return `aiprep:${player}`;
}

/** Which copy wins (the higher rank). */
export const rankOf = (item, data) => (item.startsWith('traps:') ? data.n : item === 'aiprep' ? data.at : 0);

/** Validate an item from outside (the network): a clean copy with only known fields, or throws. */
export function clean(item, data) {
  const bad = (why) => { throw new Error(`Invalid result: ${why}.`); };
  if (!isItem(item)) bad('item');
  if (!data || typeof data !== 'object' || Array.isArray(data)) bad('data');
  const num = (x) => (Number.isFinite(x) ? x : bad('number'));
  const int = (x) => (Number.isInteger(x) && x >= 0 ? x : bad('count'));
  const str = (s, max = 100) => (typeof s === 'string' && s.length <= max ? s : bad('text'));
  const opt = (s, max) => (s == null ? null : str(s, max));
  const list = (a, max, fn) => (Array.isArray(a) && a.length <= max ? a.map(fn) : bad('list'));
  let out;
  if (item.startsWith('review:')) {
    const n = Array.isArray(data.loss) ? data.loss.length : bad('review');
    const nums = (a) => (Array.isArray(a) && a.length === n ? list(a, 600, num) : bad('review'));
    out = {
      loss: nums(data.loss), pieces: nums(data.pieces), evals: nums(data.evals),
      bad: list(data.bad, 150, (b) => ({
        ply: int(b?.ply), fen: str(b.fen), played: str(b.played, 10), loss: num(b.loss), before: num(b.before), after: num(b.after),
        best: opt(b.best, 10), line: list(b.line || [], 6, (m) => str(m, 10)), bestUci: null,
      })),
    };
  } else if (item.startsWith('traps:')) {
    out = {
      n: int(data.n), ...(data.checked != null ? { checked: int(data.checked) } : {}),
      traps: list(data.traps, 8, (t) => ({
        path: list(t?.path, 30, (m) => str(m, 10)), san: str(t.san, 10), times: int(t.times), of: int(t.of), score: num(t.score),
        fen: str(t.fen), afterFen: str(t.afterFen), played: str(t.played, 10), bestForHim: opt(t.bestForHim, 10),
        before: num(t.before), after: num(t.after), drop: num(t.drop), punish: list(t.punish || [], 6, (m) => str(m, 10)),
      })),
    };
  } else {
    const p = data.plan;
    if (!p || typeof p !== 'object') bad('plan');
    const text = (s) => str(s, 4000);
    out = {
      plan: {
        summary: text(p.summary),
        plans: list(p.plans, 12, (x) => ({
          you_play: x?.you_play === 'white' || x?.you_play === 'black' ? x.you_play : bad('colour'),
          eyebrow: text(x.eyebrow), title: text(x.title), line: text(x.line), key_from: int(x.key_from),
          body: list(x.body, 12, text), caption: text(x.caption),
        })),
        weak: list(p.weak, 12, text), checklist: list(p.checklist, 12, text),
      },
      at: int(data.at), games: int(data.games ?? 0),
    };
  }
  if (JSON.stringify(out).length > MAX_ITEM) bad('too big');
  return out;
}

/**
 * Merge an item into the value IndexedDB holds for its key. Returns the new value, or null when nothing changes
 * (the local copy wins or is the same).
 */
export function apply(local, item, data) {
  if (item.startsWith('review:')) {
    const url = item.slice(7);
    return local?.[url] ? null : { ...(local || {}), [url]: data };
  }
  return !local || rankOf(item, data) > rankOf(item, local) ? data : null;
}

/** The items held in one IndexedDB value (the reverse of apply), for uploading what a device has. */
export function itemsOf(key, value) {
  if (!value) return [];
  if (key.startsWith('review:')) return Object.keys(value).map((url) => `review:${url}`);
  if (key.startsWith('traps:')) return [`traps:${key.split(':')[2]}`];
  return ['aiprep'];
}
