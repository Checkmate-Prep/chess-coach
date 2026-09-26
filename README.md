# chess-coach

A personal chess coach for preparing games against friends on chess.com.

It downloads your games and your friends' games from the chess.com public API, runs Stockfish over them, and builds a profile of each player: openings and how they score with them, where their mistakes happen (opening, middlegame or endgame), how they handle the clock, and positions where they repeat the same mistake. The conclusions go into `notes.py`, and `build_report.py` turns everything into a prep book page with game plans, opening traps and drills from your own games.

## Setup

```bash
pip install -r requirements.txt
```

Stockfish 19 downloads into `bin/` on the first analysis run (the macOS build), unless a `stockfish` is already on your PATH.

## Usage

```bash
python3 coach.py refresh               # download + analyze you and all friends
python3 coach.py refresh pepex654      # one player
python3 coach.py explore gregmolin white "e4 c6 Nc3 d5"   # opening explorer
python3 build_report.py                # rebuild report.html
```

Players are set in `coach.py` (`ME`, `FRIENDS`). The engine analysis is cached per game in `data/`, so a refresh only analyzes new games.

| File | What it does |
| --- | --- |
| `fetch.py` | Downloads monthly game archives from api.chess.com |
| `analyze.py` | Stockfish evaluation of every move (cached in `data/<user>.analysis.json`) |
| `profile.py` | Style, opening and weakness statistics (`data/<user>.profile.json`) |
| `explore.py` | What a player chose next from any position, and their score |
| `notes.py` | The coach's written conclusions and prepared lines |
| `build_report.py` | Renders the prep book (`report.html`) |
| `build_app.py` | Packages the prep and opening trees for the phone app (`app/prep.json`) |

## Phone app

`app/` is an installable web app (PWA) for your phone, published at https://simonletort.github.io/chess-coach/. Open it on the phone and choose **Add to Home Screen**.

- **Prep**: game plans for each friend, trap lines on a board you can step through, and a **Refresh** button that loads their latest chess.com games. "Watch" lines say whether they still play the move the trap relies on.
- **Explore**: tap through an opening and see what a friend (or you) played next and how they scored, with new games counted in.
- **Drill**: play the trap lines from memory, and solve the positions you missed in your own games.
- **You**: your strengths, weaknesses and training plan.

It works offline after the first visit. Stockfish analysis still runs on the Mac: `python3 coach.py refresh` rebuilds `app/prep.json`, and pushing `app/` to `main` redeploys the site.

## Limits

chess.com's public API exposes puzzle ratings but not puzzle history, so tactical drills come from positions in your real games.
