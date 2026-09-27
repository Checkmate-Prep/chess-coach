"""Package the prep (notes + profiles + opening trees) for the web app in app/.

Usage: python3 build_app.py   -> writes app/prep.json and app/pieces.js
"""
import hashlib, json, pathlib, re
import chess.svg
try:
    from notes import ME, FRIENDS
except ImportError:  # hand-written prep lives on the ai-prep branch, not on main
    ME, FRIENDS = None, {}
from explore import sans_of, DRAWS

ROOT = pathlib.Path(__file__).parent
APP = ROOT / "app"
DEPTH = 16  # plies kept in the opening trees


def tree(user, color):
    """Nested {n, p, c:{san: node}} tree of the player's games as `color`. p = points x2 (ints)."""
    root = {"n": 0, "p": 0, "c": {}}
    games = json.load(open(ROOT / f"data/{user}.json"))
    last = 0
    for g in games:
        if g.get("rules") != "chess" or "pgn" not in g:
            continue
        last = max(last, g["end_time"])
        if g[color]["username"].lower() != user:
            continue
        res = g[color]["result"]
        pts = 2 if res == "win" else 1 if res in DRAWS else 0
        node = root
        node["n"] += 1
        node["p"] += pts
        for san in sans_of(g["pgn"])[:DEPTH]:
            node = node["c"].setdefault(san, {"n": 0, "p": 0, "c": {}})
            node["n"] += 1
            node["p"] += pts
    return prune(root), last


def prune(node, depth=0):
    """Drop single-game branches past the first few plies to keep the file small."""
    keep = {s: prune(c, depth + 1) for s, c in node["c"].items() if c["n"] >= 2 or depth < 4}
    out = {"n": node["n"], "p": node["p"]}
    if keep:
        out["c"] = keep
    return out


def plain(text):
    return re.sub(r"<[^>]+>", "", text)


def main():
    # Without local game data (a fresh clone, or the edit hook on another machine), keep the
    # published prep.json and only refresh piece art and the cache name.
    if ME is None:
        write_empty_prep()
        return stamp()
    users = [*FRIENDS, "slnyc"]
    missing = [u for u in users if not (ROOT / f"data/{u}.json").exists()]
    if missing:
        print(f"no local game data for {', '.join(missing)}: keeping app/prep.json")
    else:
        write_prep()
    stamp()


def write_empty_prep():
    """No notes.py: ship a prep.json with no hand-written prep (the app treats it as optional)."""
    APP.mkdir(exist_ok=True)
    (APP / "prep.json").write_text(json.dumps({"built": None, "me": None, "friends": []}, separators=(",", ":")))


def write_prep():
    friends = []
    for key, f in FRIENDS.items():
        tw, last = tree(key, "white")
        tb, _ = tree(key, "black")
        friends.append({
            "user": key, "name": f["name"], "summary": f["summary"], "stats": f["stats"],
            "style": f["style"], "weak": f["weak"], "checklist": f["checklist"],
            "plans": [{k: p.get(k) for k in ("eyebrow", "title", "body", "table", "line", "flip", "key_from", "caption", "watch")}
                      for p in f["plans"]],
            "trees": {"white": tw, "black": tb}, "last_game": last,
        })
    mw, mlast = tree("slnyc", "white")
    mb, _ = tree("slnyc", "black")
    prep = {
        "built": ME["date"],
        "me": {"user": "slnyc", "summary": ME["summary"], "stats": ME["stats"], "strengths": ME["strengths"],
               "weaknesses": ME["weaknesses"], "puzzles": ME["puzzles"], "training": ME["training"],
               "trees": {"white": mw, "black": mb}, "last_game": mlast},
        "friends": friends,
    }
    APP.mkdir(exist_ok=True)
    (APP / "prep.json").write_text(json.dumps(prep, separators=(",", ":"), ensure_ascii=False))


def stamp():
    pieces = {k: v for k, v in chess.svg.PIECES.items()}
    (APP / "pieces.js").write_text(
        "// Piece artwork: cburnett set via python-chess (GPL-3.0 / CC BY-SA 3.0).\n"
        "export const PIECES = " + json.dumps(pieces) + ";\n")
    # Version the offline cache by content so devices pick up new prep and app code.
    digest = hashlib.sha1()
    for f in sorted(APP.rglob("*")):
        if f.is_file() and f.name != "sw.js":
            digest.update(f.read_bytes())
    sw = APP / "sw.js"
    sw.write_text(re.sub(r"const CACHE = '[^']*';", f"const CACHE = 'chess-prep-{digest.hexdigest()[:10]}';", sw.read_text()))
    print("prep.json", (APP / "prep.json").stat().st_size // 1024, "KB", "cache", digest.hexdigest()[:10])


if __name__ == "__main__":
    main()
