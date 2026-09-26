import { Chess } from './vendor/chess.js';
import { Board } from './board.js';
import { ls, idb } from './store.js';
import { player, syncGames, cachedGames } from './chesscom.js';
import { buildTree, walk, profile, weakLines, pct } from './stats.js';
import { reviewGames, reviewCache, summarize, findTraps, cachedTraps, isGoodMove } from './analysis.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const FIG = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const fig = (t) => String(t).replace(/\b([KQRBN])(?=[a-h1-8x]*[a-h][1-8])/g, (_, p) => `<span class="fg">${FIG[p]}</span>`);
const numbered = (sans, start = 0) => sans.map((m, j) => { const i = j + start; return (i % 2 ? (j === 0 ? `${Math.floor(i / 2) + 1}…` : '') : `${i / 2 + 1}.`) + m; }).join(' ');
const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const dateOf = (t) => new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const TC = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily' };
const plyOf = (fen) => 2 * (+fen.split(' ')[5] - 1) + (fen.split(' ')[1] === 'b' ? 1 : 0);

let PREP = { friends: [], me: null };     // hand-written prep shipped with the app (optional)
let P = ls.get('profile', null);         // {me:{user,username}, opps:[{user,username}]}
const view = $('#view');
const games = {};                        // user -> compact games (memory cache)
const trees = {};                        // `${user}:${color}` -> tree

// ---------- data helpers ----------
async function gamesOf(user) {
  if (!games[user]) games[user] = (await cachedGames(user))?.games || null;
  return games[user];
}
async function treeOf(user, color) {
  const k = `${user}:${color}`;
  if (trees[k]) return trees[k];
  const gs = await gamesOf(user);
  if (gs?.length) return (trees[k] = buildTree(gs, color));
  const cur = curated(user) || (PREP.me?.user === user ? PREP.me : null);
  return cur?.trees?.[color] || { n: 0, p: 0, c: {} };
}
const curated = (user) => PREP.friends.find((f) => f.user === user);
const oppName = (user) => P?.opps.find((o) => o.user === user)?.username || user;
function invalidate(user) { delete games[user]; delete trees[`${user}:white`]; delete trees[`${user}:black`]; }

