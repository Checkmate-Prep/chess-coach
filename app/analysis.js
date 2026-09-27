// Engine-backed analysis on the device: game review, repeated-mistake (trap) finder, puzzle generation.
import { Chess } from './vendor/chess.js';
import { analyseSafe } from './engine.js';
import { idb } from './store.js';
import { walk } from './stats.js';

export const BLUNDER = 20, MISTAKE = 10;       // win-probability points lost
const GAME_NODES = 20000, TRAP_NODES = 50000;

export const winProb = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
const uciToSan = (fen, uci) => {
  if (!uci) return null;
  try { return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; } catch { return null; }
};
export function pvToSan(fen, pv, max = 6) {
  const g = new Chess(fen), out = [];
  for (const u of pv.slice(0, max)) {
    try { out.push(g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; }
  }
  return out;
}

// ---------- game review ----------
/** Evaluate every move of one game. Returns compact per-move arrays plus detail for bad moves. */
async function reviewGame(g) {
  const board = new Chess();
  const loss = [], pieces = [], evals = [], bad = [];
  let info = await analyseSafe(board.fen(), GAME_NODES);
  for (let i = 0; i < g.sans.length; i++) {
    const fen = board.fen();
    let mv;
    try { mv = board.move(g.sans[i]); } catch { break; }
    const before = info.cp;
    let after;
    if (board.isGameOver()) { after = board.isCheckmate() ? 10000 : 0; info = { cp: 0, pv: [] }; }
    else { info = await analyseSafe(board.fen(), GAME_NODES); after = -info.cp; }
    const l = Math.max(0, winProb(before) - winProb(after));
    loss.push(Math.round(l * 10) / 10);
    pieces.push(board.board().flat().filter(Boolean).length);
    evals.push(before);
    if (l >= MISTAKE) bad.push({ ply: i + 1, fen, played: mv.san, loss: Math.round(l), before, after, bestUci: null });
  }
  // best moves only for the bad moves (a second, targeted search)
  for (const b of bad) {
    const r = await analyseSafe(b.fen, GAME_NODES * 2);
    b.best = uciToSan(b.fen, r.best);
    b.line = pvToSan(b.fen, r.pv, 5);
  }
  return { loss, pieces, evals, bad };
}

/**
 * Review the newest `count` games not yet analyzed. Cached per game in IndexedDB.
 * onProgress(done, total, currentGame)
 */
export async function reviewGames(user, games, count, onProgress = () => {}, signal = { stop: false }) {
  const key = `review:${user}`;
  const cache = (await idb.get(key)) || {};
  const todo = games.filter((g) => !cache[g.url] && g.sans.length >= 10).slice(0, count);
  for (let i = 0; i < todo.length && !signal.stop; i++) {
    onProgress(i, todo.length, todo[i]);
    try { cache[todo[i].url] = await reviewGame(todo[i]); } catch { continue; } // engine failed twice: skip this game
    await idb.set(key, cache);
  }
  onProgress(todo.length, todo.length, null);
  return cache;
}
export const reviewCache = (user) => idb.get(`review:${user}`).then((c) => c || {});

/** Aggregate reviewed games into phase accuracy, conversion, clock and puzzle candidates. */
export function summarize(games, cache) {
  const ph = { opening: [0, 0, 0], middlegame: [0, 0, 0], endgame: [0, 0, 0] }; // moves, loss, blunders
  const clock = { low: [0, 0], normal: [0, 0] };
  let convert = [0, 0], save = [0, 0], punish = [0, 0], reviewed = 0;
  const puzzles = [];
  for (const g of games) {
    const r = cache[g.url]; if (!r) continue;
    reviewed++;
    const mine = g.color === 'white' ? 0 : 1;
    let peak = 0, low = 0;
    r.loss.forEach((l, i) => {
      if (i % 2 === mine) {
        const phase = i < 20 ? 'opening' : r.pieces[i] <= 12 ? 'endgame' : 'middlegame';
        ph[phase][0]++; ph[phase][1] += l; ph[phase][2] += l >= BLUNDER;
        peak = Math.max(peak, r.evals[i]); low = Math.min(low, r.evals[i]);
        const clk = g.clk[i];
        if (g.base && clk != null) { const c = clock[clk < Math.max(10, 0.1 * g.base) ? 'low' : 'normal']; c[0]++; c[1] += l >= BLUNDER; }
      } else if (l >= BLUNDER && i + 1 < r.loss.length && r.evals[i + 1] >= 200) {
        // opponent blundered; did we keep the advantage on our next move?
        punish[0]++; punish[1] += r.loss[i + 1] < MISTAKE;
      }
    });
    if (peak >= 300) { convert[0]++; convert[1] += g.pts === 2; }
    if (low <= -300) { save[0]++; save[1] += g.pts > 0; }
    for (const b of r.bad) {
      if ((b.ply - 1) % 2 === mine && b.loss >= 25 && b.best && b.best !== b.played) {
        puzzles.push({ id: `${g.url}#${b.ply}`, fen: b.fen, best: b.best, played: b.played, loss: b.loss, line: b.line,
          game: `vs ${g.opp} · ${g.tc} · ${new Date(g.t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · move ${Math.ceil(b.ply / 2)}`,
          winning: b.before >= 200, url: g.url });
      }
    }
  }
  const rate = ([n, , b]) => (n ? Math.round((1000 * b) / n) / 10 : null);
  const pc = ([a, b]) => (a ? Math.round((100 * b) / a) : null);
  return {
    reviewed,
    phases: Object.fromEntries(Object.entries(ph).map(([k, v]) => [k, { moves: v[0], blunders: rate(v), avgLoss: v[0] ? Math.round((10 * v[1]) / v[0]) / 10 : null }])),
    clock: { low: rate([clock.low[0], 0, clock.low[1]]), normal: rate([clock.normal[0], 0, clock.normal[1]]), lowShare: pc([clock.low[0] + clock.normal[0], clock.low[0]]) },
    convert: { games: convert[0], pct: pc(convert) }, save: { games: save[0], pct: pc(save) }, punish: { chances: punish[0], pct: pc(punish) },
    puzzles: puzzles.sort((a, b) => b.loss - a.loss).slice(0, 20),
    givenBack: puzzles.filter((p) => p.winning).length,
  };
}

// ---------- trap finder ----------
export const TRAP_MIN_N = 6; // a position must come up this many times to be checked
/**
 * Positions worth checking for traps in `tree` (the player's opening tree as `color`): reached >= minN
 * times with the player to move, where one reply dominates. No engine needed, so the UI can count them.
 */
export function trapCandidates(tree, color, { minN = TRAP_MIN_N, maxPly = 14 } = {}) {
  const mineParity = color === 'white' ? 0 : 1;
  const cands = [];
  const visit = (node, path) => {
    if (path.length >= maxPly) return;
    const kids = Object.entries(node.c || {});
    if (path.length % 2 === mineParity && node.n >= minN) {
      const [san, child] = kids.sort((a, b) => b[1].n - a[1].n)[0] || [];
      if (san && child.n >= 4 && child.n / node.n >= 0.4) cands.push({ path, san, times: child.n, of: node.n, score: Math.round((50 * child.p) / child.n) });
    }
    for (const [san, child] of kids) if (child.n >= minN) visit(child, [...path, san]);
  };
  visit(tree, []);
  return cands;
}

/** Find moves the player repeats that the engine refutes, among the trapCandidates of `tree`. */
export async function findTraps(user, tree, color, onProgress = () => {}, opts = {}) {
  const key = `traps:${user}:${color}`;
  const cached = await idb.get(key);
  if (cached && cached.n === tree.n) return cached.traps;
  const cands = trapCandidates(tree, color, opts);
  const traps = [];
  for (let i = 0; i < cands.length; i++) {
    onProgress(i, cands.length);
    const c = cands[i];
    const g = new Chess();
    try { for (const m of c.path) g.move(m); } catch { continue; }
    const fen = g.fen();
    const before = await analyseSafe(fen, TRAP_NODES);                 // player's POV
    if (before.cp < -150 || before.cp > 400) continue;               // already decided
    let mv; try { mv = g.move(c.san); } catch { continue; }
    const afterFen = g.fen();
    const reply = await analyseSafe(afterFen, TRAP_NODES);             // opponent's POV
    const after = -reply.cp;
    const drop = winProb(before.cp) - winProb(after);
    const bestSan = uciToSan(fen, before.best);
    if (drop >= 12 && after <= -60 && bestSan !== c.san) {
      traps.push({ ...c, fen, afterFen, played: mv.san, bestForHim: bestSan, before: before.cp, after, drop: Math.round(drop),
        punish: pvToSan(afterFen, reply.pv, 6) });
    }
  }
  onProgress(cands.length, cands.length);
  traps.sort((a, b) => b.drop * b.times - a.drop * a.times);
  // skip traps that sit inside an earlier trap's line
  const out = [];
  for (const t of traps) if (!out.some((o) => [...o.path, o.san].every((m, i) => t.path[i] === m))) out.push(t);
  await idb.set(key, { n: tree.n, checked: cands.length, traps: out.slice(0, 8) });
  return out.slice(0, 8);
}
export const cachedTraps = (user, color) => idb.get(`traps:${user}:${color}`).then((c) => c?.traps || null);
/** How many positions the last scan checked, or null if unknown (no scan yet, or one saved before this was counted). */
export const trapsChecked = (user, color) => idb.get(`traps:${user}:${color}`).then((c) => c?.checked ?? null);

/** Is `san` in `fen` close enough to the engine's best (for accepting alternative puzzle answers)? */
export async function isGoodMove(fen, san, bestSan) {
  const g = new Chess(fen);
  const best = await analyseSafe(fen, TRAP_NODES);
  try { g.move(san); } catch { return false; }
  const after = -(await analyseSafe(g.fen(), TRAP_NODES)).cp;
  return winProb(best.cp) - winProb(after) < 4 || san === bestSan;
}

export { walk };
