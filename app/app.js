import { Chess } from './vendor/chess.js';
import { Board } from './board.js';
import { PIECES } from './pieces.js';
import { idb, ls } from './store.js';
import { player, savePlayers, syncGames, cachedGames } from './chesscom.js';
import { buildTree, walk, profile, weakLines, pct, headToHead } from './stats.js';
import { reviewGames, reviewCache, reviewedCount, summarize, findTraps, cachedTraps, trapScan, trapCandidates, TRAP_MIN_N, isGoodMove } from './analysis.js';
import { gamePlan } from './plan.js';
import { whileAwake } from './engine.js';
import { account, startSync, returningFromSignIn, signIn, signOut, syncNow, deleteSynced, forgetDevice, hasApi, token } from './sync.js';
import { track, startTracking, screenOf, sharing, setSharing } from './track.js';

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
let AI = false;                          // AI prep available (the app is served by the Worker with a key set)
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
/** Name shown for an opponent: the one set in Settings (may be cleared), else the hand-written prep's, else the username. */
const displayName = (user) => {
  const o = P?.opps.find((x) => x.user === user);
  if (o && 'name' in o) return o.name || o.username;
  return curated(user)?.name || o?.username || user;
};
const hasAlias = (user) => displayName(user).toLowerCase() !== oppName(user).toLowerCase();
function invalidate(user) { delete games[user]; delete trees[`${user}:white`]; delete trees[`${user}:black`]; }

// ---------- downloads: one at a time per player, shared by the Refresh buttons and the automatic ones ----------
const DAY = 86400000;
const downloading = {};                  // user -> the download in flight
const monthOf = {};                      // user -> [month, of]
const queue = [];                        // automatic downloads waiting their turn
const failed = new Set();                // automatic downloads that failed: not tried again until the next launch
let draining = false;
const pending = (user) => !!downloading[user] || queue.includes(user);
const dlText = (user) => monthOf[user] ? `Downloading month ${monthOf[user][0]} of ${monthOf[user][1]}…` : 'Waiting to download…';
/** Download a player's profile and games; a second call while one runs waits for the same download. */
function download(user) {
  return downloading[user] ||= (async () => {
    try {
      ls.set(`player:${user}`, await player(user));
      await syncGames(user, (i, n) => {
        monthOf[user] = [i, n];
        document.querySelectorAll(`[data-dl="${user}"]`).forEach((el) => { el.textContent = dlText(user); });
      });
      invalidate(user);
      queueReview(user);
    } finally { delete downloading[user]; delete monthOf[user]; }
  })();
}
/** Download in the background, one player after another (gentle on chess.com). */
function queueDownload(user) {
  if (pending(user) || failed.has(user)) return;
  queue.push(user);
  if (!draining) runQueue();
}
async function runQueue() {
  draining = true;
  while (queue.length) {
    const user = queue[0];
    try { await download(user); } catch { failed.add(user); }
    queue.shift(); downloaded(user);
  }
  draining = false;
}
/** Players whose games are missing or more than a day old: download them in the background. */
async function dailyDownloads() {
  if (!P?.me || navigator.onLine === false) return;
  for (const user of [P.me.user, ...P.opps.map((o) => o.user)]) {
    if (Date.now() - ((await cachedGames(user))?.fetched || 0) > DAY) queueDownload(user);
    else if (user !== P.me.user && (await reviewTodo(user)).length) queueReview(user); // new opponent data, or a review cut short last time
  }
}
/** A background download finished or failed: redraw the screen if it was waiting for it (never a board or a job in progress). */
function downloaded(user) {
  const [tab, arg] = (location.hash.slice(1) || 'me').split('/');
  if (document.activeElement?.matches('input, select, textarea')) return;
  if (tab === 'prep' && !arg) renderOppList();
  else if ($(`[data-dl="${user}"][data-empty]`)) route();
}

// ---------- automatic engine review of an opponent's newest games, after each download ----------
const AUTO_REVIEW = 20;                  // newest games reviewed per opponent (about 10 s each)
const reviewing = {};                    // user -> [game, of] while their review runs
const reviewQueue = [];                  // opponents waiting for the engine
const reviewFailed = new Set();          // games Stockfish couldn't review: not tried again until the next launch
let reviewDraining = false;
const reviewPending = (user) => !!reviewing[user] || reviewQueue.includes(user);
const rvText = (user) => reviewing[user] ? `Analyzing game ${reviewing[user][0] + 1} of ${reviewing[user][1]}…` : 'Waiting to analyze…';
const studiedText = (n) => `${n.toLocaleString()} of their games studied`;
/** Their newest games Stockfish hasn't reviewed yet. */
async function reviewTodo(user) {
  const gs = (await gamesOf(user)) || [], cache = await reviewCache(user);
  return gs.slice(0, AUTO_REVIEW).filter((g) => !cache[g.url] && g.sans.length >= 10);
}
/** Review an opponent's newest games in the background, one opponent after another (the engine runs one job at a time). */
function queueReview(user) {
  if (!P?.opps.some((o) => o.user === user) || reviewPending(user) || reviewFailed.has(user)) return;
  reviewQueue.push(user);
  if (!reviewDraining) runReviews();
}
async function runReviews() {
  reviewDraining = true;
  while (reviewQueue.length) {
    const user = reviewQueue[0];
    try {
      if (P?.opps.some((o) => o.user === user) && (await reviewTodo(user)).length) {
        const gs = (await gamesOf(user)).slice(0, AUTO_REVIEW);
        await whileAwake(() => reviewGames(user, gs, AUTO_REVIEW, (i, n) => { reviewing[user] = [i, n]; if (i < n) showReview(user, rvText(user)); }));
        if ((await reviewTodo(user)).length) reviewFailed.add(user); // some games failed twice
      }
    } catch { reviewFailed.add(user); }
    delete reviewing[user]; reviewQueue.shift(); reviewDone(user);
  }
  reviewDraining = false;
}
/** Status of an opponent's review, for the elements showing it. */
async function rvStatus(user) {
  if (reviewPending(user)) return rvText(user);
  const n = reviewedCount((await gamesOf(user)) || [], await reviewCache(user));
  return n ? studiedText(n) : '';
}
function showReview(user, text) {
  document.querySelectorAll(`[data-rv="${user}"]`).forEach((el) => { el.textContent = text; el.hidden = !text; });
}
/** A review finished: redraw the list, or update the line on their file. */
async function reviewDone(user) {
  const [tab, arg] = (location.hash.slice(1) || 'me').split('/');
  if (tab === 'prep' && !arg && !document.activeElement?.matches('input, select, textarea')) renderOppList();
  else showReview(user, await rvStatus(user));
}

