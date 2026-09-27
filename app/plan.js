// Automatic game plan against one opponent, built from data already on the device:
// their opening trees, profile and (if found) engine traps. No AI; every claim is a counted fact.
import { pct, weakLines } from './stats.js';

const MIN = 20;  // games before a move's score counts as evidence
const CLOSE = 5; // score points within which a move you already play is preferred
const NEW_MIN = 40; // games needed before recommending a move you don't already play
const PRIOR = 30; // small samples are pulled toward their overall score as if backed by this many games

function kids(node, min = MIN) {
  return Object.entries(node?.c || {}).map(([san, x]) => ({ san, n: x.n, score: pct(x.p, x.n) }))
    .filter((k) => k.n >= min).sort((a, b) => b.n - a.n);
}
const share = (k, node) => Math.round((100 * k.n) / node.n);
const TC = { bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', daily: 'daily' };
const SLOW = ['daily', 'rapid', 'blitz', 'bullet'];

/**
 * One side of the plan. `tree` is the opponent's tree with the colour opposite to yours.
 * `youMoveFirst` is true when you have White (your moves are at even plies).
 */
function side(tree, traps, youMoveFirst, mine) {
  const points = [];
  let line = null, keyFrom = null, trap = null;
  // lowest score for them, but keep a move you already play when it is nearly as good
  // ranked on a sample-adjusted score so a lucky handful of games can't outrank hundreds
  const pick = (xs, yours, node) => {
    const base = pct(node.p, node.n);
    const adj = (x) => (x.score * x.n + base * PRIOR) / (x.n + PRIOR);
    const byAdj = (a, b) => adj(a) - adj(b);
    const best = [...xs].filter((x) => yours.has(x.san) || x.n >= NEW_MIN).sort(byAdj)[0] || xs[0];
    const own = xs.filter((x) => yours.has(x.san)).sort(byAdj)[0];
    return own && adj(own) - adj(best) <= CLOSE ? { ...own, yours: true } : best;
  };
  const played = (node) => new Set(Object.entries(node?.c || {}).filter(([, x]) => x.n >= 2).map(([san]) => san));

  // 1. A trap is the strongest evidence (engine-checked, and they repeat it), so build the opening around one
  //    when it starts from an opening you can steer to: your first move as White, or a reply to their usual
  //    first move as Black (preferring moves you already play).
  const stat = (node, san) => node?.c?.[san] ? { san, n: node.c[san].n, score: pct(node.c[san].p, node.c[san].n) } : null;
  const his = youMoveFirst ? null : kids(tree, 1)[0];
  const reachable = (traps || []).filter((x) => (youMoveFirst ? x.path.length >= 1 : x.path.length >= 2 && x.path[0] === his?.san));
  const ownFirst = (x) => (youMoveFirst ? played(mine).has(x.path[0]) : played(mine?.c?.[x.path[0]]).has(x.path[1]));
  const t = reachable.find(ownFirst) || reachable[0];

  let first; // your first move (White) or your reply to their first move (Black)
  if (youMoveFirst) {
    const opts = kids(tree);
    if (t) first = { ...stat(tree, t.path[0]), yours: played(mine).has(t.path[0]), viaTrap: true };
    else if (opts.length) first = pick(opts, played(mine), tree);
    if (first?.san) {
      const usual = opts[0];
      const yours = first.yours ? ' You already play it.' : '';
      const why = first.viaTrap ? ' It leads to their repeated mistake below.' : '';
      points.push(!usual || first.san === usual.san || first.viaTrap
        ? `Open 1.${first.san}.${why} They score ${first.score}% against it (${first.n} games).${yours}`
        : `Open 1.${first.san}. They score ${first.score}% against it (${first.n} games), against ${usual.score}% after 1.${usual.san}.${yours}`);
      const reply = kids(tree.c[first.san], 5)[0];
      if (reply) points.push(`Expect 1…${reply.san}: they play it in ${share(reply, tree.c[first.san])}% of those games.`);
    }
  } else if (his) {
    points.push(`They open 1.${his.san} in ${share(his, tree)}% of their games.`);
    const node = tree.c[his.san];
    const replies = kids(node);
    if (t) first = { ...stat(node, t.path[1]), yours: played(mine?.c?.[his.san]).has(t.path[1]), viaTrap: true };
    else if (replies.length) first = pick(replies, played(mine?.c?.[his.san]), node);
    if (first?.san) {
      const usual = replies[0];
      const yours = first.yours ? ' You already play it.' : '';
      const why = first.viaTrap ? ' It leads to their repeated mistake below.' : '';
      points.push(!usual || first.san === usual.san || first.viaTrap
        ? `Answer 1…${first.san}.${why} They score ${first.score}% against it (${first.n} games).${yours}`
        : `Answer 1…${first.san}. They score ${first.score}% against it (${first.n} games), against ${usual.score}% after the more common 1…${usual.san}.${yours}`);
      first = { ...first, path: [his.san, first.san] };
    }
  }
  const prefix = first?.san ? (first.path || [first.san]) : [];
  const starts = (moves) => prefix.every((m, i) => moves[i] === m);

  if (t) {
    trap = t;
    points.push(`Trap: after ${numbered(t.path)}, they play ${t.played} in ${t.times} of ${t.of} games. Punish it with ${t.punish[0]}.`);
    line = [...t.path, t.played, ...t.punish.slice(0, 3)];
    keyFrom = t.path.length;
  }

  // a line where they score badly, again preferring the recommended opening
  const weak = weakLines(tree, { minN: 8, maxScore: 42 }).filter((l) => l.moves.length >= 2);
  // only lines that follow the recommended opening, so the plan stays one coherent story
  const w = weak.find((l) => starts(l.moves) && l.moves.length > prefix.length) || (prefix.length ? null : weak[0]);
  if (w) {
    points.push(`They struggle after ${numbered(w.moves)}: ${w.score}% in ${w.n} games.`);
    if (!line) { line = w.moves; keyFrom = Math.max(0, prefix.length); }
  }
  if (!line && prefix.length) { line = prefix; keyFrom = 0; }
  return { points, line, keyFrom, trap };
}

export function numbered(sans) {
  return sans.map((m, i) => (i % 2 ? '' : `${i / 2 + 1}.`) + m).join(' ');
}

/** Advice on time control, clock and game length from the opponent's profile. */
function manage(pr) {
  const out = [];
  const tcs = Object.entries(pr.byTc);
  const total = tcs.reduce((a, [, x]) => a + x.n, 0);
  if (tcs.length) {
    const [main, m] = tcs[0];
    const mainShare = Math.round((100 * m.n) / total);
    const slower = SLOW.slice(0, SLOW.indexOf(main)).find((tc) => !pr.byTc[tc] || pr.byTc[tc].n < m.n / 4);
    if (mainShare >= 70 && slower) out.push(`They play mostly ${TC[main]} (${mainShare}% of their games). Ask for a ${slower} game, where their speed matters less.`);
    const weakTc = tcs.filter(([, x]) => x.n >= 20).sort((a, b) => a[1].score - b[1].score)[0];
    if (weakTc && weakTc[1].score <= 45) out.push(`Their weakest time control is ${TC[weakTc[0]]}: ${weakTc[1].score}% over ${weakTc[1].n} games.`);
  }
  if (pr.onTimePct >= 30) out.push(`${pr.onTimePct}% of their decisive games end on the clock. Keep time in hand; in a fast game they will play for your flag.`);
  if (pr.lengthScore.long.n >= 10 && pr.lengthScore.short.n >= 10) {
    const d = pr.lengthScore.long.score - pr.lengthScore.short.score;
    if (d >= 8) out.push(`They get stronger as games go on (${pr.lengthScore.long.score}% in games of 45+ moves). Try to decide it in the middlegame and avoid trading into equal endgames.`);
    if (d <= -8) out.push(`They fade in long games (${pr.lengthScore.long.score}% in games of 45+ moves). Keep pieces on and make it a long game.`);
  }
  if (pr.castling.queensidePct >= 25) out.push(`They castle queenside in ${pr.castling.queensidePct}% of games where they castle. When they do, push your pawns at their king.`);
  if (pr.castling.neverPct >= 15) out.push(`They leave their king in the centre in ${pr.castling.neverPct}% of longer games. Open the centre early.`);
  return out;
}

/**
 * @param {{pr: object|null, tw: object, tb: object, trW: any[]|null, trB: any[]|null, myW?: object, myB?: object}} d
 *   tw/tb: their trees as White/Black; trW/trB: traps found in their games as White/Black;
 *   myW/myB: your own trees, so the plan prefers openings you already play.
 */
export function gamePlan({ pr, tw, tb, trW, trB, myW, myB }) {
  return {
    white: side(tb, trB, true, myW),   // you have White: they are Black
    black: side(tw, trW, false, myB),  // you have Black: they are White
    manage: pr ? manage(pr) : [],
    trapsChecked: !!(trW || trB),
  };
}
