// Synthetic games for the store screenshots: fixed opening lines, then played out by the native Stockfish
// in bin/ (shallow, with a little randomness). Nothing here is a real player.
//   node scripts/store-shots/games.mjs <out.json>     (about 3 minutes)
// Output: {rival: [...], me: [...]} as compact games, the shape the app keeps in `games:<user>`.
// The rival repeats a real trap as Black (the Legal trick: ...Bg4 then ...g6? loses to Nxe5), so the trap
// finder has something to report.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Chess } from '../../app/vendor/chess.js';

const ENGINE = new URL('../../bin/stockfish/stockfish-macos-universal', import.meta.url).pathname;
const OUT = process.argv[2];
if (!OUT) { console.error('Usage: node scripts/store-shots/games.mjs <out.json>'); process.exit(1); }
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const weighted = (items) => { let r = rnd() * items.reduce((s, x) => s + x.w, 0); for (const x of items) if ((r -= x.w) < 0) return x; return items.at(-1); };

const sf = spawn(ENGINE);
let buf = '', waiter = null;
sf.stdout.on('data', (d) => { buf += d; if (waiter && waiter.test(buf)) { const w = waiter.resolve; waiter = null; w(); } });
const send = (s) => sf.stdin.write(s + '\n');
const until = (re) => new Promise((resolve) => { waiter = { test: (b) => re.test(b), resolve }; if (re.test(buf)) { waiter = null; resolve(); } });
async function search(fen) {
  buf = '';
  send(`position fen ${fen}`); send('go depth 7');
  await until(/bestmove/);
  const lines = {};
  for (const l of buf.split('\n')) {
    const m = l.match(/ depth 7 .*multipv (\d+) score (cp|mate) (-?\d+).* pv (\S+)/);
    if (m) lines[m[1]] = { uci: m[4], cp: m[2] === 'cp' ? +m[3] : (+m[3] > 0 ? 10000 : -10000) - +m[3] };
  }
  return Object.values(lines);
}
send('uci'); await until(/uciok/); send('setoption name MultiPV value 3'); send('isready'); await until(/readyok/);

const toMove = (g, uci) => g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

async function play(prefix, maxPly = 90) {
  const g = new Chess();
  for (const s of prefix) g.move(s);
  let eval_ = 0;
  while (!g.isGameOver() && g.history().length < maxPly) {
    const lines = await search(g.fen());
    if (!lines.length) break;
    const best = lines[0];
    eval_ = g.turn() === 'w' ? best.cp : -best.cp;
    // resign-ish: stop once clearly decided
    if (Math.abs(eval_) > 500 && g.history().length > 30) break;
    const ok = lines.filter((l) => best.cp - l.cp < 120);
    const choice = ok[weighted(ok.map((_, i) => ({ w: [0.7, 0.2, 0.1][i] || 0.05, i }))).i];
    toMove(g, choice.uci);
  }
  let result, how;
  if (g.isCheckmate()) { result = g.turn() === 'w' ? 'black' : 'white'; how = 'checkmated'; }
  else if (g.isStalemate()) { result = 'draw'; how = 'stalemate'; }
  else if (g.isDraw()) { result = 'draw'; how = 'repetition'; }
  else if (eval_ > 45) { result = 'white'; how = rnd() < 0.7 ? 'resigned' : 'timeout'; }
  else if (eval_ < -45) { result = 'black'; how = rnd() < 0.7 ? 'resigned' : 'timeout'; }
  else { result = 'draw'; how = 'agreed'; }
  return { sans: g.history(), result, how };
}

