# chess-coach

A chess coach for preparing games against specific opponents on chess.com. Two parts:

- **Python pipeline (runs on a Mac):** downloads games from the chess.com public API, runs native Stockfish 19 over them, builds player profiles, and packages the results. Hand-written coaching lives in `notes.py`.
- **Web app (`app/`):** a static PWA published to GitHub Pages (https://simonletort.github.io/chess-coach/). Anyone enters their chess.com username and opponents; games, stats, traps, game plans and drills are all computed in the browser, including Stockfish (WASM). There is no server and no login.

See `README.md` for the user-facing description.

## Layout

| Path | Role |
| --- | --- |
| `fetch.py`, `analyze.py`, `profile.py`, `explore.py` | Pipeline steps: download archives, engine-evaluate every move (cached per game), build profiles, opening explorer |
| `coach.py` | `refresh` runs the pipeline for you + friends, then rebuilds the report and the app data |
| `notes.py` | **Hand-written prep** (written by Claude from the analysis, not generated). Edit it to change conclusions |
| `build_report.py` | Renders `report.html` (the prep-book artifact) from profiles + `notes.py` |
| `build_app.py` | Packs `notes.py` + opening trees into `app/prep.json` and stamps the service-worker cache name |
| `app/app.js` | UI: routing (`#me`, `#prep`, `#prep/<user>`, `#explore`, `#drill[/id]`, `#setup`) and all screens |
| `app/chesscom.js`, `app/store.js` | chess.com API client; IndexedDB (games, analysis) + localStorage (profile, names, small settings) |
| `app/stats.js`, `app/plan.js` | Opening trees, profile stats, weak lines; the automatic game plan |
| `app/engine.js`, `app/analysis.js` | Stockfish worker wrapper; game review, trap finder, puzzles |
| `app/board.js`, `app/pieces.js` | SVG board with tap-to-move; piece artwork |
| `tests/` | Node (`node:test`) tests for the app modules, Python `unittest` for the pipeline; synthetic fixtures |
| `app/vendor/` | Vendored `chess.js` 1.4.0 and Stockfish 19 lite single-threaded (GPL, see `COPYING.txt`) |

Gitignored and rebuilt locally: `data/` (games, analysis, profiles), `bin/` (native Stockfish, auto-downloaded), `report.html`.

## Commands

```bash
python3 coach.py refresh               # pipeline for everyone, then report + app data
python3 build_app.py                   # after ANY change in app/ (see below)
npx live-server app --port=8766        # local preview with auto-reload
node --test 'tests/*.test.mjs'         # app tests (Node 22+, see .nvmrc)
python3 -m unittest discover -s tests  # pipeline tests
```

## Rules that matter

- **`app/` changes need `python3 build_app.py`.** It hashes the app into the service worker's cache name; without a new name, installed apps keep serving the old files. A project hook runs it automatically after Claude edits a file in `app/`; run it yourself after edits made any other way.
- **Everything in `app/` is public**, including `prep.json` (the hand-written prep). Never put secrets or private data there.
- **No build step or framework.** Plain ES modules; libraries are vendored. Keep it that way unless there's a strong reason.
- **Offline mode is disabled on localhost** (in `app.js` and `sw.js`) so local edits always show. Don't remove that.
- **Engine calls go through `analyseSafe` and long jobs through `whileAwake`** (`engine.js`). Browsers pause hidden pages and the engine with them; timeouts only count visible time, and a stuck worker is replaced.
- **Scores:** trees store points ×2 as integers (`p`), `pct(p, n)` gives the percentage. A score is always from the named player's point of view (win 1, draw ½, loss 0).
- **Opponent names:** use `displayName(user)`, never `username` directly, in anything shown to the user.
- **Copy:** plain, short sentences; opponents are "they", not "he". Numbers in the UI must be counted from real games, and small samples should say how many games they rest on.

## Testing

- Automated tests live in `tests/` (not `app/`, which is published). `tests/helpers.mjs` fakes IndexedDB, `fetch` and the Stockfish worker, so app logic runs in Node without a browser or engine. CI (`.github/workflows/test.yml`) runs both suites on every PR.
- Fixtures are synthetic games in `tests/fixtures/`. Never copy real games from `data/` or friends' usernames into tests. `parity.json` holds values that the JS and Python suites both check, so the app and the pipeline agree.
- Coverage: add `--experimental-test-coverage --test-coverage-exclude='app/vendor/**' --test-coverage-exclude='tests/**'` to the node command; for Python, `python3 -m coverage run -m unittest discover -s tests && python3 -m coverage report` (`pip install -r requirements-dev.txt`).
- Not covered yet: `app.js` (UI), `board.js`, `sw.js`, `build_report.py`. Check those in the preview.
- Preview at phone size (375×812) in the desktop app's built-in browser. Clear `localStorage` and the `chess-prep` IndexedDB database after a test run.
- The built-in browser can't register service workers, so offline mode can only be checked on a real device.
- **If the browser pane is hidden, the page is hidden and Stockfish stalls.** A trap scan stuck at "0 of N" is expected there, not a bug; run engine tests with the pane visible.
- Syntax-check modules with `node --check` on a `.mjs` copy (the files are ES modules).

## Workflow

- One branch and one PR per change, from an up-to-date `main`. Pushing `app/**` to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`).
- When a PR grows, update its title and description to match. PR descriptions list what was tested and what wasn't.
- Commit messages say what changed and why.
- After each PR, add an entry to docs/build-log.md, lightly clean the prompt where there is need for privacy.

## Claude Code setup (`.claude/`)

- `settings.json`: shared permissions (common build, preview and read-only git/gh commands run without asking; reading `.dev.vars` and pushing to `main` are denied) and the hook above (`hooks/rebuild-app.sh`). Personal overrides go in `settings.local.json`, which is gitignored.
- `skills/prep-opponent`: write hand-written prep for an opponent (`/prep-opponent <username>`).
- `skills/ship-change`: the checklist for landing a change (`/ship-change`).
- `launch.json`: preview configurations for the built-in browser.
- Auto memory is on (`autoMemoryEnabled` in `settings.json`). Memory files are machine-local, not in the repo: `~/.claude/projects/<this repo>/memory/`, with `MEMORY.md` as the index. Keep facts derivable from the code or this file out of memory.
