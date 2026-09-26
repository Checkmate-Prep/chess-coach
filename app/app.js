import { Chess } from './vendor/chess.js';
import { Board } from './board.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const FIG = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const fig = (t) => String(t).replace(/\b([KQRBN])(?=[a-h1-8x]*[a-h][1-8])/g, (_, p) => `<span class="fg">${FIG[p]}</span>`);
const numbered = (sans) => sans.map((m, i) => (i % 2 ? '' : `${i / 2 + 1}.`) + m).join(' ');
const pct = (p, n) => (n ? Math.round((50 * p) / n) : 0); // p is points x2

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

let PREP;
const view = $('#view');

// ---------- chess.com live refresh ----------
function sansOf(pgn) {
  const text = pgn.split('\n\n').slice(1).join(' ').replace(/\{[^}]*\}/g, ' ');
  return text.split(/\s+/).filter((t) => t && !/^(\d+\.+|1-0|0-1|1\/2-1\/2|\*)$/.test(t));
}
const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

async function refreshPlayer(user, since) {
  const arch = await (await fetch(`https://api.chess.com/pub/player/${user}/games/archives`)).json();
  const d = new Date(since * 1000);
  const from = d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
  const urls = arch.archives.filter((u) => { const [y, m] = u.split('/').slice(-2).map(Number); return y * 100 + m >= from; });
  const months = await Promise.all(urls.map((u) => fetch(u).then((r) => r.json())));
  const games = months.flatMap((m) => m.games)
    .filter((g) => g.end_time > since && g.rules === 'chess' && g.pgn)
    .map((g) => {
      const color = g.white.username.toLowerCase() === user ? 'white' : 'black';
      const me = g[color], opp = g[color === 'white' ? 'black' : 'white'];
      return {
        t: g.end_time, tc: g.time_class, url: g.url, color, opp: opp.username, oppR: opp.rating, rating: me.rating,
        pts: me.result === 'win' ? 2 : DRAWS.has(me.result) ? 1 : 0, how: me.result === 'win' ? opp.result : me.result,
        sans: sansOf(g.pgn).slice(0, 16),
      };
    })
    .sort((a, b) => b.t - a.t);
  const rec = { fetched: Date.now(), games };
  store.set(`recent:${user}`, rec);
  return rec;
}
const recentOf = (user) => store.get(`recent:${user}`, null);

// ---------- opening trees ----------
function walk(tree, moves) {
  let node = tree;
  for (const m of moves) { node = node?.c?.[m]; if (!node) return null; }
  return node;
}
function recentNext(user, color, moves) {
  const out = {};
  for (const g of recentOf(user)?.games || []) {
    if (g.color !== color || moves.some((m, i) => g.sans[i] !== m) || g.sans.length <= moves.length) continue;
    const s = g.sans[moves.length];
    (out[s] ||= { n: 0, p: 0 }); out[s].n++; out[s].p += g.pts;
  }
  return out;
}
function playerOf(user) {
  return user === PREP.me.user ? { ...PREP.me, name: 'You' } : PREP.friends.find((f) => f.user === user);
}

