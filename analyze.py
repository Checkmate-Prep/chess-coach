"""Run Stockfish over a player's games and cache per-move evaluations.

Usage: python3 analyze.py <user> [max_games] [time_class,...]
Results are cached in data/<user>.analysis.json keyed by game URL, so re-runs
only analyze games that are new since the last run.
"""
import io, json, math, pathlib, re, shutil, sys, tarfile, urllib.request
from concurrent.futures import ProcessPoolExecutor
import chess, chess.engine, chess.pgn

ROOT = pathlib.Path(__file__).parent
ENGINE_URL = "https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-macos-universal.tar.gz"
ENGINE = str(ROOT / "bin/stockfish/stockfish-macos-universal")
NODES = 150_000  # ~club-strong analysis, fast enough for hundreds of games
CLK = re.compile(r"\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]")


def win_prob(cp):
    """Lichess win-probability model: centipawns -> expected score 0..100 for side to move's opponent frame."""
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def score_cp(info, pov):
    return info["score"].pov(pov).score(mate_score=10_000)


def analyze_game(g):
    game = chess.pgn.read_game(io.StringIO(g["pgn"]))
    if game is None:
        return None
    engine = chess.engine.SimpleEngine.popen_uci(ENGINE)
    engine.configure({"Threads": 1, "Hash": 32})
    board = game.board()
    moves = []
    info = engine.analyse(board, chess.engine.Limit(nodes=NODES))
    for node in game.mainline():
        mover = board.turn
        best = info.get("pv", [None])[0]
        before = score_cp(info, mover)
        m = CLK.search(node.comment or "")
        clock = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else None
        fen = board.fen()
        san = board.san(node.move)
        best_san = board.san(best) if best else None
        board.push(node.move)
        if board.is_game_over():
            after = 10_000 if board.is_checkmate() else 0
        else:
            info = engine.analyse(board, chess.engine.Limit(nodes=NODES))
            after = score_cp(info, mover)
        moves.append({
            "ply": len(moves) + 1, "san": san, "best": best_san,
            "before": before, "after": after,
            "wp_loss": round(max(0, win_prob(before) - win_prob(after)), 1),
            "clock": clock, "pieces": len(board.piece_map()),
            "fen": fen,
        })
    engine.quit()
    return g["url"], moves


def ensure_engine():
    """Use bin/stockfish if present, else a stockfish on PATH, else download the official macOS build."""
    global ENGINE
    if pathlib.Path(ENGINE).exists():
        return
    if shutil.which("stockfish"):
        ENGINE = shutil.which("stockfish")
        return
    print("Downloading Stockfish 19...", flush=True)
    (ROOT / "bin").mkdir(exist_ok=True)
    with urllib.request.urlopen(ENGINE_URL) as r, tarfile.open(fileobj=r, mode="r|gz") as tar:
        tar.extractall(ROOT / "bin")


def main():
    ensure_engine()
    user = sys.argv[1].lower()
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 150
    classes = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else None
    games = json.load(open(ROOT / f"data/{user}.json"))
    games = [g for g in games if g.get("rules") == "chess" and "pgn" in g
             and (not classes or g["time_class"] in classes)]
    games = sorted(games, key=lambda g: g["end_time"])[-limit:]
    cache_path = ROOT / f"data/{user}.analysis.json"
    cache = json.load(open(cache_path)) if cache_path.exists() else {}
    todo = [g for g in games if g["url"] not in cache]
    print(f"{user}: {len(games)} games selected, {len(todo)} to analyze", flush=True)
    with ProcessPoolExecutor(max_workers=6) as pool:
        for i, res in enumerate(pool.map(analyze_game, todo), 1):
            if res:
                cache[res[0]] = res[1]
            if i % 10 == 0:
                cache_path.write_text(json.dumps(cache))
                print(f"  {i}/{len(todo)}", flush=True)
    cache_path.write_text(json.dumps(cache))
    print("done")


if __name__ == "__main__":
    main()
