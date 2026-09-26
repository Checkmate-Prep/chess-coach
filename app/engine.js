// Stockfish 19 (lite, single-threaded WASM) in a Web Worker, with a serial request queue.
// A worker that errors or stops answering is marked dead; engine() then hands out a fresh one.
const URL_ = 'vendor/stockfish/stockfish-19-lite-single.js';
const MATE = 10000;
const INIT_MS = 20000;
const msFor = (nodes) => 15000 + nodes / 5; // generous: ~5k nodes/s floor on slow phones

/**
 * Timeout that only counts time while the page is visible and running. Browsers pause or throttle
 * hidden pages (app in the background, screen locked), which pauses the engine too; that is not a hang.
 */
function visibleTimeout(ms, onTimeout) {
  let left = ms, last = Date.now();
  const id = setInterval(() => {
    const now = Date.now(), gap = now - last;
    last = now;
    if (document.hidden || gap > 3000) return; // hidden, or we were just suspended/throttled
    left -= gap;
    if (left <= 0) { clearInterval(id); onTimeout(); }
  }, 1000);
  return () => clearInterval(id);
}

export class Engine {
  constructor() {
    this.dead = false;
    this.handlers = [];
    this.worker = new Worker(URL_);
    this.worker.onmessage = (e) => { const line = String(e.data); for (const h of [...this.handlers]) h(line); };
    this.worker.onerror = () => this.kill();
    this.queue = this.cmd(['uci'], 'uciok', INIT_MS).then(() => this.cmd(['setoption name Hash value 16', 'isready'], 'readyok', INIT_MS));
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    try { this.worker.terminate(); } catch { /* already gone */ }
    for (const h of [...this.handlers]) h(null); // wake every waiter so it can reject
    this.handlers = [];
  }

  /** Send lines; resolve when a line starts with `until`, reject on timeout or a dead worker. */
  cmd(lines, until, ms) {
    return new Promise((resolve, reject) => {
      const done = (fn) => { cancel(); this.handlers = this.handlers.filter((x) => x !== h); fn(); };
      const h = (line) => {
        if (line === null) done(() => reject(new Error('Stockfish stopped')));
        else if (line.startsWith(until)) done(resolve);
      };
      const cancel = visibleTimeout(ms, () => { done(() => reject(new Error('Stockfish did not answer'))); this.kill(); });
      if (this.dead) return done(() => reject(new Error('Stockfish stopped')));
      this.handlers.push(h);
      for (const l of lines) this.worker.postMessage(l);
    });
  }

  /**
   * Evaluate a position. Score is from the side to move's point of view.
   * @returns {Promise<{cp:number, best:string|null, pv:string[]}>} best/pv in UCI notation
   */
  analyse(fen, nodes = 40000) {
    const run = () => new Promise((resolve, reject) => {
      let last = { cp: 0, pv: [] };
      const done = (fn) => { cancel(); this.handlers = this.handlers.filter((x) => x !== h); fn(); };
      const h = (line) => {
        if (line === null) return done(() => reject(new Error('Stockfish stopped')));
        if (line.startsWith('info') && line.includes(' pv ') && !line.includes('multipv 2')) {
          const cp = line.match(/score cp (-?\d+)/), mate = line.match(/score mate (-?\d+)/);
          last = { cp: cp ? +cp[1] : mate ? Math.sign(+mate[1] || -1) * (MATE - Math.abs(+mate[1])) : last.cp, pv: line.split(' pv ')[1].trim().split(' ') };
        } else if (line.startsWith('bestmove')) {
          const best = line.split(' ')[1];
          done(() => resolve({ cp: last.cp, best: best && best !== '(none)' ? best : null, pv: last.pv }));
        }
      };
      const cancel = visibleTimeout(msFor(nodes), () => { done(() => reject(new Error('Stockfish did not answer'))); this.kill(); });
      if (this.dead) return done(() => reject(new Error('Stockfish stopped')));
      this.handlers.push(h);
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go nodes ${nodes}`);
    });
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }

  stop() { this.kill(); }
}

let shared = null;
/** The shared engine; replaced automatically after a failure. */
export const engine = () => {
  if (!shared || shared.dead) shared = new Engine();
  return shared;
};

/** Run an analysis, retrying once on a fresh engine if the first one fails. */
export async function analyseSafe(fen, nodes) {
  try { return await engine().analyse(fen, nodes); } catch {
    return engine().analyse(fen, nodes); // engine() is fresh now; a second failure propagates
  }
}

/**
 * Keep the screen on while `fn` runs (long engine jobs); the lock is dropped by the browser when the
 * page is hidden, so it is taken again when the page comes back. Unsupported browsers just run fn.
 */
export async function whileAwake(fn) {
  let lock = null, running = true;
  const take = async () => { try { if (running && !document.hidden) lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; } };
  const onVis = () => { if (!document.hidden) take(); };
  document.addEventListener('visibilitychange', onVis);
  await take();
  try { return await fn(); } finally {
    running = false;
    document.removeEventListener('visibilitychange', onVis);
    try { await lock?.release(); } catch { /* already released */ }
  }
}