// ---------- shared bits ----------
function stats(list) {
  return `<div class="stats">${list.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
}
function list(items, tag = 'ul') { return `<${tag}>${items.map((x) => `<li>${fig(x)}</li>`).join('')}</${tag}>`; }
function seg(name, options, current) {
  return `<div class="seg" role="tablist">${options.map(([v, l]) =>
    `<button role="tab" data-${name}="${v}" aria-selected="${v === current}">${esc(l)}</button>`).join('')}</div>`;
}
const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const dateOf = (t) => new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Read-only line viewer: board + clickable move list + prev/next. */
function lineViewer(host, line, flipped, keyFrom) {
  const sans = line.split(' ');
  const game = new Chess();
  const board = new Board($('.bd', host), { game, flipped });
  let ply = sans.length;
  const go = (n) => {
    ply = Math.max(0, Math.min(sans.length, n));
    game.reset();
    let last = null;
    for (const s of sans.slice(0, ply)) last = game.move(s);
    board.lastMove = last;
    board.render();
    host.querySelectorAll('.mv').forEach((b) => b.setAttribute('aria-current', String(+b.dataset.ply === ply)));
  };
  $('.mvs', host).innerHTML = sans.map((s, i) =>
    `${i % 2 === 0 ? `<span class="mn">${i / 2 + 1}.</span>` : ''}<button class="mv${keyFrom != null && i >= keyFrom ? ' key' : ''}" data-ply="${i + 1}">${fig(s)}</button>`).join(' ');
  host.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ply) go(+b.dataset.ply);
    if (b.dataset.nav) go({ first: 0, prev: ply - 1, next: ply + 1, last: sans.length }[b.dataset.nav]);
  });
  go(sans.length);
}
const viewerHtml = (cap) => `<div class="viewer"><div class="bd"></div><div class="mvs"></div>
  <div class="nav"><button data-nav="first" aria-label="Start">⏮</button><button data-nav="prev" aria-label="Back">◀</button><button data-nav="next" aria-label="Forward">▶</button><button data-nav="last" aria-label="End">⏭</button></div>
  ${cap ? `<p class="cap">${fig(cap)}</p>` : ''}</div>`;

// ---------- Prep ----------
function watchLine(f, plan) {
  const w = plan.watch; if (!w) return '';
  const prefix = w.prefix.split(' ');
  const node = walk(f.trees[w.color], prefix);
  const base = node?.c?.[w.expect]?.n || 0, baseN = node?.n || 0;
  const rec = recentOf(f.user);
  const r = recentNext(f.user, w.color, prefix);
  const rN = Object.values(r).reduce((a, x) => a + x.n, 0), rHit = r[w.expect]?.n || 0;
  const other = Object.entries(r).filter(([s]) => s !== w.expect).map(([s, x]) => `${fig(s)} ×${x.n}`).join(', ');
  const status = !rec ? '<span class="muted">Refresh to check his latest games.</span>'
    : rN === 0 ? '<span class="muted">No new games reached this position yet.</span>'
    : rHit === rN ? `<span class="ok">Still on track: ${rHit} of ${rN} new games.</span>`
    : `<span class="warn">Changed: ${rHit} of ${rN} new games. Also played ${other}.</span>`;
  return `<div class="watch"><span class="eyebrow">Watch</span> After ${fig(numbered(prefix))}, he played ${fig((prefix.length % 2 ? '…' : `${prefix.length / 2 + 1}.`) + w.expect)} in ${base} of ${baseN} games. ${status}</div>`;
}

function latestHtml(f) {
  const rec = recentOf(f.user);
  if (!rec) return `<p class="muted">Prep data runs to ${dateOf(f.last_game)}. Tap refresh to load anything he's played since.</p>`;
  if (!rec.games.length) return `<p class="muted">No new games since ${dateOf(f.last_game)}. Checked ${ago(rec.fetched)}.</p>`;
  const by = {};
  for (const g of rec.games) { (by[g.tc] ||= { n: 0, p: 0 }); by[g.tc].n++; by[g.tc].p += g.pts; }
  const summary = Object.entries(by).map(([tc, x]) => `${x.n} ${tc} (${pct(x.p, x.n)}%)`).join(' · ');
  const rows = rec.games.slice(0, 8).map((g) => `<li><a href="${esc(g.url)}" target="_blank" rel="noopener">
      <span class="res r${g.pts}">${g.pts === 2 ? 'W' : g.pts === 1 ? '½' : 'L'}</span>
      <span class="gl"><b>${esc(g.color === 'white' ? 'White' : 'Black')} vs ${esc(g.opp)}</b> <span class="muted">${esc(g.oppR)} · ${esc(g.tc)} · ${dateOf(g.t)}</span><br>
      <span class="mono">${fig(numbered(g.sans.slice(0, 8)))}</span></span></a></li>`).join('');
  return `<p><b>${rec.games.length} new games</b> since ${dateOf(f.last_game)}: ${summary}. <span class="muted">Checked ${ago(rec.fetched)}.</span></p><ul class="games">${rows}</ul>`;
}

