// chess.com public API (CORS-enabled, no login needed).
import { idb, ls } from './store.js';

const API = 'https://api.chess.com/pub/player/';
const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
const MAX_GAMES = 1500;   // newest games kept per player
const MAX_MONTHS = 12;

async function getJSON(url) {
  const r = await fetch(url);
  if (r.status === 404) throw Object.assign(new Error('not found'), { code: 404 });
  if (!r.ok) throw new Error(`chess.com answered ${r.status}`);
  return r.json();
}

export function sansOf(pgn) {
  const text = pgn.split('\n\n').slice(1).join(' ').replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ');
  return text.split(/\s+/).filter((t) => t && !/^(\d+\.+|1-0|0-1|1\/2-1\/2|\*|\$\d+)$/.test(t));
}

function clocksOf(pgn) {
  return [...pgn.matchAll(/\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/g)].map((m) => +m[1] * 3600 + +m[2] * 60 + +m[3]);
}

/**
 * A chess.com game as stored (here and in the Worker's shared game store): from neither player's side, no PGN.
 * null for games the app doesn't use (variants, no moves).
 */
export function neutral(g) {
  if (g.rules !== 'chess' || !g.pgn) return null;
  const eco = (g.eco || '').split('/').pop().replace(/-\d.*$/, '').replace(/-/g, ' ');
  const side = (s) => ({ u: s.username, r: s.rating, res: s.result });
  return {
    url: g.url, t: g.end_time, tc: g.time_class, base: +(String(g.time_control).split('+')[0]) || null,
    eco: eco.split(' ').slice(0, 3).join(' '), white: side(g.white), black: side(g.black),
    sans: sansOf(g.pgn), clk: clocksOf(g.pgn),
  };
}

/** A stored game from `user`'s side: the compact record the app keeps in `games:<user>`. */
export function side(n, user) {
  const color = n.white.u.toLowerCase() === user ? 'white' : 'black';
  const me = n[color], opp = n[color === 'white' ? 'black' : 'white'];
  return {
    url: n.url, t: n.t, tc: n.tc, base: n.base, color,
    rating: me.r, opp: opp.u, oppR: opp.r,
    pts: me.res === 'win' ? 2 : DRAWS.has(me.res) ? 1 : 0,
    how: me.res === 'win' ? opp.res : me.res,
    eco: n.eco, sans: n.sans, clk: n.clk,
  };
}

/** Profile + ratings; throws {code:404} for unknown usernames. */
export async function player(user) {
  user = user.trim().toLowerCase();
  const [profile, stats] = await Promise.all([getJSON(API + user), getJSON(`${API}${user}/stats`).catch(() => ({}))]);
  const ratings = {};
  for (const tc of ['bullet', 'blitz', 'rapid', 'daily']) {
    const s = stats[`chess_${tc}`];
    if (s?.last) ratings[tc] = { r: s.last.rating, w: s.record?.win || 0, l: s.record?.loss || 0, d: s.record?.draw || 0 };
  }
  return { user, name: profile.name || profile.username, username: profile.username, avatar: profile.avatar || null, ratings };
}

/**
 * Look up players and save each as `player:<user>`. Resolves to how many were saved: 0 when chess.com
 * can't be reached, so callers can skip a redraw that would only start the same lookups again.
 */
export async function savePlayers(users) {
  const ok = await Promise.all(users.map((u) => player(u).then((info) => { ls.set(`player:${u}`, info); return true; }).catch(() => false)));
  return ok.filter(Boolean).length;
}

/** Start of the month after 'YYYY/MM', in UTC milliseconds. */
export const monthEnd = (month) => { const [y, m] = month.split('/'); return Date.UTC(+y, +m, 1); };

// The Worker's shared game store (worker/games.js), used when the app is served by the Worker: it answers
// like chess.com, from a copy shared by every user. Any failure falls back to chess.com itself.
let viaApi = false;
/** Turn the game store on or off (on once /api answered, see sync.js `hasApi`). */
export const useGameStore = (on) => { viaApi = !!on; };
const STORE_API = 'api/games?player=';

/** The player's archive months ('YYYY/MM', oldest first), and whether they came from the game store. */
async function archivesOf(user) {
  if (viaApi) {
    try { return { months: (await getJSON(STORE_API + encodeURIComponent(user))).archives, store: true }; } catch { /* chess.com below */ }
  }
  const { archives } = await getJSON(`${API}${user}/games/archives`);
  return { months: archives.map((u) => u.split('/').slice(-2).join('/')), store: false };
}
/** One month of games, as stored games (neutral). */
async function monthOf(user, month, store) {
  if (store) {
    try { return (await getJSON(`${STORE_API}${encodeURIComponent(user)}&month=${month}`)).games; } catch { /* chess.com below */ }
  }
  const { games } = await getJSON(`${API}${user}/games/${month}`);
  return games.map(neutral).filter(Boolean);
}

/**
 * Download games newest-first (up to MAX_MONTHS / MAX_GAMES), merging with what is cached.
 * Months already complete in the cache are not fetched again.
 */
export async function syncGames(user, onProgress = () => {}) {
  user = user.toLowerCase();
  const cached = (await idb.get(`games:${user}`)) || { months: {}, games: [] };
  const { months, store } = await archivesOf(user);
  const recent = months.slice(-MAX_MONTHS).reverse();
  let byUrl = new Map(cached.games.map((g) => [g.url, g]));
  let i = 0;
  for (const month of recent) {
    onProgress(++i, recent.length);
    // A month is complete once it was fetched after it ended (UTC, like chess.com's archives).
    // Old caches store `true`, which compares as 1, so those months are fetched once more.
    if (cached.months[month] >= monthEnd(month)) continue;
    for (const n of await monthOf(user, month, store)) byUrl.set(n.url, side(n, user));
    cached.months[month] = Date.now();
    if (byUrl.size >= MAX_GAMES) break;
  }
  const games = [...byUrl.values()].sort((a, b) => b.t - a.t).slice(0, MAX_GAMES);
  const out = { months: cached.months, games, fetched: Date.now() };
  await idb.set(`games:${user}`, out);
  return out;
}

export const cachedGames = (user) => idb.get(`games:${user.toLowerCase()}`);
