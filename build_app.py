"""Stamp the web app in app/ for a release: piece artwork, an empty prep.json, and the service worker's cache name.

Usage: python3 build_app.py   -> writes app/prep.json and app/pieces.js, stamps app/sw.js

Hand-written prep (notes.py) is never packed into app/: everything there is public, and notes.py is kept
local and out of git. It only feeds report.html (build_report.py).
"""
import hashlib, json, pathlib, re
import chess.svg

ROOT = pathlib.Path(__file__).parent
APP = ROOT / "app"


def main():
    write_empty_prep()
    stamp()


def write_empty_prep():
    """A prep.json with no hand-written prep, so older app versions that still load it find nothing."""
    APP.mkdir(exist_ok=True)
    (APP / "prep.json").write_text(json.dumps({"built": None, "me": None, "friends": []}, separators=(",", ":")))


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