function renderPrep(user) {
  const f = PREP.friends.find((x) => x.user === user) || PREP.friends[0];
  store.set('friend', f.user);
  view.innerHTML = `
    ${seg('friend', PREP.friends.map((x) => [x.user, x.name]), f.user)}
    <header class="head"><p class="eyebrow">chess.com/${esc(f.user)}</p><h1>${esc(f.name)}</h1><p class="lede">${fig(f.summary)}</p></header>
    ${stats(f.stats)}
    <section class="card live"><div class="row"><h2>Latest from chess.com</h2><button class="btn" id="refresh">Refresh</button></div><div id="latest">${latestHtml(f)}</div></section>
    ${f.plans.map((p, i) => `<section class="plan"><p class="eyebrow">${esc(p.eyebrow)}</p><h2>${fig(p.title)}</h2>
        ${watchLine(f, p)}
        <div data-line="${i}">${viewerHtml(p.caption)}</div>
        ${p.body.map((b) => `<p>${fig(b)}</p>`).join('')}
        ${p.table ? `<table><tr><th>Line</th><th>Games</th><th>His score</th></tr>${p.table.map(([a, b, c]) => `<tr><td>${fig(a)}</td><td>${b}</td><td>${c}</td></tr>`).join('')}</table>` : ''}
        <button class="btn primary" data-drill="line:${f.user}:${i}">Drill this line</button></section>`).join('')}
    <section class="card"><h2>How he plays</h2>${list(f.style)}</section>
    <section class="card"><h2>Where he goes wrong</h2>${list(f.weak)}</section>
    <section class="card"><h2>Game-day checklist</h2>${list(f.checklist, 'ol')}</section>`;
  f.plans.forEach((p, i) => lineViewer($(`[data-line="${i}"]`, view), p.line, !!p.flip, p.key_from));
  $('#refresh').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Loading…';
    try { await refreshPlayer(f.user, f.last_game); renderPrep(f.user); }
    catch { $('#latest').innerHTML = '<p class="warn">Couldn\'t reach chess.com. Check your connection and tap Refresh again.</p>'; btn.disabled = false; btn.textContent = 'Refresh'; }
  });
}

// ---------- Explore ----------
const ex = store.get('explore', { user: 'pepex654', color: 'black', moves: [] });
function renderExplore() {
  const p = playerOf(ex.user);
  const game = new Chess();
  let last = null;
  for (const m of ex.moves) last = game.move(m);
  const node = walk(p.trees[ex.color], ex.moves);
  const recent = recentNext(ex.user, ex.color, ex.moves);
  const names = new Set([...Object.keys(node?.c || {}), ...Object.keys(recent)]);
  const rows = [...names].map((s) => ({ s, n: node?.c?.[s]?.n || 0, p: node?.c?.[s]?.p || 0, r: recent[s]?.n || 0, rp: recent[s]?.p || 0 }))
    .sort((a, b) => b.n + b.r - (a.n + a.r));
  const total = rows.reduce((a, r) => a + r.n + r.r, 0);
  const whoseTurn = game.turn() === (ex.color === 'white' ? 'w' : 'b');
  const who = ex.user === PREP.me.user ? 'You' : p.name;
  const opts = [...PREP.friends.map((f) => [f.user, f.name]), [PREP.me.user, 'You']];
  view.innerHTML = `
    ${seg('who', opts, ex.user)}
    ${seg('color', [['white', `${who} as White`], ['black', `${who} as Black`]], ex.color)}
    <div class="bd explore-bd"></div>
    <div class="path mono">${ex.moves.length ? fig(numbered(ex.moves)) : 'Starting position'}</div>
    <div class="nav"><button id="ex-back" ${ex.moves.length ? '' : 'disabled'}>◀ Back</button><button id="ex-reset" ${ex.moves.length ? '' : 'disabled'}>Reset</button></div>
    <p class="eyebrow">${whoseTurn ? `${esc(who)} to move` : 'Opponent to move'} · ${total} games reached this position</p>
    ${rows.length ? `<ul class="moves">${rows.map((r) => {
      const n = r.n + r.r, sc = pct(r.p + r.rp, n);
      return `<li><button data-san="${esc(r.s)}"><span class="san">${fig(r.s)}</span>
        <span class="bar"><span style="width:${Math.round((100 * n) / total)}%"></span></span>
        <span class="num">${n}${r.r ? ` <em>+${r.r} new</em>` : ''}</span><span class="num sc ${sc >= 55 ? 'hi' : sc <= 45 ? 'lo' : ''}">${sc}%</span></button></li>`;
    }).join('')}</ul><p class="muted small">Bar: how often each move was played. %: ${esc(who === 'You' ? 'your' : 'his')} score after it. Tap a move to follow it, or play any move on the board.</p>`
      : `<p class="muted">${esc(who)} has no games past this point${ex.moves.length ? '' : ' with this color'}.</p>`}`;
  const board = new Board($('.explore-bd'), {
    game, flipped: ex.user === PREP.me.user ? ex.color === 'black' : ex.color === 'white',
    onMove: (m) => { const mv = game.move(m); ex.moves.push(mv.san); saveEx(); renderExplore(); },
  });
  board.lastMove = last; board.render();
}
function saveEx() { store.set('explore', ex); }

