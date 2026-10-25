// Drill ids: built from what a drill is (the trap's moves, the prepared line), not from its place in a list,
// so a rescan or a rewritten plan never moves a "done" tick onto another drill. Ids sync (syncdoc.js `done`).

/** A short, stable hash of `text` (FNV-1a, 32 bits, hex): the same on every device. */
export function shortHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** A trap of `user` when they have `color`: the position's moves and the move they repeat. */
export const trapDrillId = (user, color, t) => `trap:${user}:${color}:${shortHash([...t.path, t.san].join(' '))}`;

/** A prepared line (an AI plan's line) against `user`. */
export const lineDrillId = (user, line) => `ailine:${user}:${shortHash(line)}`;

/**
 * Ticks saved under the old ids (`trap:<user>:<color>:<index>`, `ailine:<user>:<index>`), moved to the drill now at
 * that place. Run once: after that, old ids are never looked at again. `traps(user, color)` and `lines(user)` give
 * the current lists. Returns the ids to add to `done`.
 */
export function migrateDone(done, users, traps, lines) {
  const out = {};
  for (const user of users) {
    for (const color of ['white', 'black']) {
      (traps(user, color) || []).forEach((t, i) => { if (done[`trap:${user}:${color}:${i}`]) out[trapDrillId(user, color, t)] = true; });
    }
    (lines(user) || []).forEach((line, i) => { if (line && done[`ailine:${user}:${i}`]) out[lineDrillId(user, line)] = true; });
  }
  return out;
}
