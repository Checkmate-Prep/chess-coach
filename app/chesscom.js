// chess.com public API (CORS-enabled, no login needed).
import { idb } from './store.js';

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

function compact(g, user) {
  const color = g.white.username.toLowerCase() === user ? 'white' : 'black';
  const me = g[color], opp = g[color === 'white' ? 'black' : 'white'];
  const eco = (g.eco || '').split('/').pop().replace(/-\d.*$/, '').replace(/-/g, ' ');
  return {
    url: g.url, t: g.end_time, tc: g.time_class, base: +(g.time_control.split('+')[0]) || null, color,
    rating: me.rating, opp: opp.username, oppR: opp.rating,
    pts: me.result === 'win' ? 2 : DRAWS.has(me.result) ? 1 : 0,
    how: me.result === 'win' ? opp.result : me.result,
    eco: eco.split(' ').slice(0, 3).join(' '),
    sans: sansOf(g.pgn), clk: clocksOf(g.pgn),
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
 * Download games newest-first (up to MAX_MONTHS / MAX_GAMES), merging with what is cached.
 * Months already complete in the cache are not fetched again.
 */
export async function syncGames(user, onProgress = () => {}) {
  user = user.toLowerCase();
  const cached = (await idb.get(`games:${user}`)) || { months: {}, games: [] };
  const { archives } = await getJSON(`${API}${user}/games/archives`);
  const recent = archives.slice(-MAX_MONTHS).reverse();
  const nowKey = new Date().toISOString().slice(0, 7).replace('-', '/');
  let byUrl = new Map(cached.games.map((g) => [g.url, g]));
  let i = 0;
  for (const url of recent) {
    const month = url.split('/').slice(-2).join('/');
    onProgress(++i, recent.length);
    if (cached.months[month] && month !== nowKey) continue;
    const { games } = await getJSON(url);
    for (const g of games) if (g.rules === 'chess' && g.pgn) byUrl.set(g.url, compact(g, user));
    cached.months[month] = true;
    if (byUrl.size >= MAX_GAMES) break;
  }
  const games = [...byUrl.values()].sort((a, b) => b.t - a.t).slice(0, MAX_GAMES);
  const out = { months: cached.months, games, fetched: Date.now() };
  await idb.set(`games:${user}`, out);
  return out;
}

export const cachedGames = (user) => idb.get(`games:${user.toLowerCase()}`);