// ---------- Drill ----------
function drills() {
  const out = [];
  for (const f of PREP.friends) f.plans.forEach((p, i) => out.push({ id: `line:${f.user}:${i}`, kind: 'line', title: p.title, sub: `vs ${f.name} · ${p.eyebrow}`, plan: p }));
  PREP.me.puzzles.forEach((pz, i) => out.push({ id: `pz:${i}`, kind: 'puzzle', title: pz.prompt, sub: pz.game, pz }));
  return out;
}
const done = () => store.get('done', {});

function renderDrillList() {
  const d = done();
  const items = drills();
  const li = (x) => `<li><button data-drill="${x.id}"><span class="check ${d[x.id] ? 'on' : ''}" aria-label="${d[x.id] ? 'Done' : 'Not done'}">${d[x.id] ? '✓' : ''}</span>
    <span><b>${fig(x.title)}</b><br><span class="muted small">${esc(x.sub)}</span></span></button></li>`;
  view.innerHTML = `<header class="head"><h1>Drill</h1><p class="lede">Play the prepared lines from memory, then solve the positions you got wrong in your own games.</p></header>
    <h2>Opening traps</h2><ul class="drills">${items.filter((x) => x.kind === 'line').map(li).join('')}</ul>
    <h2>Find the move</h2><ul class="drills">${items.filter((x) => x.kind === 'puzzle').map(li).join('')}</ul>`;
}

function renderDrill(id) {
  const x = drills().find((d) => d.id === id);
  if (!x) return renderDrillList();
  if (x.kind === 'puzzle') return renderPuzzle(x);
  const sans = x.plan.line.split(' ');
  const mine = x.plan.flip ? 'b' : 'w';
  const game = new Chess();
  let misses = 0;
  view.innerHTML = `<button class="back" data-go="drill">◀ All drills</button>
    <header class="head"><p class="eyebrow">${esc(x.sub)}</p><h1 class="h-sm">${fig(x.title)}</h1></header>
    <div class="bd drill-bd"></div><p class="msg" id="msg" aria-live="polite"></p>
    <div class="nav"><button id="restart">Restart</button><button id="hint">Hint</button></div>`;
  const msg = $('#msg');
  const board = new Board($('.drill-bd'), { game, flipped: mine === 'b' });
  const step = () => {
    const ply = game.history().length;
    if (ply >= sans.length) {
      msg.innerHTML = `<span class="ok">Line complete.</span> ${fig(x.plan.caption || '')}`;
      store.set('done', { ...done(), [id]: true });
      board.onMove = null; board.render(); return;
    }
    if (game.turn() !== mine) {
      board.onMove = null;
      setTimeout(() => { board.lastMove = game.move(sans[ply]); board.flash = null; board.render(); step(); }, 450);
      return;
    }
    const key = x.plan.key_from != null && ply >= x.plan.key_from;
    msg.innerHTML = key ? '<span class="gold">Key moment.</span> Find the prepared move.' : 'Your move.';
    board.onMove = (m) => {
      const want = sans[ply];
      const mv = game.move(m);
      if (mv.san === want) { misses = 0; board.hint = null; board.lastMove = mv; board.flash = { square: mv.to, kind: 'good' }; board.render(); step(); return; }
      game.undo(); misses++;
      board.flash = { square: m.to, kind: 'bad' }; board.render();
      msg.innerHTML = `<span class="warn">${fig(mv.san)} isn't the prep move.</span> ${misses >= 2 ? 'The highlighted piece moves.' : 'Try again.'}`;
      if (misses >= 2) { board.hint = new Chess(game.fen()).move(want).from; board.render(); }
    };
    board.render();
  };
  $('#restart').onclick = () => { game.reset(); misses = 0; board.hint = null; board.flash = null; board.lastMove = null; step(); };
  $('#hint').onclick = () => { const ply = game.history().length; if (ply < sans.length && game.turn() === mine) { board.hint = new Chess(game.fen()).move(sans[ply]).from; board.render(); } };
  step();
}