async function sync(user, btn, statusEl) {
  const label = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    const info = await player(user);
    ls.set(`player:${user}`, info);
    await syncGames(user, (i, n) => { if (statusEl) statusEl.textContent = `Downloading month ${i} of ${n}…`; });
    invalidate(user);
    return true;
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<span class="warn">${e.code === 404 ? `chess.com has no player called ${esc(user)}.` : "Couldn't reach chess.com. Check your connection and try again."}</span>`;
    return false;
  } finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

// ---------- shared UI ----------
function stats(items) {
  if (!items.length) return '';
  return `<div class="stats">${items.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>`;
}
const list = (items, tag = 'ul') => `<${tag}>${items.map((x) => `<li>${fig(x)}</li>`).join('')}</${tag}>`;
function seg(name, options, current) {
  return `<div class="seg" role="tablist">${options.map(([v, l]) =>
    `<button role="tab" data-${name}="${esc(v)}" aria-selected="${v === current}">${esc(l)}</button>`).join('')}</div>`;
}
function ratingStats(user) {
  const info = ls.get(`player:${user}`, null);
  return Object.entries(info?.ratings || {}).map(([tc, r]) => [String(r.r), `${TC[tc]} · ${(r.w + r.l + r.d).toLocaleString()} games`]);
}
const progress = (id) => `<div class="progress" id="${id}" hidden><div class="pbar"><span></span></div><p class="small muted"></p></div>`;
function setProgress(el, done, total, text) {
  el.hidden = false;
  $('span', el).style.width = `${total ? Math.round((100 * done) / total) : 0}%`;
  $('p', el).textContent = text;
}

/** Read-only line viewer: board + clickable moves + prev/next. */
function lineViewer(host, sans, flipped, keyFrom) {
  const game = new Chess();
  const board = new Board($('.bd', host), { game, flipped });
  let ply = sans.length;
  const go = (n) => {
    ply = Math.max(0, Math.min(sans.length, n));
    game.reset();
    let last = null;
    for (const s of sans.slice(0, ply)) last = game.move(s);
    board.lastMove = last; board.render();
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

// ---------- setup ----------
async function renderSetup(first = false) {
  const me = P?.me;
  const suggestions = [];
  if (me) {
    const count = {};
    for (const g of (await gamesOf(me.user)) || []) count[g.opp.toLowerCase()] = (count[g.opp.toLowerCase()] || 0) + 1;
    for (const [u, n] of Object.entries(count).sort((a, b) => b[1] - a[1]))
      if (n >= 2 && !P.opps.some((o) => o.user === u) && suggestions.length < 6) suggestions.push([u, n]);
  }
  view.innerHTML = `
    <header class="head"><p class="eyebrow">${first ? 'Welcome' : `chess.com/${esc(me.username)}`}</p><h1>${first ? 'Get started' : 'Settings'}</h1>
      <p class="lede">${first ? 'Prepare for games against the people you actually play. Enter your chess.com username, then add your opponents. No password or login: everything used here is public on chess.com.' : 'Change your username or the opponents you prepare for.'}</p></header>
    <form class="card" id="me-form"><label for="me-input"><b>Your chess.com username</b></label>
      <div class="row"><input id="me-input" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(me?.username || '')}" placeholder="e.g. hikaru" required><button class="btn primary">${me ? 'Change' : 'Continue'}</button></div>
      <p class="small" id="me-status" aria-live="polite"></p></form>
    ${me ? `<section class="card"><h2>Opponents</h2>
      ${P.opps.length ? `<ul class="plain">${P.opps.map((o) => `<li class="row"><a href="#prep/${esc(o.user)}">${esc(curated(o.user)?.name || o.username)}${curated(o.user) ? ` <span class="muted small">${esc(o.username)}</span>` : ''}</a><button class="btn" data-remove="${esc(o.user)}" aria-label="Remove ${esc(o.username)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted">No opponents yet.</p>'}
      <form id="opp-form" class="row"><input id="opp-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Opponent's username" required aria-label="Opponent's chess.com username"><button class="btn primary">Add</button></form>
      <p class="small" id="opp-status" aria-live="polite"></p>
      ${suggestions.length ? `<p class="small muted">People you've played most:</p><div class="chips">${suggestions.map(([u, n]) => `<button class="chip" data-add="${esc(u)}">${esc(u)} <span class="muted">${n}</span></button>`).join('')}</div>` : ''}
    </section>
    <section class="card"><h2>Stored locally on this device</h2><p class="small muted">Games and engine results are saved in this browser only. Clearing them frees space; they're downloaded again on the next refresh.</p>
      <button class="btn" id="clear-data">Clear saved games and analysis</button><p class="small" id="clear-status"></p></section>` : ''}`;

  $('#me-form').onsubmit = async (e) => {
    e.preventDefault();
    const user = $('#me-input').value.trim().toLowerCase(); if (!user) return;
    const st = $('#me-status'); st.textContent = 'Downloading your games from chess.com…';
    if (!(await sync(user, e.submitter, st))) return;
    const info = ls.get(`player:${user}`);
    const opps = P?.opps || [];
    // first run for the player this app's hand-written prep was made for: add those opponents
    if (!P && PREP.me?.user === user) for (const f of PREP.friends) opps.push({ user: f.user, username: f.user });
    P = { me: { user, username: info.username }, opps };
    ls.set('profile', P);
    if (first) location.hash = opps.length ? 'me' : 'setup'; else renderSetup();
    if (first && location.hash === '#setup') renderSetup();
  };
  if (!me) return;
  const add = async (user, st) => {
    user = user.trim().toLowerCase();
    if (!user || P.opps.some((o) => o.user === user) || user === P.me.user) return;
    st.textContent = `Looking up ${user}…`;
    try {
      const info = await player(user);
      ls.set(`player:${user}`, info);
      P.opps.push({ user, username: info.username }); ls.set('profile', P);
      location.hash = `prep/${user}`;
    } catch (e) { st.innerHTML = `<span class="warn">${e.code === 404 ? `chess.com has no player called ${esc(user)}.` : "Couldn't reach chess.com."}</span>`; }
  };
  $('#opp-form').onsubmit = (e) => { e.preventDefault(); add($('#opp-input').value, $('#opp-status')); };
  view.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => add(b.dataset.add, $('#opp-status')); });
  view.querySelectorAll('[data-remove]').forEach((b) => { b.onclick = () => { P.opps = P.opps.filter((o) => o.user !== b.dataset.remove); ls.set('profile', P); renderSetup(); }; });
  $('#clear-data').onclick = async () => { await idb.clear(); Object.keys(games).forEach(invalidate); $('#clear-status').textContent = 'Cleared.'; };
}

// ---------- auto profile text ----------
function describe(pr, you) {
  const he = you ? 'You' : 'He', his = you ? 'your' : 'his', plays = you ? 'play' : 'plays';
  const out = [];
  const tcs = Object.entries(pr.byTc);
  if (tcs.length) out.push(`${he} ${plays} mostly ${tcs.slice(0, 2).map(([tc, x]) => `${TC[tc].toLowerCase()} (${x.n} games, scoring ${x.score}%)`).join(' and ')} in this sample.`);
  const fm = pr.firstMove.reduce((a, x) => a + x.n, 0);
  if (fm) out.push(`As White: ${pr.firstMove.slice(0, 3).map((m) => `1.${m.san} in ${Math.round((100 * m.n) / fm)}% (scores ${m.score}%)`).join(', ')}.`);
  if (pr.vsE4.length) out.push(`Against 1.e4: ${pr.vsE4.map((m) => `1…${m.san} ×${m.n} (${m.score}%)`).join(', ')}.`);
  if (pr.vsD4.length) out.push(`Against 1.d4: ${pr.vsD4.map((m) => `1…${m.san} ×${m.n} (${m.score}%)`).join(', ')}.`);
  if (pr.onTimePct >= 25) out.push(`${pr.onTimePct}% of ${his} decisive games end on the clock, so the clock is a big part of ${his} game.`);
  if (pr.castling.pct) out.push(`Castles in ${pr.castling.pct}% of games, around move ${pr.castling.avgMove}${pr.castling.queensidePct >= 20 ? `, queenside ${pr.castling.queensidePct}% of the time` : ''}.${pr.castling.neverPct >= 15 ? ` Leaves the king in the centre in ${pr.castling.neverPct}% of longer games.` : ''}`);
  if (pr.lengthScore.long.n >= 10 && pr.lengthScore.short.n >= 10) {
    const d = pr.lengthScore.long.score - pr.lengthScore.short.score;
    if (Math.abs(d) >= 8) out.push(`${d > 0 ? 'Stronger' : 'Weaker'} in long games: ${pr.lengthScore.long.score}% in games of 45+ moves vs ${pr.lengthScore.short.score}% in games under 25.`);
  }
  return out;
}

function weakHtml(lines, color, user) {
  if (!lines.length) return '<p class="muted small">No line with enough games scores badly.</p>';
  return `<ul class="lines">${lines.map((l) => `<li><button data-explore="${esc(user)}|${color}|${esc(l.moves.join(' '))}">
    <span class="mono">${fig(numbered(l.moves))}</span><span class="small muted">${l.n} games · scores <b class="lo">${l.score}%</b></span></button></li>`).join('')}</ul>`;
}

function trapHtml(t, key, user, color) {
  return `<article class="trap">
    <p class="eyebrow">He has ${color === 'white' ? 'White' : 'Black'}</p>
    <p><b class="mono">${fig(numbered([...t.path, t.played]))}</b></p>
    <p class="small">He plays ${fig(t.played)} here in <b>${t.times} of ${t.of}</b> games and scores ${t.score}%. Stockfish: ${t.bestForHim ? `${fig(t.bestForHim)} was better. ` : ''}After ${fig(t.played)} his winning chances drop by about ${t.drop} points.</p>
    <div data-trap="${key}">${viewerHtml(`Punish with ${fig(t.punish[0] || '?')}. Gold moves are the engine's line.`)}</div>
    <button class="btn primary" data-drill="trap:${esc(user)}:${color}:${key.split(':')[1]}">Drill it</button></article>`;
}

// ---------- opponent file ----------
async function renderOpp(user) {
  if (!P.opps.length) {
    view.innerHTML = '<header class="head"><h1>Prep</h1><p class="lede">Add the people you play to get a file on each of them.</p></header><a class="btn primary" href="#setup">Add opponents</a>';
    return;
  }
  if (!P.opps.some((o) => o.user === user)) user = ls.get('opp', null);
  if (!P.opps.some((o) => o.user === user)) user = P.opps[0].user;
  ls.set('opp', user);
  const cur = curated(user);
  const gs = await gamesOf(user);
  const synced = (await cachedGames(user))?.fetched;
  const pr = gs?.length ? profile(gs) : null;
  const [tw, tb] = await Promise.all([treeOf(user, 'white'), treeOf(user, 'black')]);
  const [trW, trB] = await Promise.all([cachedTraps(user, 'white'), cachedTraps(user, 'black')]);
  // head-to-head from your own games (they go further back than a busy opponent's latest 1,500)
  const h2h = ((await gamesOf(P.me.user)) || []).filter((g) => g.opp.toLowerCase() === user);
  const r = h2h.reduce((a, g) => { a[2 - g.pts]++; return a; }, [0, 0, 0]); // your wins, draws, losses
  const name = oppName(user);
  view.innerHTML = `
    ${P.opps.length > 1 ? seg('opp', P.opps.map((o) => [o.user, curated(o.user)?.name || o.username]), user) : ''}
    <header class="head"><p class="eyebrow">chess.com/${esc(name)}</p><h1>${esc(cur?.name || name)}</h1>
      ${cur ? `<p class="lede">${fig(cur.summary)}</p>` : ''}</header>
    ${stats([...ratingStats(user), ...(h2h.length ? [[`${r[0]}–${r[1]}–${r[2]}`, 'Your record vs him (W–D–L)']] : [])])}
    <section class="card"><div class="row"><h2>Games</h2><button class="btn" id="sync">${gs ? 'Refresh' : 'Download games'}</button></div>
      <p class="small muted" id="sync-status" aria-live="polite">${gs ? `${gs.length.toLocaleString()} games since ${dateOf(pr.since)} · updated ${ago(synced)}` : 'Download his recent games to build his file (up to 12 months).'}</p></section>
    ${cur ? `<section class="card curated"><p class="eyebrow">Hand-written prep</p><h2>Coach's plan</h2>
      ${cur.plans.map((p, i) => `<details${i === 0 ? ' open' : ''}><summary><span class="eyebrow">${esc(p.eyebrow)}</span><br><b>${fig(p.title)}</b></summary>
        <div class="details-body"><div data-line="${i}">${viewerHtml(p.caption)}</div>${p.body.map((b) => `<p>${fig(b)}</p>`).join('')}
        <button class="btn primary" data-drill="line:${esc(user)}:${i}">Drill this line</button></div></details>`).join('')}
      <details><summary><b>Game-day checklist</b></summary><div class="details-body">${list(cur.checklist, 'ol')}</div></details></section>` : ''}
    ${pr ? `<section class="card"><h2>How he plays</h2>${list(describe(pr, false))}</section>` : ''}
    <section class="card"><h2>Traps: moves he repeats that lose</h2>
      <p class="small muted">Stockfish checks the positions he reaches most often and flags moves he keeps playing that the engine refutes.</p>
      ${trW || trB ? '' : `<button class="btn primary" id="traps" ${tw.n + tb.n ? '' : 'disabled'}>Find traps with Stockfish</button><p class="small muted">Takes 1–3 minutes. It runs on your device. Keep the app open.</p>`}
      ${progress('trap-progress')}
      <div id="trap-list">${trW || trB ? trapsSection(user, trW, trB) : ''}</div></section>
    <section class="card"><h2>Lines that go badly for him</h2>
      <h3>When he's White</h3>${weakHtml(weakLines(tw), 'white', user)}
      <h3>When he's Black</h3>${weakHtml(weakLines(tb), 'black', user)}</section>
    ${cur ? `<section class="card curated"><p class="eyebrow">Hand-written prep</p><h2>Where he goes wrong</h2>${list(cur.weak)}</section>` : ''}`;
  if (cur) cur.plans.forEach((p, i) => lineViewer($(`[data-line="${i}"]`, view), p.line.split(' '), !!p.flip, p.key_from));
  mountTraps(trW, trB);
  if (!ls.get(`player:${user}`, null)) {
    player(user).then((info) => { ls.set(`player:${user}`, info); if (location.hash.endsWith(user) || ls.get('opp') === user) renderOpp(user); }).catch(() => {});
  }
  $('#sync').onclick = async (e) => { if (await sync(user, e.currentTarget, $('#sync-status'))) renderOpp(user); };
  $('#traps')?.addEventListener('click', async (e) => {
    e.currentTarget.hidden = true;
    const bar = $('#trap-progress');
    const found = {};
    for (const [color, tree] of [['white', tw], ['black', tb]]) {
      found[color] = await findTraps(user, tree, color, (i, n) => setProgress(bar, i, n, `Checking his positions as ${color === 'white' ? 'White' : 'Black'}: ${i} of ${n}`));
    }
    bar.hidden = true;
    $('#trap-list').innerHTML = trapsSection(user, found.white, found.black);
    mountTraps(found.white, found.black);
  });
}
function trapsSection(user, w, b) {
  const all = [...(w || []).map((t, i) => trapHtml(t, `white:${i}`, user, 'white')), ...(b || []).map((t, i) => trapHtml(t, `black:${i}`, user, 'black'))];
  return all.length ? all.join('') : '<p class="muted">No repeated losing moves in his most common positions. His openings are sound; look at the lines where he scores badly instead.</p>';
}
function mountTraps(w, b) {
  for (const [color, list_] of [['white', w], ['black', b]]) {
    (list_ || []).forEach((t, i) => {
      const host = view.querySelector(`[data-trap="${color}:${i}"]`);
      if (host) lineViewer(host, [...t.path, t.played, ...t.punish], color === 'white', t.path.length + 1);
    });
  }
}

// ---------- Explore ----------
const ex = ls.get('explore', { user: null, color: 'black', moves: [] });
const saveEx = () => ls.set('explore', ex);
async function renderExplore() {
  const people = [...P.opps.map((o) => [o.user, curated(o.user)?.name || o.username]), [P.me.user, 'You']];
  if (!people.some(([u]) => u === ex.user)) { ex.user = people[0][0]; ex.moves = []; }
  const isMe = ex.user === P.me.user;
  const who = isMe ? 'You' : curated(ex.user)?.name || oppName(ex.user);
  const game = new Chess();
  let last = null;
  try { for (const m of ex.moves) last = game.move(m); } catch { ex.moves = []; game.reset(); last = null; }
  const node = walk(await treeOf(ex.user, ex.color), ex.moves);
  const rows = Object.entries(node?.c || {}).map(([s, x]) => ({ s, n: x.n, sc: pct(x.p, x.n) })).sort((a, b) => b.n - a.n);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const theirTurn = game.turn() === (ex.color === 'white' ? 'w' : 'b');
  const noGames = !(await gamesOf(ex.user)) && !curated(ex.user) && !(isMe && PREP.me?.user === ex.user);
  view.innerHTML = `
    ${seg('who', people, ex.user)}
    ${seg('color', [['white', `${who} as White`], ['black', `${who} as Black`]], ex.color)}
    <div class="bd explore-bd"></div>
    <div class="path mono">${ex.moves.length ? fig(numbered(ex.moves)) : 'Starting position'}</div>
    <div class="nav"><button id="ex-back" ${ex.moves.length ? '' : 'disabled'}>◀ Back</button><button id="ex-reset" ${ex.moves.length ? '' : 'disabled'}>Reset</button></div>
    <p class="eyebrow">${theirTurn ? `${esc(who)} to move` : 'Opponent to move'} · ${total} games</p>
    ${rows.length ? `<ul class="moves">${rows.map((r) => `<li><button data-san="${esc(r.s)}"><span class="san">${fig(r.s)}</span>
        <span class="bar"><span style="width:${Math.round((100 * r.n) / total)}%"></span></span>
        <span class="num">${r.n}</span><span class="num sc ${r.sc >= 55 ? 'hi' : r.sc <= 45 ? 'lo' : ''}">${r.sc}%</span></button></li>`).join('')}</ul>
      <p class="muted small">Bar: how often each move was played. %: ${isMe ? 'your' : 'his'} score after it. Tap a move to follow it, or play any move on the board.</p>`
      : `<p class="muted">${noGames ? `No games downloaded for ${esc(who)} yet. Download them from the ${isMe ? 'You' : 'Prep'} tab.` : 'No games reach this position.'}</p>`}`;
  const board = new Board($('.explore-bd'), {
    game, flipped: isMe ? ex.color === 'black' : ex.color === 'white',
    onMove: (m) => { ex.moves.push(game.move(m).san); saveEx(); renderExplore(); },
  });
  board.lastMove = last; board.render();
}

// ---------- Drill ----------
async function drills() {
  const out = [];
  for (const o of P.opps) {
    for (const color of ['white', 'black']) {
      ((await cachedTraps(o.user, color)) || []).forEach((t, i) => out.push({
        id: `trap:${o.user}:${color}:${i}`, group: `Traps vs ${o.username}`, kind: 'pos',
        title: `${numbered([...t.path, t.played])}. Punish it.`, sub: `He plays this in ${t.times} of ${t.of} games`,
        fen: t.afterFen, best: t.punish[0],
        prompt: `He just played ${t.played}, as he does in ${t.times} of ${t.of} games. Punish it.`,
        why: `Stockfish's line: ${numbered(t.punish, plyOf(t.afterFen))}`,
      }));
    }
    const cur = curated(o.user);
    if (cur) cur.plans.forEach((p, i) => out.push({ id: `line:${o.user}:${i}`, group: `Prepared lines vs ${cur.name}`, kind: 'line', title: p.title, sub: p.eyebrow, plan: p }));
  }
  const s = summarize((await gamesOf(P.me.user)) || [], await reviewCache(P.me.user));
  s.puzzles.forEach((pz) => out.push({
    id: `mine:${pz.id}`, group: 'Your mistakes', kind: 'pos', title: pz.winning ? 'You were winning. Keep it.' : 'Find the best move.', sub: pz.game,
    fen: pz.fen, best: pz.best, prompt: pz.winning ? 'You were winning here. Find the move that keeps it.' : 'Find the best move.',
    why: `In the game you played ${pz.played} (−${pz.loss} win-chance points). Stockfish's line: ${numbered(pz.line || [], plyOf(pz.fen))}`,
  }));
  if (PREP.me?.user === P.me.user) PREP.me.puzzles.forEach((pz, i) => out.push({ id: `pz:${i}`, group: 'Your mistakes', kind: 'pos', title: pz.prompt, sub: pz.game, fen: pz.fen, best: pz.best, prompt: pz.prompt, why: `In the game you played ${pz.played}. ${pz.why}` }));
  return out;
}
const done = () => ls.get('done', {});

