// Store screenshots (Play phone size, 1080x1920) of a made-up opponent file, in headless Chrome.
//   1. npm run dev                                   (app + Worker on :8787; AI prep must show as available)
//   2. node scripts/store-shots/games.mjs games.json
//   3. node scripts/store-shots/shoot.mjs games.json data/store-screenshots   (about 5 minutes: Stockfish runs in the page)
// Everything is synthetic. The AI plan is written below from counts of the seeded games, with the openings
// named in games.mjs: change both together.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './cdp.mjs';

// Numbers the plan quotes, counted from the seeded games the way the app counts them (points x2, so 50 * p / n).
function facts(gs) {
  const score = (a) => (a.length ? Math.round((50 * a.reduce((t, g) => t + g.pts, 0)) / a.length) : 0);
  const line = (a, moves) => a.filter((g) => g.sans.slice(0, moves.length).join(' ') === moves.join(' '));
  const white = gs.filter((g) => g.color === 'white'), black = gs.filter((g) => g.color === 'black');
  const trap = line(black, ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6']);
  const bc5 = line(white, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']), c3 = line(bc5, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3']);
  const decided = gs.filter((g) => g.pts !== 1);
  return {
    whiteScore: score(white), vsE4: { n: black.filter((g) => g.sans[0] === 'e4').length, score: score(black.filter((g) => g.sans[0] === 'e4')) },
    trap: { n: trap.length, losses: trap.filter((g) => g.pts === 0).length, score: score(trap) },
    bc5: { n: bc5.length, score: score(bc5) }, c3: { n: c3.length, score: score(c3) },
    onTime: Math.round((100 * decided.filter((g) => g.how === 'timeout').length) / decided.length),
  };
}
// The plan Claude would write, from those facts (the dev Worker has no real key, so this is written by hand).
const planFor = (f) => ({
  summary: `They score ${f.whiteScore}% as White and ${f.vsE4.score}% against 1.e4, and <b>1.e4 e5 2.Nf3 d6 3.Bc4 Bg4</b> has cost them ${f.trap.losses} of ${f.trap.n} games. Steer into it, stay calm in the Italian, and watch your clock: ${f.onTime}% of their decisive games end on time.`,
  plans: [
    { you_play: 'white', eyebrow: 'You have White', title: '1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 g6? 5.Nxe5!',
      line: 'e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5 dxe5 Qxg4', key_from: 8,
      body: [`They have answered 3.Bc4 with …Bg4 and then played …g6 in ${f.trap.n} games, scoring ${f.trap.score}%. Stockfish rates 4…g6 as losing about two pawns.`,
        'After <b>5.Nxe5</b> the bishop on g4 is pinned against the queen: if 5…Bxd1 then 6.Bxf7+ Ke7 7.Nd5 is mate. Take with 5…dxe5 and play 6.Qxg4.'],
      caption: 'Gold moves are the trap.' },
    { you_play: 'black', eyebrow: 'You have Black', title: '1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 and …d5',
      line: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d5', key_from: 7,
      body: [`Their favourite Italian: ${f.bc5.n} games, and they score ${f.bc5.score}%. After 4.c3 they score ${f.c3.score}% (${f.c3.n} games).`,
        'Answer <b>4…Nf6</b> and meet 5.d3 with <b>5…d5</b>. Take space in the centre and let them find a plan.'],
      caption: 'Play …d5 as soon as it is safe.' },
  ],
  weak: [
    `As Black after 1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 they play …g6 and score ${f.trap.score}% (${f.trap.n} games).`,
    `${f.onTime}% of their decisive games end on the clock: keep the game going and your time healthy.`,
  ],
  checklist: [
    `Open 1.e4: against it they score ${f.vsE4.score}% as Black (${f.vsE4.n} games).`,
    'If they play 1…e5 and 2…d6, go for 3.Bc4 and the Nxe5 trick on move 5.',
    'In the Italian, answer 4.c3 with …Nf6 and …d5.',
    'Avoid long trades into the endgame: play for the middlegame, where their mistakes come.',
    'Check your clock every five moves.',
  ],
});

const [gamesFile, outDir] = process.argv.slice(2);
if (!gamesFile || !outDir) { console.error('Usage: node scripts/store-shots/shoot.mjs <games.json> <out dir>'); process.exit(1); }
const BASE = 'http://localhost:8787', ME = 'pawnstorm_alex', RIVAL = 'silverknight77', PORT = 9333;
const games = JSON.parse(readFileSync(gamesFile));
mkdirSync(outDir, { recursive: true });

