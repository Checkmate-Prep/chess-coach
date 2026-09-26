"""Opening explorer over one player's games.

Usage: python3 explore.py <user> <white|black> "e4 e5 Nf3" [time_class,...]
Shows what was played next from that position, how often, and the player's score,
plus the average engine loss / blunder rate of the player in the next 10 moves
(when those games have been analyzed).
"""
import json, pathlib, re, sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).parent
DRAWS = {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}


def sans_of(pgn):
    """Fast SAN extraction from chess.com PGN movetext (no board replay)."""
    text = pgn.split("\n\n", 1)[-1]
    text = re.sub(r"\{[^}]*\}", " ", text)
    return [t for t in text.split() if not re.match(r"^(\d+\.+|1-0|0-1|1/2-1/2|\*)$", t)]


def main():
    user, color = sys.argv[1].lower(), sys.argv[2]
    prefix = sys.argv[3].split() if len(sys.argv) > 3 else []
    classes = set(sys.argv[4].split(",")) if len(sys.argv) > 4 else None
    games = json.load(open(ROOT / f"data/{user}.json"))
    ap = ROOT / f"data/{user}.analysis.json"
    analysis = json.load(open(ap)) if ap.exists() else {}
    nxt = defaultdict(lambda: {"n": 0, "pts": 0.0, "ends": defaultdict(int), "urls": []})
    matched, eng = 0, {"moves": 0, "loss": 0.0, "bl": 0}
    for g in games:
        if g.get("rules") != "chess" or "pgn" not in g or g[color]["username"].lower() != user:
            continue
        if classes and g["time_class"] not in classes:
            continue
        sans = sans_of(g["pgn"])[: len(prefix) + 1]
        if sans[: len(prefix)] != prefix:
            continue
        matched += 1
        res = g[color]["result"]
        s = 1 if res == "win" else 0.5 if res in DRAWS else 0
        key = sans[len(prefix)] if len(sans) > len(prefix) else "(end)"
        e = nxt[key]
        e["n"] += 1
        e["pts"] += s
        e["urls"].append(g["url"])
        moves = analysis.get(g["url"])
        if moves:
            mine = 0 if color == "white" else 1
            for m in moves[len(prefix): len(prefix) + 20]:
                if (m["ply"] - 1) % 2 == mine:
                    eng["moves"] += 1
                    eng["loss"] += m["wp_loss"]
                    eng["bl"] += m["wp_loss"] >= 20
    print(f"{user} as {color} after '{' '.join(prefix) or 'start'}': {matched} games")
    for k, v in sorted(nxt.items(), key=lambda x: -x[1]["n"])[:12]:
        print(f"  {k:8} {v['n']:5}  {user} scores {round(100 * v['pts'] / v['n']):3}%")
    if eng["moves"]:
        print(f"  engine (next 10 moves, {eng['moves']} analyzed moves): avg loss {eng['loss'] / eng['moves']:.1f}, "
              f"blunders/100 {100 * eng['bl'] / eng['moves']:.1f}")


if __name__ == "__main__":
    main()
