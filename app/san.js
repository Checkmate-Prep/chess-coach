// What a chess move in SAN looks like (as chess.com, Stockfish lines via chess.js, and the app write them).
// Checked before moves from outside (chess.com, the account) reach the opening trees and the screen.
const SAN = /^(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[1-8](?:=[QRBN])?)[+#]?$/;

/** True for a move like e4, exd5, Nbd7, R1e2, e8=Q+, O-O-O#. */
export const isSan = (t) => typeof t === 'string' && SAN.test(t);

/** The standard starting position. */
export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