async function sync(user, btn, statusEl) {
  const label = btn?.textContent;
  if (btn) btn.disabled = true;
  try {
    if (statusEl && !statusEl.textContent.startsWith('Downloading')) statusEl.textContent = 'Downloading…';
    await download(user);
    return true;
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<span class="warn">${e.code === 404 ? `chess.com has no player called ${esc(user)}.` : "Couldn't reach chess.com. Check your connection and try again."}</span>`;
    return false;
  } finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

// ---------- shared UI ----------
// ⓘ explaining what "scores X%" means; the note sits right after the element holding the button
const scoreInfo = (id) => `<button class="info-btn" type="button" aria-expanded="false" aria-controls="${id}" aria-label="What does 'scores' mean?">ⓘ</button>`;
const scoreNote = (id) => `<div class="info-note" id="${id}" hidden><p><b>Score</b> is the share of points a player earned: a win counts 1, a draw ½, a loss 0.
  "Scores 43%" means 43 points out of every 100 games, for example 40 wins and 6 draws.</p>
  <p>50% is even. For an opponent, lower is better for you; for you, higher is better. Opponents' scores come from their downloaded games against everyone, not just you.</p>
  <p>Check the number of games next to it: a score from a dozen games is a hint, one from hundreds is solid.</p></div>`;

// status under "Games" once a download has run; the list can be empty (no games in recent archives)
const gamesLine = (gs, pr, synced) => `${gs.length ? `${gs.length.toLocaleString()} games since ${dateOf(pr.since)}` : 'No games found'} · updated ${ago(synced)}`;

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

// ---------- first run: welcome, new user, existing user ----------
/** A strip of board: you (white king) facing your next opponent (black knight). Pieces from pieces.js. */
function heroSvg() {
  const sq = (i) => `<rect x="${i * 45}" width="45" height="45" class="${i % 2 ? 'hero-dk' : 'hero-lt'}"/>`;
  return `<svg class="hero" viewBox="0 0 225 66" aria-hidden="true" focusable="false">
    ${[0, 1, 2, 3, 4].map(sq).join('')}
    <path d="M52 22.5h112" class="hero-path"/><path d="M160 17l7 5.5-7 5.5" class="hero-path"/>
    <g>${PIECES.K}</g><g transform="translate(180 0)">${PIECES.n}</g>
    <text x="22.5" y="61" class="hero-lbl">You</text><text x="202.5" y="61" class="hero-lbl">Them</text></svg>`;
}

function renderWelcome() {
  view.innerHTML = `
    <header class="head welcome">${heroSvg()}<p class="eyebrow">Welcome to Checkmate Prep</p><h1>Prepare for your next opponent</h1>
      <p class="lede">Checkmate Prep studies the chess.com games of the people you're about to play (a friend, a club rival, your next tournament pairing) and turns them into a game plan: the openings they play, where they go wrong, and traps to set.</p></header>
    <div class="choices"><a class="btn primary" href="#start">I'm new here</a><div id="account-slot" data-mode="welcome"></div></div>`;
  renderAccount();
}

function renderSignIn() {
  view.innerHTML = `
    <a class="back" href="#">◀ Back</a>
    <header class="head"><p class="eyebrow">Existing account</p><h1>Welcome back</h1>
      <p class="lede">Sign in to bring your opponents, names and drill progress to this device. Your games are downloaded again from chess.com.</p></header>
    <div id="account-slot" data-mode="signin"></div>`;
  renderAccount();
}

// ---------- setup ----------
async function renderSetup(first = false) {
  const me = P?.me;
  const head = first
    ? `<a class="back" href="#">◀ Back</a>
    <header class="head"><p class="eyebrow">Step 1 of 3</p><h1>Get started</h1></header>
    <section class="card"><h2>How it works</h2><ol class="steps">
      <li class="now"><div><b>Your chess.com username.</b> We download your public games to see how you play. No sign-up, no password.</div></li>
      <li><div><b>Add the people you'll play.</b> Friends, rivals, anyone on chess.com. Their games are public too.</div></li>
      <li><div><b>Get your prep.</b> Their favourite openings, weak lines, traps and drills, all worked out on this device.</div></li></ol></section>`
    : `<header class="head"><h1>Settings</h1><p class="lede">Change your username or the opponents you prepare for.</p></header>`;
  const youCard = `<section class="card">${me ? '<h2>You</h2>' : ''}
      <form id="me-form" class="add-form"><label for="me-input"><b>Your chess.com username</b></label>
        <div class="row"><input id="me-input" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(me?.username || '')}" placeholder="e.g. hikaru" required><button class="btn primary">${me ? 'Change' : 'Continue'}</button></div>
        <p class="small" id="me-status" aria-live="polite"></p></form>
      <label for="me-name"><b>Your name</b>${me ? '' : ' <span class="muted small">(optional)</span>'}</label>
      <input id="me-name" autocomplete="off" value="${esc(me?.name || '')}" placeholder="e.g. Alex" aria-describedby="me-name-status">
      ${me ? '<p class="small muted" id="me-name-status" aria-live="polite">Shown at the top of your You page.</p>' : ''}</section>`;
  const oppCard = me ? `<section class="card"><h2>Opponents</h2>
      ${P.opps.length ? `<ul class="plain opp-edit">${P.opps.map((o) => `<li>
        <div class="row"><input id="name-${esc(o.user)}" data-name="${esc(o.user)}" value="${esc(hasAlias(o.user) ? displayName(o.user) : '')}" placeholder="Add a name" aria-label="Name for ${esc(o.username)}" autocomplete="off">
          <button class="btn" data-remove="${esc(o.user)}" aria-label="Remove ${esc(o.username)}">Remove</button></div>
        <a class="small muted" href="#prep/${esc(o.user)}">chess.com/${esc(o.username)}</a></li>`).join('')}</ul>
      <p class="small muted" id="name-status" aria-live="polite">Names are only shown in this app.</p>` : '<p class="muted">No opponents yet.</p>'}
      <a class="add-link" href="#add">＋ Add opponent</a>
    </section>` : '';
  view.innerHTML = `
    ${head}
    ${youCard + oppCard}
    <div id="account-slot"${me ? '' : ' data-mode="setup"'}></div>
    ${me ? '<div id="stats-slot"></div>' : ''}`;

  renderAccount();
  renderStatsToggle();
  $('#me-form').onsubmit = async (e) => {
    e.preventDefault();
    const user = $('#me-input').value.trim().toLowerCase(); if (!user) return;
    const st = $('#me-status'); st.dataset.dl = user; st.textContent = 'Downloading your games from chess.com…';
    if (!(await sync(user, e.submitter, st))) return;
    const info = ls.get(`player:${user}`);
    const opps = P?.opps || [];
    // first run for the player this app's hand-written prep was made for: add those opponents
    if (!P && PREP.me?.user === user) for (const f of PREP.friends) opps.push({ user: f.user, username: f.user, name: f.name });
    const name = $('#me-name').value.trim();
    P = { me: { user, username: info.username, ...(name ? { name } : {}) }, opps };
    ls.set('profile', P);
    dailyDownloads(); // opponents that came with it (hand-written prep) download in the background
    if (first) location.hash = opps.length ? 'me' : 'add'; else renderSetup();
  };
  if (!me) return;
  $('#me-name').onchange = (e) => {
    P.me.name = e.target.value.trim(); ls.set('profile', P);
    $('#me-name-status').textContent = P.me.name ? `Saved. Your You page shows "${P.me.name}".` : 'Saved. Your You page shows "You".';
  };
  $('#me-name').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
  view.querySelectorAll('[data-name]').forEach((inp) => {
    inp.onchange = () => {
      const o = P.opps.find((x) => x.user === inp.dataset.name); if (!o) return;
      o.name = inp.value.trim(); ls.set('profile', P);
      $('#name-status').textContent = o.name ? `Saved: ${o.username} is shown as ${o.name}.` : `Saved: ${o.username} is shown by username.`;
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
  });
  view.querySelectorAll('[data-remove]').forEach((b) => { b.onclick = () => { P.opps = P.opps.filter((o) => o.user !== b.dataset.remove); ls.set('profile', P); renderSetup(); }; });
}

// ---------- add an opponent ----------
/** People you've played at least twice who aren't opponents yet, most games first: [[user, games]]. */
async function suggestedOpponents() {
  const count = {};
  for (const g of (await gamesOf(P.me.user)) || []) count[g.opp.toLowerCase()] = (count[g.opp.toLowerCase()] || 0) + 1;
  return Object.entries(count).filter(([u, n]) => n >= 2 && !P.opps.some((o) => o.user === u) && u !== P.me.user)
    .sort((a, b) => b[1] - a[1]).slice(0, 6);
}

/** Look the player up on chess.com, add them to your opponents and open their file. */
async function addOpponent(user, name, st) {
  user = user.trim().toLowerCase(); name = name.trim();
  if (!user) return;
  if (user === P.me.user) { st.innerHTML = '<span class="warn">That\'s your own username.</span>'; return; }
  if (P.opps.some((o) => o.user === user)) { st.innerHTML = `<span class="warn">${esc(displayName(user))} is already in your list.</span> <a href="#prep/${esc(user)}">Open their file</a>`; return; }
  st.textContent = `Looking up ${user}…`;
  try {
    const info = await player(user);
    ls.set(`player:${user}`, info);
    P.opps.push({ user, username: info.username, ...(name ? { name } : {}) }); ls.set('profile', P);
    queueDownload(user);
    location.hash = `prep/${user}`;
  } catch (e) { st.innerHTML = `<span class="warn">${e.code === 404 ? `chess.com has no player called ${esc(user)}.` : "Couldn't reach chess.com."}</span>`; }
}

async function renderAddOpp() {
  const step2 = !P.opps.length;
  const suggestions = await suggestedOpponents();
  view.innerHTML = `
    ${step2 ? '' : '<a class="back" href="#prep">◀ Opponents</a>'}
    <header class="head">${step2 ? '<p class="eyebrow">Step 2 of 3</p><h1>Who do you want to prepare for?</h1>' : '<h1>Add an opponent</h1>'}
      <p class="lede">Someone you'll play: a friend, a club rival or your next opponent. The app reads their public chess.com games and builds a file on them.</p></header>
    <section class="card"><form id="opp-form" class="add-form">
      <label for="opp-input"><b>Their chess.com username</b></label>
      <input id="opp-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. hikaru" required>
      <label for="opp-name"><b>Nickname</b> <span class="muted small">(optional)</span></label>
      <input id="opp-name" autocomplete="off" placeholder="e.g. Sam" aria-describedby="opp-name-help">
      <p class="small muted" id="opp-name-help">Shown in this app instead of the username. Only you see it.</p>
      <button class="btn primary">Add opponent</button>
      <p class="small" id="opp-status" aria-live="polite"></p></form></section>
    ${suggestions.length ? `<section class="card"><h2>People you've played most</h2><p class="small muted">Tap to add. The number is how many games you've played them.</p>
      <div class="chips">${suggestions.map(([u, n]) => `<button class="chip" data-add="${esc(u)}">${esc(u)} <span class="muted">${n}</span></button>`).join('')}</div></section>` : ''}`;
  $('#opp-form').onsubmit = (e) => { e.preventDefault(); addOpponent($('#opp-input').value, $('#opp-name').value, $('#opp-status')); };
  view.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => addOpponent(b.dataset.add, '', $('#opp-status')); });
  if (!step2) $('#opp-input').focus();
}