const S = (s) => s.split(' ');
// Rival's repertoire. `w` weights, `rival` is the colour the rival plays.
const RIVAL = [
  { w: 14, rival: 'white', eco: 'Italian Game', line: S('e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3') },
  { w: 10, rival: 'white', eco: 'Italian Game', line: S('e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Be7 O-O') },
  { w: 8, rival: 'white', eco: 'Italian Game', line: S('e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3') },
  { w: 8, rival: 'white', eco: 'Queens Gambit', line: S('d4 d5 c4 e6 Nc3 Nf6 Bg5') },
  { w: 4, rival: 'white', eco: 'Queens Gambit', line: S('d4 d5 c4 c6 Nf3 Nf6 Nc3') },
  { w: 6, rival: 'white', eco: 'London System', line: S('d4 Nf6 Bf4 e6 e3 d5 Nf3') },
  { w: 14, rival: 'black', eco: 'Philidor Defense', line: S('e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5') },
  { w: 3, rival: 'black', eco: 'Italian Game', line: S('e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6') },
  { w: 6, rival: 'black', eco: 'Ruy Lopez', line: S('e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7') },
  { w: 4, rival: 'black', eco: 'Scotch Game', line: S('e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6') },
  { w: 5, rival: 'black', eco: 'Queens Gambit', line: S('d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7') },
  { w: 4, rival: 'black', eco: 'Queens Pawn Game', line: S('d4 d5 Nf3 Nf6 Bf4 e6 e3 Bd6') },
  { w: 6, rival: 'black', eco: 'Indian Defense', line: S('d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O') },
];
// "Me": a 1300-ish player with a different repertoire.
const ME = [
  { w: 10, rival: 'white', eco: 'Scotch Game', line: S('e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5') },
  { w: 8, rival: 'white', eco: 'Vienna Game', line: S('e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3') },
  { w: 6, rival: 'white', eco: 'Queens Pawn Game', line: S('d4 d5 Nf3 Nf6 Bf4 e6 e3 c5 c3') },
  { w: 10, rival: 'black', eco: 'Sicilian Defense', line: S('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6') },
  { w: 6, rival: 'black', eco: 'French Defense', line: S('e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+') },
  { w: 5, rival: 'black', eco: 'Kings Indian Defense', line: S('d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O') },
];

const NOW = 1791800000; // seconds, about the 12th of October 2026
const NAMES = ['pawn_pusher22', 'knightmare_nyc', 'bishopbob', 'rookie_roxy', 'queenside_quinn', 'gambit_greta', 'endgame_ed', 'fianchetto_fay', 'zugzwang_zed', 'castle_kate'];
let gameNo = 9000;

async function build(rep, owner, n, rating, tcs) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = weighted(rep);
    const { sans, result, how } = await play(o.line, 70 + Math.floor(rnd() * 20));
    const color = o.rival;
    const pts = result === 'draw' ? 1 : (result === color ? 2 : 0);
    const tc = weighted(tcs).tc;
    const myR = rating + Math.round((rnd() - 0.5) * 80), oppR = myR + Math.round((rnd() - 0.5) * 140);
    const days = Math.floor(rnd() * 210) + (i < 12 ? 0 : 3);
    out.push({
      url: `https://www.chess.com/game/live/${gameNo++}`,
      t: NOW - days * 86400 - Math.floor(rnd() * 80000),
      tc, base: tc === 'rapid' ? 600 : tc === 'bullet' ? 60 : 180, color, rating: myR, opp: pick(NAMES), oppR,
      pts, how,
      eco: o.eco, sans, clk: [],
    });
    // a draw/loss reason must come from the loser's/draw wording; keep timeouts for losses only
    process.stderr.write(`${owner} ${i + 1}/${n}\r`);
  }
  return out.sort((a, b) => b.t - a.t);
}

const TCS = [{ tc: 'blitz', w: 6 }, { tc: 'rapid', w: 3 }, { tc: 'bullet', w: 1 }];
const rival = await build(RIVAL, 'rival', 80, 1480, TCS);
const me = await build(ME, 'me', 45, 1360, TCS);
writeFileSync(OUT, JSON.stringify({ rival, me }));
send('quit');
console.log(`\nwrote ${OUT}: rival ${rival.length}, me ${me.length}`);