const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
if (!health?.ai) { console.error(`Start "npm run dev" first: ${BASE}/api/health must answer ai: true.`); process.exit(1); }

const profileDir = mkdtempSync(join(tmpdir(), 'store-shots-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let c;
try {
  for (let i = 0; !c && i < 30; i++) { c = await connect(PORT).catch(() => null); if (!c) await sleep(500); }
  if (!c) throw new Error('Chrome did not start');

  const info = (user, name, gs, r) => {
    const ratings = {};
    for (const [tc, add] of [['blitz', 0], ['rapid', 40], ['bullet', -60]]) {
      const x = gs.filter((g) => g.tc === tc);
      if (x.length) ratings[tc] = { r: r + add, w: x.filter((g) => g.pts === 2).length * 9, l: x.filter((g) => g.pts === 0).length * 9, d: x.filter((g) => g.pts === 1).length * 9 };
    }
    return { user, name, username: user, avatar: null, ratings };
  };
  const months = (gs) => Object.fromEntries([...new Set(gs.map((g) => new Date(g.t * 1000).toISOString().slice(0, 7).replace('-', '/')))].map((m) => [m, Date.now()]));
  const seed = {
    profile: { me: { user: ME, username: ME }, opps: [{ user: RIVAL, username: RIVAL }] },
    [`player:${ME}`]: info(ME, 'Alex', games.me, 1360),
    [`player:${RIVAL}`]: info(RIVAL, 'Sam', games.rival, 1480),
  };
  await c.send('Page.enable');
  await c.send('Page.navigate', { url: `${BASE}/` });
  await sleep(2500);
  await c.run(`(async () => {
    const { idb, ls } = await import('/store.js');
    localStorage.clear(); await idb.clear();
    for (const [k, v] of Object.entries(${JSON.stringify(seed)})) ls.set(k, v);
    await idb.set('games:${ME}', { months: ${JSON.stringify(months(games.me))}, games: ${JSON.stringify(games.me)}, fetched: Date.now() });
    await idb.set('games:${RIVAL}', { months: ${JSON.stringify(months(games.rival))}, games: ${JSON.stringify(games.rival)}, fetched: Date.now() });
  })()`);
  await c.send('Page.navigate', { url: `${BASE}/#prep/${RIVAL}` });
  await c.send('Page.reload');
  await sleep(3000);

  // Step 2 runs on its own: Stockfish reviews the newest games, then looks for traps.
  const steps = () => c.run(`[...document.querySelectorAll('.step')].map((b) => b.getAttribute('aria-label')).join(' | ')`);
  for (const t0 = Date.now(); !/Analyze opponent: done/.test(await steps());) {
    if (Date.now() - t0 > 20 * 60000) throw new Error('The analysis did not finish');
    await sleep(10000);
  }
  console.log(await steps());

  const shot = async (name, selector, offset = 8) => {
    await c.run(`(async () => { const el = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'null'}; window.scrollTo(0, el ? el.getBoundingClientRect().top + scrollY - ${offset} : 0); await new Promise((r) => setTimeout(r, 600)); })()`);
    await c.shot(join(outDir, `${name}.png`));
  };
  const reload = async () => { await c.send('Page.reload'); await sleep(3500); };

  // The game plan with the one-time consent note, before any plan is written.
  await shot('5-game-plan-consent', '#ai');
  // Then the plan Claude would write, for the finished file.
  await c.run(`(async () => {
    const { idb, ls } = await import('/store.js');
    await idb.set('aiprep:${RIVAL}', { plan: ${JSON.stringify(planFor(facts(games.rival)))}, at: Date.now() - 3 * 3600000, games: ${games.rival.length} });
    ls.set('aiconsent', { v: 1, at: Date.now() });
  })()`);
  await reload();
  await shot('1-opponent-file', null);
  await shot('2-trap', '#trap-list', 150);
  await shot('4-ai-plan', '#ai');
  console.log(`Screenshots in ${outDir}`);
} finally {
  c?.close();
  const exited = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await exited;
  rmSync(profileDir, { recursive: true, force: true, maxRetries: 5 });
}
