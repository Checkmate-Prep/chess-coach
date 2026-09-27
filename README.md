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
| `build_app.py` | Packages the hand-written prep for the web app (`app/prep.json`) and versions its offline cache |

## Web app

`app/` is an installable web app (PWA), published at https://simonletort.github.io/chess-coach/. Open it on a device and choose **Add to Home Screen**. Anyone can use it: enter your chess.com username, then add the people you play. There's no login, because everything used is public on chess.com.

- **Prep:** an automatic file on each opponent, built locally from up to 1,500 of their recent games. It covers ratings, your head-to-head record, how they play, and the lines where they score badly. **Find traps** runs Stockfish on the device over the positions they reach most often and flags moves they keep repeating that the engine refutes, with the punishing line.
- **Game plan:** every opponent file gets an automatic plan for both colours: which opening to play (preferring ones you already play, and ranked on a sample-adjusted score so a few lucky games can't decide it), what they usually answer, the engine-checked trap to aim for, lines where they score badly, and advice on time control, clock and game length. Every number is counted from their games; no AI writes it.
- **Explore:** tap through an opening and see what an opponent (or you) played next and how it scored.
- **Drill:** punish each opponent's traps, play prepared lines from memory, and solve positions from your own games. Wrong answers are checked by the engine, so an equally good move also counts.
- **You:** your profile plus an engine review of your games (blunders by phase, converting wins, punishing blunders, the clock). Your worst moments become puzzles.

Everything is stored in the device's browser (IndexedDB). The engine is Stockfish 19 lite (single-threaded WASM, about 1.8 MB) in a Web Worker. It runs at roughly 10 seconds per game review and 1–3 minutes per trap scan.

The hand-written prep in `notes.py` still ships in `app/prep.json`. It shows up as "Hand-written prep" for the opponents it covers, and it's added automatically when the player it was written for sets up the app. `python3 coach.py refresh` rebuilds it; pushing `app/` to `main` redeploys the site.

### Developing the app

```bash
npx live-server app --port=8766
```

This serves `app/` at http://localhost:8766 and reloads the page on every save. Offline mode is turned off on `localhost` so edits always show up; it only runs on the published site.

## Limits

chess.com's public API exposes puzzle ratings but not puzzle history, so tactical drills come from positions in your real games.