/** Settings: turn usage stats (track.js) on or off. Only where they're sent: a server with /api. */
function renderStatsToggle() {
  const slot = $('#stats-slot');
  if (!slot) return;
  if (!hasApi) { slot.innerHTML = ''; return; }
  slot.innerHTML = `<section class="card"><label class="toggle"><input type="checkbox" id="usage-stats" ${sharing() ? 'checked' : ''}><b>Share usage stats</b></label>
      <p class="small muted">Which screens are opened and when, with a random id for this device (and your account when signed in), to see how the app is used. Never your games, usernames or opponents. Kept 3 months.</p></section>`;
  $('#usage-stats').onchange = (e) => setSharing(e.target.checked);
}

// ---------- account (sync.js): the same opponents, names and drill progress on every device ----------
function renderAccount() {
  const slot = $('#account-slot');
  if (!slot) return;
  const mode = slot.dataset.mode;
  const err = account.error ? `<p class="small warn" role="alert">${esc(account.error)}</p>` : '';
  // Signed in, but not set up on this device yet: say whose account it is, and offer a way out.
  const who = `<p class="small">Signed in${account.email ? ` as <b>${esc(account.email)}</b>` : ''}. <button class="link-btn" data-acct="signout">Sign out</button></p>`;
  if (mode === 'welcome') slot.innerHTML = !account.enabled ? '' : account.signedIn ? who : '<a class="btn" href="#signin">I already have an account</a>';
  else if (mode === 'setup') slot.innerHTML = account.enabled && account.signedIn ? `<section class="card">${who}<p class="small muted">Once you're set up, your opponents, names and drill progress sync to this account.</p>${err}</section>` : '';
  else if (mode === 'signin') {
    if (!account.enabled) slot.innerHTML = '<p class="muted">Sign-in isn\'t available here. <a href="#">Set up without an account</a>.</p>';
    else if (!account.signedIn) slot.innerHTML = `<button class="btn primary" data-acct="signin">Sign in</button>${err}`;
    else slot.innerHTML = `<section class="card">${who}
      ${account.busy || (!account.at && !account.error) ? '<p class="small muted" aria-live="polite">Getting your data…</p>' : '<p>Nothing is saved on this account yet.</p><a class="btn primary" href="#start">Set up as a new user</a>'}${err}</section>`;
  } else if (!account.signedIn) {
    // Without an account, everything lives on this device: offer to delete it and start again.
    slot.innerHTML = `${account.enabled ? `<section class="card"><h2>Your devices</h2>
        <p class="small muted">Sign in to use the app on your phone and laptop with the same opponents, names and drill progress. Games and engine results stay on each device; they're downloaded again on the others.</p>
        <button class="btn primary" data-acct="signin">Sign in</button>${err}</section>` : ''}
      <section class="card"><details><summary><b>Delete account</b></summary><div class="details-body">
        <p class="small muted">You're not signed in, so everything is on this device only: your username, opponents, names, downloaded games and drill progress. Deleting removes it all and starts again from the welcome screen. It can't be undone.</p>
        <button class="btn" data-acct="forget">Delete everything on this device</button></div></details></section>`;
  } else {
    const when = account.busy ? 'Syncing…' : account.at ? `Synced ${ago(account.at)}.` : 'Not synced yet.';
    slot.innerHTML = `<section class="card"><h2>Your account</h2>
        <p class="small">Signed in${account.email ? ` as <b>${esc(account.email)}</b>` : ''}. Your opponents, names and drill progress sync to your other devices.</p>
        <p class="small muted" aria-live="polite">${when}</p>${err}
        <div class="row"><button class="btn" data-acct="sync" ${account.busy ? 'disabled' : ''}>Sync now</button><button class="btn" data-acct="signout">Sign out</button></div>
        <details><summary class="small">Delete account</summary><div class="details-body">
          <p class="small muted">Deletes your opponents, names and drill progress from the server, then signs you out. Data is also deleted from this device.</p>
          <button class="btn" data-acct="delete">Delete account</button></div></details></section>`;
  }
  slot.querySelectorAll('[data-acct]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      const act = b.dataset.acct;
      if (act === 'signin') await signIn();
      if (act === 'sync') await syncNow();
      if (act === 'signout') await signOut();
      if (act === 'delete') await deleteSynced();
      if (act === 'forget') await forgetDevice();
      renderAccount();
    };
  });
}
/** Synced data arrived from another device: pick it up, and redraw lists (not a board or a job in progress). */
function syncedDataArrived() {
  const was = P;
  P = ls.get('profile', null);
  dailyDownloads();
  const tab = (location.hash.slice(1) || 'me').split('/');
  const typing = document.activeElement?.matches('input, select, textarea');
  if (!was?.me || (!typing && ((tab[0] === 'setup') || (tab[0] === 'prep' && !tab[1]) || (tab[0] === 'drill' && !tab[1])))) route();
}

