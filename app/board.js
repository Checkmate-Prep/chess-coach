// SVG chessboard with tap-to-move. Rendering only; the caller owns the game and decides what a move means.
import { PIECES } from './pieces.js';

const SQ = 45;
const FILES = 'abcdefgh';
const ART = Object.fromEntries(Object.entries(PIECES).map(([k, v]) => [k, v.replace(/ id="[^"]*"/, '')]));

export class Board {
  /**
   * @param {HTMLElement} el
   * @param {{game: import('./vendor/chess.js').Chess, flipped?: boolean, onMove?: (m:{from:string,to:string,promotion?:string}) => void}} opts
   */
  constructor(el, { game, flipped = false, onMove = null } = {}) {
    this.el = el;
    this.game = game;
    this.flipped = flipped;
    this.onMove = onMove;
    this.selected = null;
    this.lastMove = null;
    this.hint = null;      // square to ring as a hint
    this.arrows = [];      // [[from, to, color]]
    this.flash = null;     // {square, kind: 'good'|'bad'}
    el.classList.add('board');
    el.addEventListener('click', (e) => this.tap(e));
    this.render();
  }

  xy(square) {
    const f = FILES.indexOf(square[0]), r = +square[1] - 1;
    return this.flipped ? [(7 - f) * SQ, r * SQ] : [f * SQ, (7 - r) * SQ];
  }

  squareAt(x, y) {
    let f = Math.floor(x / SQ), r = 7 - Math.floor(y / SQ);
    if (this.flipped) { f = 7 - f; r = 7 - r; }
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return FILES[f] + (r + 1);
  }

  tap(e) {
    if (!this.onMove) return;
    const svg = this.el.querySelector('svg');
    const box = svg.getBoundingClientRect();
    const sq = this.squareAt((e.clientX - box.left) * 360 / box.width, (e.clientY - box.top) * 360 / box.height);
    if (!sq) return;
    const piece = this.game.get(sq);
    if (this.selected) {
      const legal = this.game.moves({ square: this.selected, verbose: true }).find((m) => m.to === sq);
      if (legal) {
        const from = this.selected;
        this.selected = null;
        this.onMove({ from, to: sq, promotion: legal.promotion ? 'q' : undefined });
        return;
      }
    }
    this.selected = piece && piece.color === this.game.turn() && sq !== this.selected ? sq : null;
    this.render();
  }

  render() {
    const parts = [];
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = FILES[f] + (r + 1);
        const [x, y] = this.xy(sq);
        const light = (f + r) % 2 === 1;
        parts.push(`<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="${light ? 'var(--sq-light)' : 'var(--sq-dark)'}"/>`);
      }
    }
    const mark = (sq, fill) => { const [x, y] = this.xy(sq); parts.push(`<rect x="${x}" y="${y}" width="${SQ}" height="${SQ}" fill="${fill}"/>`); };
    if (this.lastMove) { mark(this.lastMove.from, 'var(--sq-last)'); mark(this.lastMove.to, 'var(--sq-last)'); }
    if (this.flash) mark(this.flash.square, this.flash.kind === 'good' ? 'var(--sq-good)' : 'var(--sq-bad)');
    if (this.selected) mark(this.selected, 'var(--sq-sel)');
    // coordinates
    for (let i = 0; i < 8; i++) {
      const file = this.flipped ? FILES[7 - i] : FILES[i];
      const rank = this.flipped ? i + 1 : 8 - i;
      parts.push(`<text x="${i * SQ + 41}" y="357" class="coord" text-anchor="end">${file}</text>`);
      parts.push(`<text x="2.5" y="${i * SQ + 10}" class="coord">${rank}</text>`);
    }
    const board = this.game.board();
    for (const row of board) {
      for (const p of row) {
        if (!p) continue;
        const [x, y] = this.xy(p.square);
        const key = p.color === 'w' ? p.type.toUpperCase() : p.type;
        parts.push(`<g transform="translate(${x} ${y})">${ART[key]}</g>`);
      }
    }
    if (this.selected) {
      for (const m of this.game.moves({ square: this.selected, verbose: true })) {
        const [x, y] = this.xy(m.to);
        parts.push(this.game.get(m.to)
          ? `<circle cx="${x + 22.5}" cy="${y + 22.5}" r="20" fill="none" stroke="var(--dot)" stroke-width="3.5"/>`
          : `<circle cx="${x + 22.5}" cy="${y + 22.5}" r="6.5" fill="var(--dot)"/>`);
      }
    }
    if (this.hint) {
      const [x, y] = this.xy(this.hint);
      parts.push(`<rect x="${x + 2}" y="${y + 2}" width="${SQ - 4}" height="${SQ - 4}" fill="none" stroke="var(--gold)" stroke-width="4" rx="3"/>`);
    }
    for (const [from, to, color] of this.arrows) parts.push(arrow(this.xy(from), this.xy(to), color));
    this.el.innerHTML = `<svg viewBox="0 0 360 360" role="img" aria-label="Chess board">${parts.join('')}</svg>`;
  }
}

function arrow([x1, y1], [x2, y2], color) {
  const cx1 = x1 + 22.5, cy1 = y1 + 22.5, cx2 = x2 + 22.5, cy2 = y2 + 22.5;
  const dx = cx2 - cx1, dy = cy2 - cy1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, head = 15, w = 5.5;
  const bx = cx2 - ux * head, by = cy2 - uy * head;
  const px = -uy, py = ux;
  const pts = [
    [cx1 + px * w / 2, cy1 + py * w / 2], [bx + px * w / 2, by + py * w / 2], [bx + px * 11, by + py * 11],
    [cx2, cy2], [bx - px * 11, by - py * 11], [bx - px * w / 2, by - py * w / 2], [cx1 - px * w / 2, cy1 - py * w / 2],
  ];
  return `<polygon points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="${color}" opacity=".85"/>`;
}
