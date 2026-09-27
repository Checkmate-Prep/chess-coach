// Test doubles for the browser APIs the app uses: IndexedDB, fetch, Web Worker (Stockfish), document.

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