// ---------- auto profile text ----------
function describe(pr, you) {
  const they = you ? 'You' : 'They', their = you ? 'your' : 'their';
  const out = [];
  const tcs = Object.entries(pr.byTc);
  if (tcs.length) out.push(`${they} play mostly ${tcs.slice(0, 2).map(([tc, x]) => `${TC[tc].toLowerCase()} (${x.n} games, scoring ${x.score}%)`).join(' and ')} in this sample.`);
  const fm = pr.firstMove.reduce((a, x) => a + x.n, 0);
  if (fm) out.push(`As White: ${pr.firstMove.slice(0, 3).map((m) => `1.${m.san} in ${Math.round((100 * m.n) / fm)}% (scores ${m.score}%)`).join(', ')}.`);
  if (pr.vsE4.length) out.push(`Against 1.e4: ${pr.vsE4.map((m) => `1…${m.san} ×${m.n} (${m.score}%)`).join(', ')}.`);
  if (pr.vsD4.length) out.push(`Against 1.d4: ${pr.vsD4.map((m) => `1…${m.san} ×${m.n} (${m.score}%)`).join(', ')}.`);
  if (pr.onTimePct >= 25) out.push(`${pr.onTimePct}% of ${their} decisive games end on the clock, so the clock is a big part of ${their} game.`);
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
    <p class="eyebrow">They have ${color === 'white' ? 'White' : 'Black'}</p>
    <p><b class="mono">${fig(numbered([...t.path, t.played]))}</b></p>
    <p class="small">They play ${fig(t.played)} here in <b>${t.times} of ${t.of}</b> games and scores ${t.score}%. Stockfish: ${t.bestForHim ? `${fig(t.bestForHim)} was better. ` : ''}After ${fig(t.played)} their winning chances drop by about ${t.drop} points.</p>
    <div data-trap="${key}">${viewerHtml(`Punish with ${fig(t.punish[0] || '?')}. Gold moves are the engine's line.`)}</div>
    <button class="btn primary" data-drill="trap:${esc(user)}:${color}:${key.split(':')[1]}">Drill it</button></article>`;
}

// ---------- AI-written prep (worker/prep.js writes it; only when the app is served by the Worker) ----------
const aiCached = (user) => idb.get(`aiprep:${user}`);
/** AI text is untrusted: escape everything, then allow back the <b> tags the prompt permits. */
const rich = (s) => fig(esc(s).replace(/&lt;(\/?)b&gt;/g, '<$1b>'));
/** Keep the legal part of a plan's line, so a wrong move from the model can't break the board or the drill. */
function aiPlan(p) {
  const game = new Chess(), sans = [];
  for (const s of String(p.line || '').split(/\s+/).filter(Boolean)) { try { sans.push(game.move(s).san); } catch { break; } }
  const line = sans.length >= 2 ? sans.join(' ') : '';
  return { ...p, line, flip: p.you_play === 'black', key_from: line ? Math.max(0, Math.min(sans.length - 1, p.key_from | 0)) : null };
}
/** Opening tree as a list of the most-played lines (from the tree owner's point of view). */
function treeLines(tree, { depth = 10, max = 40 } = {}) {
  const minN = Math.max(5, Math.round(tree.n * 0.03)), out = [];
  const visit = (node, path) => {
    for (const [san, c] of Object.entries(node.c || {})) {
      if (c.n < minN || path.length >= depth) continue;
      out.push({ moves: [...path, san], n: c.n, score: pct(c.p, c.n) });
      visit(c, [...path, san]);
    }
  };
  visit(tree, []);
  return out.sort((a, b) => b.n - a.n).slice(0, max).map((l) => ({ line: numbered(l.moves), games: l.n, score: l.score }));
}
/** The statistics sent to the Worker. Deterministic for the same data, so the Worker can cache the plan. */
async function aiPayload(user) {
  const brief = (pr) => pr && ({ games: pr.n, byTimeControl: pr.byTc, asWhiteFirstMove: pr.firstMove, vs1e4: pr.vsE4, vs1d4: pr.vsD4,
    openingsByName: pr.openings, howDecisiveGamesEnd: pr.ends, decisiveGamesLostOrWonOnTimePct: pr.onTimePct, scoreByGameLength: pr.lengthScore, castling: pr.castling });
  const bad = (tree, minN) => weakLines(tree, { minN }).map((l) => ({ line: numbered(l.moves), games: l.n, score: l.score }));
  const trap = (t) => ({ line: numbered([...t.path, t.played]), theyPlayIt: `${t.times} of ${t.of} games`, theirScoreAfter: t.score,
    engineBetterMove: t.bestForHim, winChanceDrop: t.drop, punishingLine: numbered(t.punish, t.path.length + 1) });
  const ratings = (u) => Object.fromEntries(Object.entries(ls.get(`player:${u}`, null)?.ratings || {}).map(([tc, r]) => [tc, { rating: r.r, wins: r.w, losses: r.l, draws: r.d }]));
  const me = P.me.user, mine = (await gamesOf(me)) || [], theirs = (await gamesOf(user)) || [];
  const [tw, tb, mw, mb, trW, trB] = await Promise.all([treeOf(user, 'white'), treeOf(user, 'black'), treeOf(me, 'white'), treeOf(me, 'black'),
    cachedTraps(user, 'white'), cachedTraps(user, 'black')]);
  return {
    note: 'Scores are percentages from that player\'s point of view (win 100, draw 50). "line" uses normal move numbers.',
    me: { user: me, ratings: ratings(me), profile: mine.length ? brief(profile(mine)) : null, badLines: { asWhite: bad(mw, 4), asBlack: bad(mb, 4) } },
    opp: { user, name: displayName(user), ratings: ratings(user), profile: theirs.length ? brief(profile(theirs)) : null,
      mostPlayedLines: { asWhite: treeLines(tw), asBlack: treeLines(tb) }, badLines: { asWhite: bad(tw, 8), asBlack: bad(tb, 8) },
      engineTraps: trW || trB ? { asWhite: (trW || []).map(trap), asBlack: (trB || []).map(trap) } : 'not searched yet' },
    headToHead: mine.filter((g) => g.opp.toLowerCase() === user).slice(0, 20).map((g) => ({ date: new Date(g.t * 1000).toISOString().slice(0, 10),
      timeControl: g.tc, youHad: g.color, result: ['loss', 'draw', 'win'][g.pts], how: g.how, opening: g.eco, moves: numbered(g.sans.slice(0, 16)) })),
  };
}
function plansHtml(plans, prefix, user) {
  return plans.map((p, i) => `<details${i === 0 ? ' open' : ''}><summary><span class="eyebrow">${esc(p.eyebrow)}</span><br><b>${rich(p.title)}</b></summary>
    <div class="details-body">${p.line ? `<div data-line="${prefix}${i}">${viewerHtml(p.caption && rich(p.caption))}</div>` : ''}${p.body.map((b) => `<p>${rich(b)}</p>`).join('')}
    ${p.line ? `<button class="btn primary" data-drill="${prefix}line:${esc(user)}:${i}">Drill this line</button>` : ''}</div></details>`).join('');
}
function mountPlans(plans, prefix) {
  plans.forEach((p, i) => { const host = $(`[data-line="${prefix}${i}"]`, view); if (host) lineViewer(host, p.line.split(' '), !!p.flip, p.key_from); });
}
function aiSection(user, saved, canWrite, hasGames, writing, error) {
  if (!saved && !canWrite) return '';
  const plan = saved?.plan;
  const plans = plan ? plan.plans.map(aiPlan) : [];
  return `<section class="card ai" id="ai"><p class="eyebrow">AI-written prep</p><h2>${plan ? 'AI plan' : 'Write a plan with AI'}</h2>
    ${plan ? `<p>${rich(plan.summary)}</p>${plansHtml(plans, 'ai', user)}
      <details><summary><b>Where they go wrong</b></summary><div class="details-body"><ul>${plan.weak.map((x) => `<li>${rich(x)}</li>`).join('')}</ul></div></details>
      <details><summary><b>Game-day checklist</b></summary><div class="details-body"><ol>${plan.checklist.map((x) => `<li>${rich(x)}</li>`).join('')}</ol></div></details>
      <p class="small muted">Written ${ago(saved.at)} by Claude from ${saved.games.toLocaleString()} of their games. Check the lines on the board before relying on them.</p>`
    : `<p class="small muted">Claude reads the statistics on this page, and any traps Stockfish found, and writes a plan like the hand-written ones.${hasGames ? ' Find traps first for a better plan.' : ''}</p>`}
    ${canWrite ? `<button class="btn${plan ? '' : ' primary'}" id="ai-write" ${hasGames && !writing ? '' : 'disabled'}>${plan ? 'Rewrite with the latest games' : 'Write the plan'}</button>
      ${writing ? `${progress('ai-progress')}<p class="ai-thought" id="ai-thought" hidden></p>` : ''}
      <p class="small muted" id="ai-status" aria-live="polite">${writing ? 'Takes about a minute. You can leave or close the app: the plan will be here when you come back.'
        : error ? `<span class="warn">${esc(error)}</span>` : hasGames ? (plan ? '' : 'Takes about a minute.') : 'Download their games first.'}</p>` : ''}</section>`;
}
// The Worker writes a plan in the background and the app asks for it every few seconds, so leaving the
// page, or closing the app, loses nothing: jobs are kept in localStorage and picked up again on the next start.
const AI_POLL = 4000, AI_GIVE_UP = 20 * 60 * 1000;
const aiJobs = () => ls.get('aijobs', {});
const aiWaits = {}, aiErrors = {}, aiStarting = {}, aiProgress = {};
const aiWriting = (user) => !!(aiStarting[user] || aiJobs()[user]);
function setAiJob(user, job) {
  const jobs = aiJobs();
  if (job) jobs[user] = { job, at: Date.now() }; else delete jobs[user];
  ls.set('aijobs', jobs);
}
/** Redraw whichever screen shows this opponent's AI prep, once it has changed. */
function aiChanged(user) {
  if (location.hash === `#prep/${user}`) renderOpp(user).then(() => { if (!aiErrors[user]) $('#ai')?.scrollIntoView(); });
  else if (location.hash === '#prep') renderOppList();
}
async function writeAi(user) {
  delete aiErrors[user];
  aiStarting[user] = true;
  try {
    const r = await fetch('api/prep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(await aiPayload(user)) });
    const out = await r.json().catch(() => ({}));
    if (out.plan) await saveAi(user, out.plan); // written before for the same games: no wait, no cost
    else if (r.ok && out.job) setAiJob(user, out.job);
    else aiErrors[user] = out.error || `The server answered ${r.status}.`;
  } catch {
    aiErrors[user] = "Couldn't reach the server. Check your connection.";
  }
  delete aiStarting[user];
  if (aiJobs()[user]) waitAi(user); else aiChanged(user);
}
async function saveAi(user, plan) {
  await idb.set(`aiprep:${user}`, { plan, at: Date.now(), games: ((await gamesOf(user)) || []).length });
}
/** Wait for a user's job to finish (one loop per job, however often it's asked), then save the plan or the error. */
function waitAi(user) {
  if (aiWaits[user]) return;
  const tick = setInterval(() => paintAi(user), 1000);
  aiWaits[user] = (async () => {
    for (;;) {
      const j = aiJobs()[user];
      if (!j) return;
      if (Date.now() - j.at > AI_GIVE_UP) { aiErrors[user] = 'The plan took too long. Try again.'; break; }
      let out;
      try { out = await (await fetch(`api/prep?job=${encodeURIComponent(j.job)}`)).json(); } catch { out = { pending: true }; } // offline for a moment: keep waiting
      if (out.pending) {
        if (out.progress) aiProgress[user] = out.progress;
        paintAi(user);
        await new Promise((r) => setTimeout(r, AI_POLL));
        continue;
      }
      if (out.plan) await saveAi(user, out.plan); else aiErrors[user] = out.error || 'The AI service failed. Try again later.';
      break;
    }
    setAiJob(user, null);
  })().finally(() => { clearInterval(tick); delete aiWaits[user]; delete aiProgress[user]; aiChanged(user); });
}
/** Where the writing is, from the Worker's progress: bar position (0-100) and what to say. */
function aiStage(user) {
  const p = aiProgress[user];
  if (aiStarting[user] || !p) return [5, aiStarting[user] ? 'Sending their statistics' : 'Starting'];
  if (p.stage === 'thinking') return [35, 'Thinking'];
  if (p.stage === 'writing') {
    if (p.section === 'checklist') return [96, 'Writing the game-day checklist'];
    if (p.section === 'weak') return [92, 'Listing where they go wrong'];
    return [Math.min(90, 60 + 8 * (p.plans || 0)), `Writing the plan: line ${Math.max(1, p.plans || 0)}`];
  }
  return [10, 'Reading their statistics'];
}
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** Update the opponent's AI card in place while a plan is written (a full redraw would rebuild the boards). */
function paintAi(user) {
  if (location.hash !== `#prep/${user}`) return;
  const bar = $('#ai-progress'), thought = $('#ai-thought');
  if (!bar) return;
  const [pct, text] = aiStage(user);
  setProgress(bar, pct, 100, `${text} · ${clock(Date.now() - (aiJobs()[user]?.at || Date.now()))}`);
  const t = aiProgress[user]?.thought;
  if (thought) { thought.hidden = !t; thought.textContent = t || ''; } // textContent: Claude's words are shown as text, never as HTML
}
/** At start: pick up plans that were still being written when the app closed. */
function resumeAi() { Object.keys(aiJobs()).forEach(waitAi); }

// ---------- opponent file ----------
async function renderOpp(user) {
  if (!P.opps.length) {
    view.innerHTML = '<header class="head"><h1>Prepare your next games</h1><p class="lede">Add the people you play to get a file on each of them.</p></header><a class="btn primary" href="#add">Add an opponent</a>';
    return;
  }
  if (!P.opps.some((o) => o.user === user)) return renderOppList();
  ls.set('opp', user);
  const cur = curated(user);
  const gs = await gamesOf(user);
  const synced = (await cachedGames(user))?.fetched;
  const pr = gs?.length ? profile(gs) : null;
  const [tw, tb] = await Promise.all([treeOf(user, 'white'), treeOf(user, 'black')]);
  const [scW, scB, ai] = await Promise.all([trapScan(user, 'white', tw), trapScan(user, 'black', tb), aiCached(user)]);
  const trW = scW?.traps || null, trB = scB?.traps || null;
  // a scan is out of date once their games change (after a Refresh); its traps stay shown until it is redone
  const scanned = !!(scW || scB), current = !!(scW?.current && scB?.current);
  // positions a scan checks: counted by an up-to-date scan, else what a scan of today's games would check
  const checked = current ? scW.checked + scB.checked : trapCandidates(tw, 'white').length + trapCandidates(tb, 'black').length;
  const tooFew = !!(tw.n + tb.n) && !checked;
  const [myW, myB] = await Promise.all([treeOf(P.me.user, 'white'), treeOf(P.me.user, 'black')]);
  // head-to-head from both downloads: yours go further back than a busy opponent's latest 1,500
  const h2h = headToHead(await gamesOf(P.me.user), gs, user, P.me.user);
  const r = h2h.rec; // your wins, draws, losses
  const name = oppName(user);
  const rvLine = await rvStatus(user);
  view.innerHTML = `
    <a class="back" href="#prep">◀ Opponents</a>
    <header class="head"><h1>${esc(displayName(user))}</h1><a class="eyebrow profile-link" href="https://www.chess.com/member/${encodeURIComponent(name)}" target="_blank" rel="noopener">chess.com/${esc(name)}</a>
      ${cur ? `<p class="lede">${fig(cur.summary)}</p>` : ''}</header>
    ${stats([...ratingStats(user), ...(h2h.n ? [[`${r[0]}–${r[1]}–${r[2]}`, 'Your record vs them (W–D–L)']] : [])])}
    <section class="card"><div class="row"><h2>Games</h2><button class="btn" id="sync">${gs ? 'Refresh' : 'Download games'}</button></div>
      <p class="small muted" id="sync-status" aria-live="polite" data-dl="${esc(user)}"${gs ? '' : ' data-empty'}>${pending(user) ? dlText(user) : gs ? gamesLine(gs, pr, synced) : 'Download their recent games to build their file (up to 12 months).'}</p>
      <p class="small muted" data-rv="${esc(user)}"${rvLine ? '' : ' hidden'}>${rvLine}</p></section>
    ${cur ? `<section class="card curated"><p class="eyebrow">Hand-written prep</p><h2>Coach's plan</h2>
      ${cur.plans.map((p, i) => `<details${i === 0 ? ' open' : ''}><summary><span class="eyebrow">${esc(p.eyebrow)}</span><br><b>${fig(p.title)}</b></summary>
        <div class="details-body"><div data-line="${i}">${viewerHtml(p.caption)}</div>${p.body.map((b) => `<p>${fig(b)}</p>`).join('')}
        <button class="btn primary" data-drill="line:${esc(user)}:${i}">Drill this line</button></div></details>`).join('')}
      <details><summary><b>Game-day checklist</b></summary><div class="details-body">${list(cur.checklist, 'ol')}</div></details></section>` : ''}
    ${aiSection(user, ai, AI, !!gs?.length, aiWriting(user), aiErrors[user])}
    ${planHtml(gs?.length ? gamePlan({ pr, tw, tb, trW, trB, myW, myB }) : null, user, cur, trW, trB)}
    ${pr ? `<section class="card"><h2>How they play</h2>${list(describe(pr, false))}</section>` : ''}
    <section class="card"><h2>Traps: moves they repeat that lose</h2>
      <p class="small muted">Stockfish checks the positions they reach most often and flags moves they keep playing that the engine refutes.</p>
      ${current || tooFew ? '' : `<button class="btn primary" id="traps" ${tw.n + tb.n ? '' : 'disabled'}>${scanned ? 'Check again with Stockfish' : 'Find traps with Stockfish'}</button><p class="small muted">${scanned ? 'Their games have changed since the last check. ' : ''}Takes 1–3 minutes. It runs on your device. Keep the app open.</p>`}
      ${progress('trap-progress')}
      <div id="trap-list">${trapsSection(user, trW, trB, { current, tooFew, checked, nW: tw.n, nB: tb.n })}</div></section>
    <section class="card"><h2>Lines that go badly for them ${scoreInfo('si-weak')}</h2>${scoreNote('si-weak')}
      <h3>When they're White</h3>${weakHtml(weakLines(tw), 'white', user)}
      <h3>When they're Black</h3>${weakHtml(weakLines(tb), 'black', user)}</section>
    ${cur ? `<section class="card curated"><p class="eyebrow">Hand-written prep</p><h2>Where they go wrong</h2>${list(cur.weak)}</section>` : ''}`;
  if (cur) cur.plans.forEach((p, i) => lineViewer($(`[data-line="${i}"]`, view), p.line.split(' '), !!p.flip, p.key_from));
  if (ai) mountPlans(ai.plan.plans.map(aiPlan), 'ai');
  mountTraps(trW, trB);
  view.querySelectorAll('[data-plan]').forEach((host) => { const pl = PLAN_LINES[host.dataset.plan]; if (pl) lineViewer(host, pl.line, pl.flipped, pl.keyFrom); });
  $('#ai-write')?.addEventListener('click', () => { writeAi(user); renderOpp(user); });
  if (aiJobs()[user]) waitAi(user);
  if (aiWriting(user)) paintAi(user);
  if (!ls.get(`player:${user}`, null)) {
    player(user).then((info) => { ls.set(`player:${user}`, info); if (location.hash === `#prep/${user}`) renderOpp(user); }).catch(() => {});
  }
  $('#sync').onclick = async (e) => { if (await sync(user, e.currentTarget, $('#sync-status'))) renderOpp(user); };
  $('#traps')?.addEventListener('click', async (e) => {
    e.currentTarget.hidden = true;
    const bar = $('#trap-progress');
    const found = {};
    try {
      await whileAwake(async () => {
        for (const [color, tree] of [['white', tw], ['black', tb]]) {
          found[color] = await findTraps(user, tree, color, (i, n) => setProgress(bar, i, n, `Checking their positions as ${color === 'white' ? 'White' : 'Black'}: ${i} of ${n}`));
        }
      });
    } catch {
      $('p', bar).innerHTML = '<span class="warn">Stockfish stopped responding.</span> Close other apps or tabs, then reopen this page and try again.';
      return;
    }
    bar.hidden = true;
    renderOpp(user); // redraw so the game plan picks up the traps
  });
}
const PLAN_LINES = {};
function planHtml(plan, user, cur, trW, trB) {
  if (!plan) return `<section class="card"><h2>Game plan</h2><p class="small muted">Download their games to build a plan.</p></section>`;
  const part = (key, title, sidePlan, flipped, trapColor, trapList) => {
    if (!sidePlan.points.length) return '';
    PLAN_LINES[key] = sidePlan.line ? { line: sidePlan.line, flipped, keyFrom: sidePlan.keyFrom } : null;
    const ti = sidePlan.trap ? (trapList || []).indexOf(sidePlan.trap) : -1;
    return `<h3>${title}</h3>${list(sidePlan.points)}
      ${sidePlan.line ? `<div data-plan="${key}">${viewerHtml(sidePlan.trap ? 'Gold moves: their repeated mistake and the punishment.' : 'Gold moves: where they go wrong.')}</div>` : ''}
      ${ti >= 0 ? `<button class="btn primary" data-drill="trap:${esc(user)}:${trapColor}:${ti}">Drill the trap</button>` : ''}`;
  };
  const body = [
    part('white', 'When you have White', plan.white, false, 'black', trB),
    part('black', 'When you have Black', plan.black, true, 'white', trW),
    plan.manage.length ? `<h3>How to play the game</h3>${list(plan.manage)}` : '',
  ].join('');
  return `<section class="card plan-card"><h2>Game plan ${scoreInfo('si-plan')}</h2>${scoreNote('si-plan')}
    <p class="small muted">${cur ? 'Built automatically from their games. The hand-written plan above goes deeper.' : 'Built automatically from their games: every number is counted from their results.'}</p>
    ${body || '<p class="muted">Not enough games yet for a plan. Download more of their games.</p>'}
    ${plan.trapsChecked ? '' : '<p class="small muted">Tap <b>Find traps</b> below to add engine-checked traps to this plan.</p>'}</section>`;
}
/** Prep landing: every opponent as a row, with main rating, your record and what's been prepared. */
async function renderOppList() {
  if (!P.opps.length) {
    view.innerHTML = '<header class="head"><h1>Prepare your next games</h1><p class="lede">Add the people you play to get a file on each of them.</p></header><a class="btn primary" href="#add">Add an opponent</a>';
    return;
  }
  const mine = await gamesOf(P.me.user);
  const myRatings = ls.get(`player:${P.me.user}`, null)?.ratings || {};
  const plays = (r) => r.w + r.l + r.d;
  const rows = await Promise.all(P.opps.map(async (o) => {
    const info = ls.get(`player:${o.user}`, null);
    const main = Object.entries(info?.ratings || {}).sort((a, b) => plays(b[1]) - plays(a[1]))[0];
    const theirs = await gamesOf(o.user);
    const h2h = headToHead(mine, theirs, o.user, P.me.user);
    const traps = ((await cachedTraps(o.user, 'white')) || []).length + ((await cachedTraps(o.user, 'black')) || []).length;
    const studied = theirs ? reviewedCount(theirs, await reviewCache(o.user)) : 0;
    return { o, cur: curated(o.user), main, h2h, theirs, traps, info, studied, ai: !!(await aiCached(o.user)) };
  }));
  // most games against you first, then the most recent; no games together last, by name
  rows.sort((a, b) => b.h2h.n - a.h2h.n || b.h2h.last - a.h2h.last || displayName(a.o.user).localeCompare(displayName(b.o.user)));
  const ratingLine = ({ main }) => {
    if (!main) return '';
    const mineR = myRatings[main[0]]?.r;
    return `${TC[main[0]]} ${main[1].r}${mineR ? ` · you ${mineR}` : ''}`;
  };
  // no games found: say why, since it can mean the games aren't here yet rather than that you never played
  const vsLine = ({ o, h2h: { n, rec, p, last }, theirs }) => {
    if (n) return `${n} game${n > 1 ? 's' : ''} together · you won ${rec[0]}, lost ${rec[2]}, drew ${rec[1]} · ${pct(p, n)}% · last ${dateOf(last)}`;
    if (pending(P.me.user) || pending(o.user)) return 'Downloading games…';
    if (!mine && !theirs) return 'Games not downloaded yet';
    if (!mine) return 'Your games not downloaded yet';
    if (!theirs) return 'Their games not downloaded yet';
    return 'No games against you in the last 12 months';
  };
  view.innerHTML = `<header class="head"><div class="head-row"><h1>Prepare your next games</h1><a class="btn primary btn-sm" href="#add">＋ Add</a></div>
      <p class="lede">One file per opponent: the openings they play, where they go wrong, traps to set and a plan for your next game against them.</p>
      ${rows.some((r) => r.h2h.n) ? '<p class="small muted">Sorted by how many games you\'ve played each other.</p>' : ''}</header>
    <ul class="opps">${rows.map((r) => `<li><a href="#prep/${esc(r.o.user)}">
      <span class="opp-top"><b>${esc(displayName(r.o.user))}</b>${hasAlias(r.o.user) ? ` <span class="muted small">${esc(r.o.username)}</span>` : ''}<span class="chev" aria-hidden="true">›</span></span>
      ${ratingLine(r) ? `<span class="small">${ratingLine(r)}</span>` : ''}
      <span class="small muted">${vsLine(r)}</span>
      <span class="badges"><span class="badge">${r.theirs ? (r.theirs.length ? `${r.theirs.length.toLocaleString()} of their games downloaded` : 'No games in the last 12 months') : pending(r.o.user) ? 'Downloading…' : 'Not downloaded yet'}</span>${reviewPending(r.o.user) || r.studied ? `<span class="badge" data-rv="${esc(r.o.user)}">${reviewPending(r.o.user) ? rvText(r.o.user) : studiedText(r.studied)}</span>` : ''}${r.traps ? `<span class="badge trap-badge">${r.traps} trap${r.traps > 1 ? 's' : ''} found</span>` : ''}${r.cur ? '<span class="badge">Hand-written prep</span>' : ''}${aiWriting(r.o.user) ? '<span class="badge">Writing AI prep…</span>' : r.ai ? '<span class="badge">AI prep</span>' : ''}</span>
    </a></li>`).join('')}</ul>`;
  // ratings for opponents added without a lookup (e.g. the hand-written ones): fetch once, then redraw.
  // Redraw only if a lookup worked: offline, every lookup fails and redrawing would start them all again.
  const missing = rows.filter((r) => !r.info).map((r) => r.o.user);
  if (missing.length) {
    savePlayers(missing).then((saved) => { if (saved && (location.hash || '#me') === '#prep') renderOppList(); });
  }
}
function trapsSection(user, w, b, { current, tooFew, checked, nW, nB }) {
  const all = [...(w || []).map((t, i) => trapHtml(t, `white:${i}`, user, 'white')), ...(b || []).map((t, i) => trapHtml(t, `black:${i}`, user, 'black'))];
  if (all.length) return all.join('');
  const games = `${nW} game${nW === 1 ? '' : 's'} as White and ${nB} as Black`;
  if (tooFew) return `<p class="muted">Not enough games to look for traps. They have ${games}, and a trap needs the same position at least ${TRAP_MIN_N} times.</p>`;
  if (!current) return ''; // no scan of today's games yet: the button above runs one
  return `<p class="muted">Stockfish checked the ${checked} position${checked === 1 ? '' : 's'} they reach most often (from ${games}) and found no move they repeat that loses. ${checked < 5 ? 'That is a small sample: check again once they have played more games.' : 'Look at the lines where they score badly instead.'}</p>`;
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
  const people = [...P.opps.map((o) => [o.user, displayName(o.user)]), [P.me.user, 'You']];
  if (!people.some(([u]) => u === ex.user)) { ex.user = people[0][0]; ex.moves = []; }
  const isMe = ex.user === P.me.user;
  const who = isMe ? 'You' : displayName(ex.user);
  const game = new Chess();
  let last = null;
  try { for (const m of ex.moves) last = game.move(m); } catch { ex.moves = []; game.reset(); last = null; }
  const node = walk(await treeOf(ex.user, ex.color), ex.moves);
  const rows = Object.entries(node?.c || {}).map(([s, x]) => ({ s, n: x.n, sc: pct(x.p, x.n) })).sort((a, b) => b.n - a.n);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const theirTurn = game.turn() === (ex.color === 'white' ? 'w' : 'b');
  const noGames = !(await gamesOf(ex.user)) && !curated(ex.user) && !(isMe && PREP.me?.user === ex.user);
  view.innerHTML = `
    <label class="picker" for="ex-who"><span class="eyebrow">Exploring</span>
      <select id="ex-who">${people.map(([u, l]) => `<option value="${esc(u)}"${u === ex.user ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    ${seg('color', [['white', `${who} as White`], ['black', `${who} as Black`]], ex.color)}
    <div class="bd explore-bd"></div>
    <div class="path mono">${ex.moves.length ? fig(numbered(ex.moves)) : 'Starting position'}</div>
    <div class="nav"><button id="ex-back" ${ex.moves.length ? '' : 'disabled'}>◀ Back</button><button id="ex-reset" ${ex.moves.length ? '' : 'disabled'}>Reset</button></div>
    <p class="eyebrow">${theirTurn ? `${esc(who)} to move` : 'Opponent to move'} · ${total} games</p>
    ${rows.length ? `<ul class="moves">${rows.map((r) => `<li><button data-san="${esc(r.s)}"><span class="san">${fig(r.s)}</span>
        <span class="bar"><span style="width:${Math.round((100 * r.n) / total)}%"></span></span>
        <span class="num">${r.n}</span><span class="num sc ${r.sc >= 55 ? 'hi' : r.sc <= 45 ? 'lo' : ''}">${r.sc}%</span></button></li>`).join('')}</ul>
      <p class="muted small">Bar: how often each move was played. %: ${isMe ? 'your' : 'their'} score after it. ${scoreInfo('si-ex')} Tap a move to follow it, or play any move on the board.</p>${scoreNote('si-ex')}`
      : `<p class="muted">${noGames ? `No games downloaded for ${esc(who)} yet. Download them from the ${isMe ? 'You' : 'Prep'} tab.` : 'No games reach this position.'}</p>`}`;
  $('#ex-who').onchange = (e) => { ex.user = e.target.value; ex.moves = []; saveEx(); renderExplore(); };
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
        id: `trap:${o.user}:${color}:${i}`, group: `Traps vs ${displayName(o.user)}`, kind: 'pos',
        title: `${numbered([...t.path, t.played])}. Punish it.`, sub: `They play this in ${t.times} of ${t.of} games`,
        fen: t.afterFen, best: t.punish[0],
        prompt: `They just played ${t.played}, as they do in ${t.times} of ${t.of} games. Punish it.`,
        why: `Stockfish's line: ${numbered(t.punish, plyOf(t.afterFen))}`,
      }));
    }
    const cur = curated(o.user);
    if (cur) cur.plans.forEach((p, i) => out.push({ id: `line:${o.user}:${i}`, group: `Prepared lines vs ${displayName(o.user)}`, kind: 'line', title: p.title, sub: p.eyebrow, plan: p }));
    const ai = await aiCached(o.user);
    const plain = (t) => String(t || '').replace(/<\/?b>/g, '');
    ai?.plan.plans.map(aiPlan).forEach((p, i) => p.line && out.push({ id: `ailine:${o.user}:${i}`, group: `Prepared lines vs ${displayName(o.user)}`, kind: 'line',
      title: plain(p.title), sub: `${p.eyebrow} · AI-written`, plan: { ...p, caption: plain(p.caption) } }));
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
    <header class="head"><p class="eyebrow">${esc(x.group)}</p><h1 class="h-sm">${fig(esc(x.title))}</h1></header>
    <div class="bd drill-bd"></div><p class="msg" id="msg" aria-live="polite"></p>
    <div class="nav"><button id="restart">Restart</button><button id="hint">Hint</button></div>`;
  const msg = $('#msg');
  const board = new Board($('.drill-bd'), { game, flipped: mine === 'b' });
  const step = () => {
    const ply = game.history().length;
    if (ply >= sans.length) {
      msg.innerHTML = `<span class="ok">Line complete.</span> ${fig(esc(x.plan.caption || ''))}`;
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
    <header class="head"><h1>${esc(P.me.name || 'You')}</h1><a class="eyebrow profile-link" href="https://www.chess.com/member/${encodeURIComponent(P.me.username)}" target="_blank" rel="noopener">chess.com/${esc(P.me.username)}</a>
      ${cur ? `<p class="lede">${fig(cur.summary)}</p>` : ''}</header>
    ${stats(ratingStats(user))}
    <section class="card"><div class="row"><h2>Games</h2><button class="btn" id="sync">${gs ? 'Refresh' : 'Download games'}</button></div>
      <p class="small muted" id="sync-status" aria-live="polite" data-dl="${esc(user)}"${gs ? '' : ' data-empty'}>${pending(user) ? dlText(user) : gs ? gamesLine(gs, pr, synced) : 'Download your recent games to build your profile.'}</p></section>
    ${pr ? `<section class="card"><h2>Your game</h2>${list(describe(pr, true))}</section>` : ''}
    <section class="card"><h2>Engine review</h2>
      ${s?.reviewed ? `${stats([
        [`${ph.opening.blunders ?? '–'}`, 'Opening blunders per 100 moves'], [`${ph.middlegame.blunders ?? '–'}`, 'Middlegame blunders per 100 moves'],
        [`${ph.endgame.blunders ?? '–'}`, 'Endgame blunders per 100 moves'],
        [s.convert.games ? `${s.convert.pct}%` : '–', `Winning positions converted (${s.convert.games})`],
        [s.save.games ? `${s.save.pct}%` : '–', `Losing positions saved (${s.save.games})`],
        [s.punish.chances ? `${s.punish.pct}%` : '–', `Opponent blunders punished (${s.punish.chances})`]])}
        ${list(insights(s))}` : '<p class="small muted">Stockfish goes through your games move by move and finds where you lose the most. Your worst moments become puzzles in Drill.</p>'}
      <div class="row"><button class="btn primary" id="review" ${gs?.length ? '' : 'disabled'}>Review ${s?.reviewed ? '20 more' : 'my last 20'} games</button><button class="btn" id="stop" hidden>Stop</button></div>
      ${progress('review-progress')}
      <p class="small muted">${s?.reviewed ? `${s.reviewed} games reviewed. ` : ''}About 10 seconds per game. Keep the app open. Reviewed games are saved if you stop.</p></section>
    <section class="card"><h2>Lines that go badly for you ${scoreInfo('si-mine')}</h2>${scoreNote('si-mine')}
      <h3>As White</h3>${weakHtml(weakLines(tw, { minN: 4 }), 'white', user)}
      <h3>As Black</h3>${weakHtml(weakLines(tb, { minN: 4 }), 'black', user)}</section>
    ${cur ? `<section class="card curated"><p class="eyebrow">Hand-written notes</p><h2>Coach's notes</h2><h3>Strengths</h3>${list(cur.strengths)}<h3>Weaknesses</h3>${list(cur.weaknesses)}<h3>Training plan</h3>${list(cur.training, 'ol')}</section>` : ''}`;
  $('#sync').onclick = async (e) => { if (await sync(user, e.currentTarget, $('#sync-status'))) renderMe(); };
  const signal = { stop: false };
  $('#review').onclick = async (e) => {
    e.currentTarget.hidden = true; $('#stop').hidden = false;
    const bar = $('#review-progress');
    await whileAwake(() => reviewGames(user, gs, 20, (i, n, g) => setProgress(bar, i, n, g ? `Game ${i + 1} of ${n}: vs ${g.opp} (${g.tc})` : 'Done'), signal));
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
  track(screenOf(tab, arg, needSetup));
  document.body.classList.toggle('no-tabs', needSetup);
  document.querySelectorAll('.tabbar a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.tab === (tab === 'add' ? 'prep' : tab))));
  try {
    if (needSetup) await (tab === 'start' ? renderSetup(true) : tab === 'signin' ? renderSignIn() : renderWelcome());
    else if (tab === 'start' || tab === 'signin') location.replace('#me');
    else if (tab === 'setup') await renderSetup();
    else if (tab === 'add') await renderAddOpp();
    else if (tab === 'explore') await renderExplore();
    else if (tab === 'drill') await (arg ? renderDrill(decodeURIComponent(arg)) : renderDrillList());
    else if (tab === 'me') await renderMe();
    else if (arg) await renderOpp(decodeURIComponent(arg));
    else await renderOppList();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<p class="warn">Something went wrong: ${esc(e.message)}</p>`;
  }
  window.scrollTo(0, 0);
}
view.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.classList.contains('info-btn')) {
    const note = document.getElementById(b.getAttribute('aria-controls'));
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open)); if (note) note.hidden = !open;
    return;
  }
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
  await Promise.all([
    fetch('prep.json').then((r) => r.json()).then((j) => { PREP = j; }).catch(() => { /* hand-written prep is optional */ }),
    // only the Worker (wrangler.toml) answers api/health; on GitHub Pages or live-server this 404s and AI stays off
    fetch('api/health').then((r) => r.json()).then((j) => { AI = !!j.ai; }).catch(() => {}),
  ]);
  // Back from Auth0's sign-in page: finish signing in and sync before the first screen, so it shows the synced data.
  const accounts = { data: syncedDataArrived, status: renderAccount };
  const stats = () => { startTracking({ api: hasApi, token }); renderStatsToggle(); };
  if (returningFromSignIn()) { await startSync(accounts); route(); stats(); } else { route(); startSync(accounts).finally(stats); }
  // keep everyone's games fresh: missing or more than a day old, downloaded in the background
  dailyDownloads();
  if (AI) resumeAi();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') dailyDownloads(); });
  // Offline mode only on the real site: on localhost it would serve stale files during development,
  // so remove any worker and cache an earlier local run installed.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!('serviceWorker' in navigator)) return;
  if (!local) { navigator.serviceWorker.register('sw.js').catch(() => {}); return; }
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  if (window.caches) caches.keys().then((ks) => ks.filter((k) => k.startsWith('chess-prep-')).forEach((k) => caches.delete(k))).catch(() => {});
})();
