// Player statistics computed on the device from compact game records (see chesscom.js).
export const DEPTH = 16;
export const pct = (p, n) => (n ? Math.round((50 * p) / n) : 0); // p = points x2

/** Opening tree {n, p, c:{san: node}} of games where the player had `color`. */
export function buildTree(games, color, depth = DEPTH) {
  const root = { n: 0, p: 0, c: {} };
  for (const g of games) {
    if (g.color !== color) continue;
    let node = root;
    node.n++; node.p += g.pts;
    for (const san of g.sans.slice(0, depth)) {
      node = (node.c[san] ||= { n: 0, p: 0, c: {} });
      node.n++; node.p += g.pts;
    }
  }
  return root;
}

export function walk(tree, moves) {
  let node = tree;
  for (const m of moves) { node = node?.c?.[m]; if (!node) return null; }
  return node;
}

/** Add b's counts into a (both trees in the same shape); returns a new tree. */
export function mergeTrees(a, b) {
  if (!a) return b; if (!b) return a;
  const out = { n: a.n + b.n, p: a.p + b.p, c: {} };
  for (const k of new Set([...Object.keys(a.c || {}), ...Object.keys(b.c || {})])) out.c[k] = mergeTrees(a.c?.[k], b.c?.[k]);
  return out;
}

const top = (node, k = 4) => Object.entries(node?.c || {}).map(([san, x]) => ({ san, n: x.n, score: pct(x.p, x.n) }))
  .filter((x) => x.n >= 3).sort((a, b) => b.n - a.n).slice(0, k);

/** Headline profile: results, repertoire, how games end, clock habits. */
export function profile(games) {
  const byTc = {};
  for (const g of games) { const t = (byTc[g.tc] ||= { n: 0, p: 0 }); t.n++; t.p += g.pts; }
  const white = buildTree(games, 'white', 6), black = buildTree(games, 'black', 6);
  const openings = { white: {}, black: {} };
  for (const g of games) if (g.eco) { const o = (openings[g.color][g.eco] ||= { n: 0, p: 0 }); o.n++; o.p += g.pts; }
  const topOpen = (o) => Object.entries(o).map(([name, x]) => ({ name, n: x.n, score: pct(x.p, x.n) }))
    .filter((x) => x.n >= 3).sort((a, b) => b.n - a.n).slice(0, 6);
  const ends = { win: {}, loss: {} };
  for (const g of games) if (g.pts !== 1) { const e = ends[g.pts ? 'win' : 'loss']; e[g.how] = (e[g.how] || 0) + 1; }
  const long = games.filter((g) => g.sans.length >= 90), short = games.filter((g) => g.sans.length < 50);
  const sum = (xs) => xs.reduce((a, g) => a + g.pts, 0);
  // castling: find own castle move in SAN list
  let castled = 0, queenside = 0, castleMove = 0, never = 0;
  for (const g of games) {
    const mine = g.color === 'white' ? 0 : 1;
    const i = g.sans.findIndex((s, k) => k % 2 === mine && s.startsWith('O-O'));
    if (i >= 0) { castled++; castleMove += Math.floor(i / 2) + 1; if (g.sans[i].startsWith('O-O-O')) queenside++; }
    else if (g.sans.length > 30) never++;
  }
  const decided = games.filter((g) => g.pts !== 1).length;
  const onTime = games.filter((g) => g.pts !== 1 && (g.how === 'timeout')).length;
  return {
    n: games.length,
    byTc: Object.fromEntries(Object.entries(byTc).map(([k, v]) => [k, { n: v.n, score: pct(v.p, v.n) }]).sort((a, b) => b[1].n - a[1].n)),
    firstMove: top(white, 4),
    vsE4: top(walk(black, ['e4']), 3), vsD4: top(walk(black, ['d4']), 3),
    openings: { white: topOpen(openings.white), black: topOpen(openings.black) },
    ends, onTimePct: decided ? Math.round((100 * onTime) / decided) : 0,
    lengthScore: { short: { n: short.length, score: pct(sum(short), short.length) }, long: { n: long.length, score: pct(sum(long), long.length) } },
    castling: { pct: games.length ? Math.round((100 * castled) / games.length) : 0, queensidePct: castled ? Math.round((100 * queenside) / castled) : 0,
      avgMove: castled ? Math.round(castleMove / castled) : null, neverPct: games.length ? Math.round((100 * never) / games.length) : 0 },
    since: games.length ? games[games.length - 1].t : null,
  };
}

/**
 * Lines where the player scores badly: positions reached often enough (minN) where their result
 * is poor. Returned from the player's point of view, deepest-first within a branch trimmed.
 */
export function weakLines(tree, { minN = 8, maxScore = 40, maxDepth = 12 } = {}) {
  const out = [];
  const visit = (node, path) => {
    if (path.length >= maxDepth) return;
    for (const [san, child] of Object.entries(node.c || {})) {
      if (child.n < minN) continue;
      const p = [...path, san];
      const score = pct(child.p, child.n);
      if (score <= maxScore && p.length >= 2) out.push({ moves: p, n: child.n, score });
      visit(child, p);
    }
  };
  visit(tree, []);
  // keep the most informative: drop a line when a shorter prefix already has a worse-or-equal score with most of the games
  out.sort((a, b) => a.moves.length - b.moves.length);
  const kept = [];
  for (const l of out) {
    const parent = kept.find((k) => k.moves.every((m, i) => l.moves[i] === m) && k.score <= l.score + 5 && l.n >= 0.6 * k.n);
    if (!parent) kept.push(l);
  }
  return kept.sort((a, b) => a.score - b.score || b.n - a.n).slice(0, 6);
}

/**
 * Your games against `opp`, from both downloads: your games against them, plus their games against `me`
 * with the result turned round to your side. The same game in both counts once.
 * Returns {n, rec: [won, drew, lost], p (your points x2), last (end time of the latest game, 0 if none)}.
 */
export function headToHead(mine, theirs, opp, me) {
  const byUrl = new Map();
  for (const g of theirs || []) if (g.opp.toLowerCase() === me) byUrl.set(g.url, { t: g.t, pts: 2 - g.pts });
  for (const g of mine || []) if (g.opp.toLowerCase() === opp) byUrl.set(g.url, { t: g.t, pts: g.pts });
  const out = { n: byUrl.size, rec: [0, 0, 0], p: 0, last: 0 };
  for (const g of byUrl.values()) { out.rec[2 - g.pts]++; out.p += g.pts; out.last = Math.max(out.last, g.t); }
  return out;
}
