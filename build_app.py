"""Stamp the web app in app/ for a release: piece artwork, an empty prep.json, and the service worker's cache name.

Usage: python3 build_app.py   -> writes app/prep.json and app/pieces.js, stamps app/sw.js (offline file list and cache name)

Hand-written prep (notes.py) is never packed into app/: everything there is public, and notes.py is kept
local and out of git. It only feeds report.html (build_report.py).
"""
import hashlib, json, pathlib, re

ROOT = pathlib.Path(__file__).parent
APP = ROOT / "app"


def main():
    write_empty_prep()
    stamp()


def write_empty_prep():
    """A prep.json with no hand-written prep, so older app versions that still load it find nothing."""
    APP.mkdir(exist_ok=True)
    (APP / "prep.json").write_text(json.dumps({"built": None, "me": None, "friends": []}, separators=(",", ":")))


# Files the app needs to start offline: pages, styles, modules, the manifest and icons at the top of app/,
# and the vendored code. Landing-page screenshots, prep.json and licence texts are left out.
SHELL_TOP = ("*.html", "*.css", "*.js", "*.webmanifest", "icon*.png", "icon*.svg")
SHELL_VENDOR = ("*.js", "*.wasm")


def shell_files(app=None):
    """The service worker's offline file list, read from what is in app/ so a new module can't be missed."""
    app = app or APP
    top = {f.name for pat in SHELL_TOP for f in app.glob(pat) if f.is_file() and f.name != "sw.js"}
    vendor = {f.relative_to(app).as_posix() for pat in SHELL_VENDOR for f in (app / "vendor").rglob(pat) if f.is_file()}
    return ["./", *sorted(top), *sorted(vendor)]


def write_shell(sw_text, files):
    """sw.js with its SHELL list replaced by files, a few per line."""
    quoted = [f"'{f}'" for f in files]
    lines = [", ".join(quoted[i:i + 8]) for i in range(0, len(quoted), 8)]
    shell = "const SHELL = [" + ",\n  ".join(lines) + "];"
    return re.sub(r"const SHELL = \[.*?\];", lambda _: shell, sw_text, count=1, flags=re.S)


def stamp():
    import chess.svg  # here, so the offline list can be tested without python-chess
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
    sw.write_text(write_shell(sw.read_text(), shell_files()))
    # The worker itself counts too (minus the name line), so a changed file list gets a new cache.
    digest.update(re.sub(r"const CACHE = '[^']*';", "", sw.read_text()).encode())
    sw.write_text(re.sub(r"const CACHE = '[^']*';", f"const CACHE = 'chess-prep-{digest.hexdigest()[:10]}';", sw.read_text()))
    print("prep.json", (APP / "prep.json").stat().st_size // 1024, "KB", "cache", digest.hexdigest()[:10])


if __name__ == "__main__":
    main()
