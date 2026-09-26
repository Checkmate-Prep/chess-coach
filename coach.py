"""One-command refresh: download latest games, engine-analyze new ones, rebuild profiles.

Usage:
  python3 coach.py refresh                 # you + all friends
  python3 coach.py refresh pepex654        # one player
  python3 coach.py explore pepex654 black "e4 e5 Nf3 Nf6"
"""
import subprocess, sys, pathlib
ROOT = pathlib.Path(__file__).parent
ME = "slnyc"
FRIENDS = {"pepex654": "Etienne", "gregmolin": "Greg"}
SLOW = "blitz,daily,rapid"


def run(*args):
    subprocess.run([sys.executable, *map(str, args)], cwd=ROOT, check=True)


def refresh(user):
    run("fetch.py", user, *([] if user == ME else ["12"]))
    run("analyze.py", user, 150, SLOW)
    run("profile.py", user)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "refresh"
    if cmd == "refresh":
        for u in sys.argv[2:] or [ME, *FRIENDS]:
            refresh(u)
    elif cmd == "explore":
        run("explore.py", *sys.argv[2:])
