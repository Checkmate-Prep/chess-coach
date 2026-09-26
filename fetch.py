"""Download chess.com game archives for a player into data/<user>.json."""
import json, sys, time, urllib.request, pathlib
UA = {"User-Agent": "personal-chess-coach"}
def get(url):
    for i in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception:
            time.sleep(2 * (i + 1))
    raise RuntimeError(url)
def fetch(user, months=None):
    archives = get(f"https://api.chess.com/pub/player/{user}/games/archives")["archives"]
    if months: archives = archives[-months:]
    games = []
    for a in archives:
        games += get(a)["games"]
    path = pathlib.Path(__file__).parent / "data" / f"{user.lower()}.json"
    path.write_text(json.dumps(games))
    print(user, len(archives), "months", len(games), "games")
if __name__ == "__main__":
    fetch(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else None)
