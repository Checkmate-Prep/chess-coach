# chess-coach

**Checkmate Prep** (https://checkmateprep.com): a chess coach for preparing games against specific opponents on chess.com. The product is called Checkmate Prep everywhere users see it; the repo, the Worker names and internal identifiers stay `chess-coach`. Two parts:

- **Python pipeline (runs on a Mac):** downloads games from the chess.com public API, runs native Stockfish 19 over them, builds player profiles, and packages the results. Hand-written coaching lives in `notes.py`, a local file kept out of git (the repo is public); it only feeds `report.html`.
- **Web app (`app/`):** a static PWA published to GitHub Pages (https://checkmate-prep.github.io/chess-coach/). Anyone enters their chess.com username and opponents; games, stats, traps, game plans and drills are all computed in the browser, including Stockfish (WASM). No account is needed.
- **Worker (`worker/`):** a Cloudflare Worker that serves `app/` at **https://checkmateprep.com** (production) and adds `/api`: optional sign-in (Auth0) and sync of opponents, names, drill progress and analysis results across devices, a shared store of chess.com games (R2), and AI-written game plans (Claude). The app hides accounts and AI prep when there is no `/api` (GitHub Pages, `live-server`).

See `README.md` for the user-facing description.

## Layout

| Path | Role |
| --- | --- |
| `fetch.py`, `analyze.py`, `profile.py`, `explore.py` | Pipeline steps: download archives, engine-evaluate every move (cached per game), build profiles, opening explorer |
| `coach.py` | `refresh` runs the pipeline for you + friends, then rebuilds the report and the app data |
| `notes.py` | **Hand-written prep** (written by Claude from the analysis, not generated). Local only: gitignored, never committed or published. Without it, `build_report.py` skips the report |
| `build_report.py` | Renders `report.html` (the prep-book artifact) from profiles + `notes.py` |
| `build_app.py` | Writes an empty `app/prep.json` (hand-written prep never goes into `app/`) and stamps the service-worker cache name |
| `app/app.js` | UI: routing (`#me`, `#prep`, `#prep/<user>`, `#explore`, `#drill[/id]`, `#setup`) and all screens |
| `app/chesscom.js`, `app/store.js` | chess.com API client; IndexedDB (games, analysis) + localStorage (profile, names, small settings) |
| `app/stats.js`, `app/plan.js` | Opening trees, profile stats, weak lines; the automatic game plan |
| `app/engine.js`, `app/analysis.js` | Stockfish worker wrapper; game review, trap finder, puzzles |
| `app/board.js`, `app/pieces.js` | SVG board with tap-to-move; piece artwork |
| `tests/` | Node (`node:test`) tests for the app modules, Python `unittest` for the pipeline; synthetic fixtures |
| `app/sync.js`, `app/syncdoc.js` | Optional account: Auth0 sign-in and when to sync; what syncs and how copies merge (also used by the Worker) |
| `app/results.js`, `app/resultsdoc.js` | Analysis results (reviews, trap scans, AI plans) on the account: upload and pull; what's accepted and which copy wins (also used by the Worker) |
| `app/vendor/` | Vendored `chess.js` 1.4.0, Stockfish 19 lite single-threaded (GPL, see `COPYING.txt`) and the Auth0 SPA SDK 2.27.0 (MIT) |
| `worker/`, `wrangler.toml` | The Worker: `/api/config`, `/api/sync` and `/api/results` (D1), `/api/games` (shared game store, R2), `/api/event` (usage stats, Analytics Engine), Auth0 token checks, `/api/health` and `/api/prep` (AI prep: `prep.js` runs Claude in a Workflow, `prompt.js` holds the instructions); environments `dev`, `test`, `production` |
| `app/track.js`, `scripts/stats.mjs` | Usage stats: which screens are opened (never usernames or opponents); `npm run stats` reads them |
| `ops/auth0/` | Auth0 Action that notifies new sign-ups (ntfy.sh), and the script that deploys it (runs in `deploy.yml`) |

Gitignored and rebuilt locally: `data/` (games, analysis, profiles), `bin/` (native Stockfish, auto-downloaded), `report.html`, `node_modules/`, `.wrangler/`, `.dev.vars`.

## Commands

```bash
python3 coach.py refresh               # pipeline for everyone, then report + app data
python3 build_app.py                   # after ANY change in app/ (see below)
npx live-server app --port=8766        # local preview with auto-reload (no /api, so no accounts)
npm run dev                            # app + Worker at http://localhost:8787 (accounts need .dev.vars)
node --test 'tests/*.test.mjs'         # app tests (Node 22+, see .nvmrc)
python3 -m unittest discover -s tests  # pipeline tests
```

## Rules that matter

- **`app/` changes need `python3 build_app.py`.** It hashes the app into the service worker's cache name; without a new name, installed apps keep serving the old files. A project hook runs it automatically after Claude edits a file in `app/`; run it yourself after edits made any other way.
- **Everything in `app/` is public**, including `prep.json` (the hand-written prep). Never put secrets or private data there.
- **No build step or framework.** Plain ES modules; libraries are vendored. Keep it that way unless there's a strong reason. (The Worker is bundled by Wrangler; that doesn't touch `app/`.)
- **The Anthropic key lives only in the Worker** (`ANTHROPIC_API_KEY` secret, per GitHub Environment). Never in `app/`, `wrangler.toml` or a commit. AI prep must stay optional: without `/api/health` answering `ai: true`, step 3 of an opponent's file is the quick plan built on the device.
- **Accounts are optional.** Everything must keep working signed out and without `/api`. Only data the user typed or earned syncs (`syncdoc.js`), plus what their device computed (`resultsdoc.js`); a new synced field or result needs a merge rule and a test.
- **The game store knows no one.** `/api/games` is shared by all users: never store or log an account, address or anything linking a player to who looked them up. If it fails, the app must fall back to chess.com.
- **checkmateprep.com is permanent.** Browsers keep each user's data per address, so never move production to another domain or add a second production address; `www` only redirects. The host behind the domain can change.
- **Offline mode is disabled on localhost** (in `app.js` and `sw.js`) so local edits always show. Don't remove that.
- **Engine calls go through `analyseSafe` and long jobs through `whileAwake`** (`engine.js`). Browsers pause hidden pages and the engine with them; timeouts only count visible time, and a stuck worker is replaced.
- **Scores:** trees store points ×2 as integers (`p`), `pct(p, n)` gives the percentage. A score is always from the named player's point of view (win 1, draw ½, loss 0).
- **Opponent names:** use `displayName(user)`, never `username` directly, in anything shown to the user.
- **Copy:** plain, short sentences; opponents are "they", not "he". Numbers in the UI must be counted from real games, and small samples should say how many games they rest on.

## Testing

- Automated tests live in `tests/` (not `app/`, which is published). `tests/helpers.mjs` fakes IndexedDB, `fetch` and the Stockfish worker, so app logic runs in Node without a browser or engine. CI (`.github/workflows/test.yml`) runs both suites on every PR and keeps one "Test results" comment on the PR up to date (built by `tests/summary-reporter.mjs` and `tests/run_pipeline.py --summary`). The job names are required checks on `main`: don't rename them without updating the GitHub ruleset.
- Fixtures are synthetic games in `tests/fixtures/`. Never copy real games from `data/` or friends' usernames into tests. `parity.json` holds values that the JS and Python suites both check, so the app and the pipeline agree.
- Coverage: add `--experimental-test-coverage --test-coverage-exclude='app/vendor/**' --test-coverage-exclude='tests/**'` to the node command; for Python, `python3 -m coverage run -m unittest discover -s tests && python3 -m coverage report` (`pip install -r requirements-dev.txt`).
- `fakeD1()` in `tests/helpers.mjs` runs the Worker's SQL on an in-memory `node:sqlite`, so D1 handlers (`worker/results.js`) are tested without Cloudflare.
- Not covered yet: `app.js` (UI), `board.js`, `sw.js`, `sync.js` (sign-in and syncing), the Worker's `sync.js`, `prep.js` and `index.js`, `build_report.py`. Check those in the preview; for accounts, run two browser profiles against `npm run dev`.
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
