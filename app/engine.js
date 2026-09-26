// Stockfish 19 (lite, single-threaded WASM) in a Web Worker, with a serial request queue.
const URL_ = 'vendor/stockfish/stockfish-19-lite-single.js';
const MATE = 10000;

export class Engine {
  constructor() {
    this.worker = new Worker(URL_);
    this.handlers = [];
    this.worker.onmessage = (e) => { const line = String(e.data); for (const h of [...this.handlers]) h(line); };
    this.queue = this.cmd(['uci'], 'uciok').then(() => this.cmd(['setoption name Hash value 16', 'isready'], 'readyok'));
  }

  cmd(lines, until) {
    return new Promise((resolve) => {
      const h = (line) => { if (line.startsWith(until)) { this.handlers = this.handlers.filter((x) => x !== h); resolve(); } };
      this.handlers.push(h);
      for (const l of lines) this.worker.postMessage(l);
    });
  }

  /**
   * Evaluate a position. Score is from the side to move's point of view.
   * @returns {Promise<{cp:number, best:string|null, pv:string[]}>} best/pv in UCI notation
   */
  analyse(fen, nodes = 40000) {
    const run = () => new Promise((resolve) => {
      let last = { cp: 0, pv: [] };
      const h = (line) => {
        if (line.startsWith('info') && line.includes(' pv ') && !line.includes('multipv 2')) {
          const cp = line.match(/score cp (-?\d+)/), mate = line.match(/score mate (-?\d+)/);
          last = { cp: cp ? +cp[1] : mate ? Math.sign(+mate[1] || -1) * (MATE - Math.abs(+mate[1])) : last.cp, pv: line.split(' pv ')[1].trim().split(' ') };
        } else if (line.startsWith('bestmove')) {
          this.handlers = this.handlers.filter((x) => x !== h);
          const best = line.split(' ')[1];
          resolve({ cp: last.cp, best: best && best !== '(none)' ? best : null, pv: last.pv });
        }
      };
      this.handlers.push(h);
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go nodes ${nodes}`);
    });
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }

  stop() { this.worker.terminate(); }
}

let shared = null;
export const engine = () => (shared ||= new Engine());