function renderPuzzle(x) {
  const pz = x.pz;
  const game = new Chess(pz.fen);
  const side = game.turn() === 'w' ? 'White' : 'Black';
  view.innerHTML = `<button class="back" data-go="drill">◀ All drills</button>
    <header class="head"><p class="eyebrow">${esc(pz.game)}</p><h1 class="h-sm">${side} to move. ${esc(pz.prompt)}</h1></header>
    <div class="bd drill-bd"></div><p class="msg" id="msg" aria-live="polite">Play your move on the board.</p>
    <div class="nav"><button id="reveal">Show the answer</button><button id="retry">Reset</button></div>`;
  const msg = $('#msg');
  const board = new Board($('.drill-bd'), { game, flipped: game.turn() === 'b' });
  const answer = (solved) => {
    const g = new Chess(pz.fen); const best = g.move(pz.best);
    const played = new Chess(pz.fen).move(pz.played);
    board.arrows = [[best.from, best.to, 'var(--good)'], [played.from, played.to, 'var(--bad)']];
    board.onMove = null; board.render();
    msg.innerHTML = `${solved ? '<span class="ok">Correct!</span> ' : ''}<b>${fig(pz.best)}</b> was the move. In the game you played <span class="warn">${fig(pz.played)}</span>.<br>${fig(pz.why)}`;
    if (solved) store.set('done', { ...done(), [x.id]: true });
  };
  board.onMove = (m) => {
    const mv = game.move(m);
    if (mv.san === pz.best) { board.lastMove = mv; board.flash = { square: mv.to, kind: 'good' }; answer(true); return; }
    game.undo(); board.flash = { square: m.to, kind: 'bad' }; board.render();
    msg.innerHTML = `<span class="warn">${fig(mv.san)} isn't it.</span> Check what the last move changed, then try again.`;
  };
  $('#reveal').onclick = () => answer(false);
  $('#retry').onclick = () => renderPuzzle(x);
}

// ---------- You ----------
function renderMe() {
  const m = PREP.me;
  view.innerHTML = `<header class="head"><p class="eyebrow">chess.com/${esc(m.user)}</p><h1>You</h1><p class="lede">${fig(m.summary)}</p></header>
    ${stats(m.stats)}
    <section class="card"><h2>Strengths</h2>${list(m.strengths)}</section>
    <section class="card"><h2>Weaknesses</h2>${list(m.weaknesses)}</section>
    <section class="card"><h2>Training plan</h2>${list(m.training, 'ol')}</section>
    <p class="muted small">Prep built ${esc(PREP.built)} from your games and a Stockfish analysis on your Mac. Run <span class="mono">python3 coach.py refresh</span> and <span class="mono">python3 build_app.py</span> there to update it.</p>`;
}

// ---------- routing ----------
function route() {
  const [tab, arg] = (location.hash.slice(1) || 'prep').split('/');
  document.querySelectorAll('.tabbar a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.tab === tab)));
  if (tab === 'explore') renderExplore();
  else if (tab === 'drill') (arg ? renderDrill(decodeURIComponent(arg)) : renderDrillList());
  else if (tab === 'me') renderMe();
  else renderPrep(arg || store.get('friend', PREP.friends[0].user));
  window.scrollTo(0, 0);
}
view.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.friend) location.hash = `prep/${b.dataset.friend}`;
  if (b.dataset.drill) location.hash = `drill/${encodeURIComponent(b.dataset.drill)}`;
  if (b.dataset.go) location.hash = b.dataset.go;
  if (b.dataset.who) { ex.user = b.dataset.who; ex.moves = []; saveEx(); renderExplore(); }
  if (b.dataset.color) { ex.color = b.dataset.color; ex.moves = []; saveEx(); renderExplore(); }
  if (b.dataset.san) { ex.moves.push(b.dataset.san); saveEx(); renderExplore(); }
  if (b.id === 'ex-back') { ex.moves.pop(); saveEx(); renderExplore(); }
  if (b.id === 'ex-reset') { ex.moves = []; saveEx(); renderExplore(); }
});
window.addEventListener('hashchange', route);

(async () => {
  try {
    PREP = await (await fetch('prep.json')).json();
    route();
  } catch {
    view.innerHTML = '<p class="warn">Couldn\'t load the prep data. Open the app once while online.</p>';
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