async function renderDrillList() {
  const d = done();
  const items = await drills();
  const groups = [...new Set(items.map((x) => x.group))];
  view.innerHTML = `<header class="head"><h1>Drill</h1><p class="lede">Punish your opponents' repeated mistakes, play prepared lines from memory, and fix the positions you got wrong.</p></header>
    ${groups.length ? groups.map((g) => `<h2>${esc(g)}</h2><ul class="drills">${items.filter((x) => x.group === g).map((x) => `<li><button data-drill="${esc(x.id)}">
      <span class="check ${d[x.id] ? 'on' : ''}" aria-label="${d[x.id] ? 'Done' : 'Not done'}">${d[x.id] ? '✓' : ''}</span>
      <span><b>${fig(esc(x.title))}</b><br><span class="muted small">${esc(x.sub)}</span></span></button></li>`).join('')}</ul>`).join('')
      : '<div class="card"><p>Drills appear here once there is something to practise:</p><ul><li>Find traps on an opponent in the <a href="#prep">Prep</a> tab.</li><li>Review your games in the <a href="#me">You</a> tab to turn your mistakes into puzzles.</li></ul></div>'}`;
}

async function renderDrill(id) {
  const x = (await drills()).find((d) => d.id === id);
  if (!x) return renderDrillList();
  if (x.kind === 'pos') return renderPosDrill(x);
  const sans = x.plan.line.split(' ');
  const mine = x.plan.flip ? 'b' : 'w';
  const game = new Chess();
  let misses = 0;
  view.innerHTML = `<button class="back" data-go="drill">◀ All drills</button>
    <header class="head"><p class="eyebrow">${esc(x.group)}</p><h1 class="h-sm">${fig(x.title)}</h1></header>
    <div class="bd drill-bd"></div><p class="msg" id="msg" aria-live="polite"></p>
    <div class="nav"><button id="restart">Restart</button><button id="hint">Hint</button></div>`;
  const msg = $('#msg');
  const board = new Board($('.drill-bd'), { game, flipped: mine === 'b' });
  const step = () => {
    const ply = game.history().length;
    if (ply >= sans.length) {
      msg.innerHTML = `<span class="ok">Line complete.</span> ${fig(x.plan.caption || '')}`;
      ls.set('done', { ...done(), [id]: true }); board.onMove = null; board.render(); return;
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

function renderPosDrill(x) {
  const game = new Chess(x.fen);
  const side = game.turn() === 'w' ? 'White' : 'Black';
  view.innerHTML = `<button class="back" data-go="drill">◀ All drills</button>
    <header class="head"><p class="eyebrow">${esc(x.sub)}</p><h1 class="h-sm">${side} to move. ${fig(esc(x.prompt))}</h1></header>
    <div class="bd drill-bd"></div><p class="msg" id="msg" aria-live="polite">Play your move on the board.</p>
    <div class="nav"><button id="reveal">Show the answer</button><button id="retry">Reset</button></div>`;
  const msg = $('#msg');
  const board = new Board($('.drill-bd'), { game, flipped: game.turn() === 'b' });
  const answer = (solved, alt) => {
    const best = new Chess(x.fen).move(x.best);
    board.arrows = [[best.from, best.to, 'var(--good)']];
    board.onMove = null; board.render();
    msg.innerHTML = `${solved ? `<span class="ok">${alt ? 'Good move too.' : 'Correct!'}</span> ` : ''}<b>${fig(x.best)}</b> ${alt ? "was Stockfish's first choice" : 'is the move'}.<br>${fig(esc(x.why))}`;
    if (solved) ls.set('done', { ...done(), [x.id]: true });
  };
  const onMove = async (m) => {
    const mv = game.move(m);
    if (mv.san === x.best) { board.lastMove = mv; board.flash = { square: mv.to, kind: 'good' }; answer(true); return; }
    board.onMove = null; board.render();
    msg.textContent = 'Checking with Stockfish…';
    const good = await isGoodMove(x.fen, mv.san, x.best).catch(() => false);
    if (good) { board.lastMove = mv; board.flash = { square: mv.to, kind: 'good' }; answer(true, true); return; }
    game.undo(); board.flash = { square: m.to, kind: 'bad' }; board.onMove = onMove; board.render();
    msg.innerHTML = `<span class="warn">${fig(mv.san)} isn't it.</span> Check what the last move changed, then try again.`;
  };
  board.onMove = onMove;
  $('#reveal').onclick = () => answer(false);
  $('#retry').onclick = () => renderPosDrill(x);
}

// ---------- You ----------
async function renderMe() {
  const user = P.me.user;
  const gs = await gamesOf(user);
  const synced = (await cachedGames(user))?.fetched;
  const pr = gs?.length ? profile(gs) : null;
  const s = gs ? summarize(gs, await reviewCache(user)) : null;
  const cur = PREP.me?.user === user ? PREP.me : null;
  const [tw, tb] = await Promise.all([treeOf(user, 'white'), treeOf(user, 'black')]);
  const ph = s?.phases;
  view.innerHTML = `
    <header class="head"><p class="eyebrow">chess.com/${esc(P.me.username)}</p><h1>You</h1>
      ${cur ? `<p class="lede">${fig(cur.summary)}</p>` : ''}</header>
    ${stats(ratingStats(user))}
    <section class="card"><div class="row"><h2>Games</h2><button class="btn" id="sync">${gs ? 'Refresh' : 'Download games'}</button></div>
      <p class="small muted" id="sync-status" aria-live="polite">${gs ? `${gs.length.toLocaleString()} games since ${dateOf(pr.since)} · updated ${ago(synced)}` : 'Download your recent games to build your profile.'}</p></section>
    ${pr ? `<section class="card"><h2>Your game</h2>${list(describe(pr, true))}</section>` : ''}
    <section class="card"><h2>Engine review</h2>
      ${s?.reviewed ? `${stats([
        [`${ph.opening.blunders ?? '–'}`, 'Opening blunders per 100 moves'], [`${ph.middlegame.blunders ?? '–'}`, 'Middlegame blunders per 100 moves'],
        [`${ph.endgame.blunders ?? '–'}`, 'Endgame blunders per 100 moves'],
        [s.convert.games ? `${s.convert.pct}%` : '–', `Winning positions converted (${s.convert.games})`],
        [s.save.games ? `${s.save.pct}%` : '–', `Losing positions saved (${s.save.games})`],
        [s.punish.chances ? `${s.punish.pct}%` : '–', `Opponent blunders punished (${s.punish.chances})`]])}
        ${list(insights(s))}` : '<p class="small muted">Stockfish goes through your games move by move and finds where you lose the most. Your worst moments become puzzles in Drill.</p>'}
      <div class="row"><button class="btn primary" id="review" ${gs ? '' : 'disabled'}>Review ${s?.reviewed ? '20 more' : 'my last 20'} games</button><button class="btn" id="stop" hidden>Stop</button></div>
      ${progress('review-progress')}
      <p class="small muted">${s?.reviewed ? `${s.reviewed} games reviewed. ` : ''}About 10 seconds per game. Keep the app open; finished games are saved if you stop.</p></section>
    <section class="card"><h2>Lines that go badly for you</h2>
      <h3>As White</h3>${weakHtml(weakLines(tw, { minN: 4 }), 'white', user)}
      <h3>As Black</h3>${weakHtml(weakLines(tb, { minN: 4 }), 'black', user)}</section>
    ${cur ? `<section class="card curated"><p class="eyebrow">Hand-written notes</p><h2>Coach's notes</h2><h3>Strengths</h3>${list(cur.strengths)}<h3>Weaknesses</h3>${list(cur.weaknesses)}<h3>Training plan</h3>${list(cur.training, 'ol')}</section>` : ''}`;
  $('#sync').onclick = async (e) => { if (await sync(user, e.currentTarget, $('#sync-status'))) renderMe(); };
  const signal = { stop: false };
  $('#review').onclick = async (e) => {
    e.currentTarget.hidden = true; $('#stop').hidden = false;
    const bar = $('#review-progress');
    await reviewGames(user, gs, 20, (i, n, g) => setProgress(bar, i, n, g ? `Game ${i + 1} of ${n}: vs ${g.opp} (${g.tc})` : 'Done'), signal);
    renderMe();
  };
  $('#stop').onclick = (e) => { signal.stop = true; e.currentTarget.textContent = 'Stopping after this game…'; };
}

function insights(s) {
  const out = [], ph = s.phases;
  const phases = Object.entries(ph).filter(([, v]) => v.moves >= 30 && v.blunders != null).sort((a, b) => b[1].blunders - a[1].blunders);
  if (phases.length >= 2) out.push(`Most of your blunders come in the <b>${phases[0][0]}</b> (${phases[0][1].blunders} per 100 moves), fewest in the ${phases.at(-1)[0]} (${phases.at(-1)[1].blunders}).`);
  if (s.givenBack >= 2) out.push(`<b>${s.givenBack} of your big mistakes came when you were already winning.</b> When ahead, check what your opponent can take before you grab material.`);
  if (s.convert.games >= 4 && s.convert.pct < 70) out.push(`You converted only ${s.convert.pct}% of winning positions. Trade pieces and play safe when ahead.`);
  if (s.save.games >= 4 && s.save.pct >= 30) out.push(`You fight well from bad positions: saved ${s.save.pct}%.`);
  if (s.punish.chances >= 5) out.push(s.punish.pct >= 60 ? `You punish blunders: ${s.punish.pct}% of the time you kept the advantage an opponent handed you.` : `You let ${100 - s.punish.pct}% of opponent blunders go unpunished. Before every move, ask what their last move left hanging.`);
  if (s.clock.low != null && s.clock.normal != null && s.clock.lowShare >= 5 && s.clock.low > 1.5 * s.clock.normal) out.push(`With under 10% of your clock left you blunder ${s.clock.low} times per 100 moves vs ${s.clock.normal} normally. Save time in the opening.`);
  if (!out.length) out.push('Review more games for a clearer picture.');
  return out;
}

// ---------- routing ----------
async function route() {
  const [tab, arg] = (location.hash.slice(1) || 'me').split('/');
  const needSetup = !P?.me;
  document.body.classList.toggle('no-tabs', needSetup);
  document.querySelectorAll('.tabbar a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.tab === tab)));
  try {
    if (needSetup) await renderSetup(true);
    else if (tab === 'setup') await renderSetup();
    else if (tab === 'explore') await renderExplore();
    else if (tab === 'drill') await (arg ? renderDrill(decodeURIComponent(arg)) : renderDrillList());
    else if (tab === 'me') await renderMe();
    else await renderOpp(arg ? decodeURIComponent(arg) : null);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<p class="warn">Something went wrong: ${esc(e.message)}</p>`;
  }
  window.scrollTo(0, 0);
}
view.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.opp) location.hash = `prep/${b.dataset.opp}`;
  if (b.dataset.drill) location.hash = `drill/${encodeURIComponent(b.dataset.drill)}`;
  if (b.dataset.go) location.hash = b.dataset.go;
  if (b.dataset.explore) { const [u, c, m] = b.dataset.explore.split('|'); Object.assign(ex, { user: u, color: c, moves: m.split(' ') }); saveEx(); location.hash = 'explore'; }
  if (b.dataset.who) { ex.user = b.dataset.who; ex.moves = []; saveEx(); renderExplore(); }
  if (b.dataset.color) { ex.color = b.dataset.color; ex.moves = []; saveEx(); renderExplore(); }
  if (b.dataset.san) { ex.moves.push(b.dataset.san); saveEx(); renderExplore(); }
  if (b.id === 'ex-back') { ex.moves.pop(); saveEx(); renderExplore(); }
  if (b.id === 'ex-reset') { ex.moves = []; saveEx(); renderExplore(); }
});
window.addEventListener('hashchange', route);

(async () => {
  try { PREP = await (await fetch('prep.json')).json(); } catch { /* hand-written prep is optional */ }
  route();
  // Offline mode only on the real site: on localhost it would serve stale files during development,
  // so remove any worker and cache an earlier local run installed.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!('serviceWorker' in navigator)) return;
  if (!local) { navigator.serviceWorker.register('sw.js').catch(() => {}); return; }
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  if (window.caches) caches.keys().then((ks) => ks.filter((k) => k.startsWith('chess-prep-')).forEach((k) => caches.delete(k))).catch(() => {});
})();
