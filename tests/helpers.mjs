// Test doubles for the browser APIs the app uses: IndexedDB, localStorage, fetch, Web Worker (Stockfish), document.

/** In-memory stand-in for the slice of IndexedDB that store.js uses. `data` can be inspected or cleared. */
export function installFakeIndexedDB() {
  const data = new Map();
  const req = (result) => ({ result });
  const store = {
    get: (k) => req(structuredClone(data.get(k))),
    put: (v, k) => { data.set(k, structuredClone(v)); return req(k); },
    delete: (k) => { data.delete(k); return req(undefined); },
    clear: () => { data.clear(); return req(undefined); },
  };
  const db = {
    createObjectStore() {},
    transaction() {
      const t = { objectStore: () => store };
      setTimeout(() => t.oncomplete?.());
      return t;
    },
  };
  globalThis.indexedDB = {
    open() {
      const r = { result: db };
      setTimeout(() => { r.onupgradeneeded?.(); r.onsuccess?.(); });
      return r;
    },
  };
  return data;
}

/** In-memory localStorage (store.js `ls`). Returns the backing Map. */
export function installFakeLocalStorage() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(),
  };
  return data;
}

/** fetch() answering from a {url: json} map; other URLs get a 404. Returns the list of requested URLs. */
export function installFakeFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const body = routes[url];
    if (typeof body === 'number') return { status: body, ok: false, json: async () => ({}) };
    if (body === undefined) return { status: 404, ok: false, json: async () => ({}) };
    return { status: 200, ok: true, json: async () => structuredClone(body) };
  };
  return calls;
}

/**
 * A Web Worker that speaks just enough UCI for engine.js. `FakeWorker.script(fen, nodes)` decides each
 * search result: {cp | mate, pv?, best?}, {lines: [...]} for raw output, 'hang' (never answers) or 'crash'.
 */
export class FakeWorker {
  static instances = [];
  static posted = [];
  static script = () => ({ cp: 0 });
  static reset(script = () => ({ cp: 0 })) { FakeWorker.instances = []; FakeWorker.posted = []; FakeWorker.script = script; }

  constructor(url) { this.url = url; this.fen = null; this.terminated = false; FakeWorker.instances.push(this); }
  terminate() { this.terminated = true; }
  emit(line) { queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: line }); }); }
  postMessage(line) {
    FakeWorker.posted.push(line);
    if (line === 'uci') return this.emit('uciok');
    if (line === 'isready') return this.emit('readyok');
    if (line.startsWith('position fen ')) { this.fen = line.slice('position fen '.length); return; }
    if (!line.startsWith('go')) return;
    const r = FakeWorker.script(this.fen, +line.split(' ')[2]);
    if (r === 'hang') return;
    if (r === 'crash') { queueMicrotask(() => this.onerror?.(new Error('crash'))); return; }
    if (r.lines) { for (const l of r.lines) this.emit(l); return; }
    const pv = r.pv || (r.best ? [r.best] : ['0000']);
    const score = r.mate !== undefined ? `mate ${r.mate}` : `cp ${r.cp}`;
    this.emit(`info depth 12 seldepth 14 multipv 1 score ${score} nodes 1000 pv ${pv.join(' ')}`);
    this.emit(`bestmove ${r.best ?? (r.pv ? r.pv[0] : '(none)')}`);
  }
}

export function installBrowserGlobals() {
  globalThis.Worker = FakeWorker;
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
}

/** Opening-tree node: n games, `score` percent for the tree's player (stored as points x2). */
export const node = (n, score, c = {}) => ({ n, p: Math.round((score * n) / 50), c });

/** Compact game record, as chesscom.js stores it. */
export const game = (o = {}) => ({
  url: o.url || `https://www.chess.com/game/live/${Math.random().toString(36).slice(2)}`,
  t: 1780000000, tc: 'blitz', base: 180, color: 'white', rating: 1200, opp: 'someone', oppR: 1200,
  pts: 2, how: 'resigned', eco: 'Italian Game', sans: ['e4', 'e5'], clk: [], ...o,
});

/** Let pending promise callbacks and zero-delay timers run. */
export const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * D1 stand-in on node:sqlite (in memory), for the Worker's SQL: prepare/bind/run/first/all, batch (one
 * transaction) and exec (one statement per line, like D1).
 */
export async function fakeD1() {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const plain = (row) => (row ? { ...row } : null);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    first: async () => plain(db.prepare(sql).get(...args)),
    all: async () => ({ results: db.prepare(sql).all(...args).map(plain) }),
  });
  return {
    prepare: (sql) => stmt(sql),
    exec: async (sql) => { for (const line of sql.split('\n')) if (line.trim()) db.exec(line); },
    batch: async (list) => {
      db.exec('BEGIN');
      try { const out = []; for (const s of list) out.push(await s.run()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

/** Analysis results as the app stores them (app/resultsdoc.js): one game's review, a trap scan of `n` games, a plan written at `at`. */
export const review = (extra = {}) => ({
  loss: [0, 12.5, 0], pieces: [32, 32, 31], evals: [20, 15, -300],
  bad: [{ ply: 2, fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', played: 'f6', loss: 13, before: 15, after: -300, bestUci: null, best: 'e5', line: ['e5', 'Nf3'] }],
  ...extra,
});
export const traps = (n, extra = {}) => ({
  n, checked: 3,
  traps: [{ path: ['e4', 'e5', 'Nf3'], san: 'f6', times: 9, of: 11, score: 44, fen: 'a', afterFen: 'b', played: 'f6', bestForHim: 'Nc6',
    before: 30, after: -280, drop: 27, punish: ['Nxe5', 'fxe5', 'Qh5+'] }],
  ...extra,
});
export const plan = (at, extra = {}) => ({
  plan: { summary: 'They play 1.e4.', plans: [{ you_play: 'black', eyebrow: 'You have Black', title: 't', line: 'e4 c5', key_from: 1, body: ['b'], caption: 'c' }],
    weak: ['w'], checklist: ['c'] },
  at, games: 40, ...extra,
});
