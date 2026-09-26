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
- **Explore:** tap through an opening and see what an opponent (or you) played next and how it scored.
- **Drill:** punish each opponent's traps, play prepared lines from memory, and solve positions from your own games. Wrong answers are checked by the engine, so an equally good move also counts.
- **You:** your profile plus an engine review of your games (blunders by phase, converting wins, punishing blunders, the clock). Your worst moments become puzzles.

Everything is stored in the device's browser (IndexedDB). The engine is Stockfish 19 lite (single-threaded WASM, about 1.8 MB) in a Web Worker. It runs at roughly 10 seconds per game review and 1–3 minutes per trap scan.

The hand-written prep in `notes.py` still ships in `app/prep.json`. It shows up as "Hand-written prep" for the opponents it covers, and it's added automatically when the player it was written for sets up the app. `python3 coach.py refresh` rebuilds it; pushing `app/` to `main` redeploys the site.

### AI-written prep

On an opponent's Prep page, **Write the plan** sends their statistics, lines, head-to-head record and any traps Stockfish found to Claude, which writes a plan in the same format as the hand-written prep. The plan is saved on the device, and its lines show up in Drill.

The Anthropic API key can't live in a public website, so the app is also served by a Cloudflare Worker (`worker/index.js`) that holds the key and calls Claude. The button only appears when the app is served by that Worker. On GitHub Pages and on a plain static server it stays hidden.

The Worker limits cost in four ways. It only accepts requests from the app's own origin. It has a per-minute rate limit per IP address. It has daily caps per IP address and overall. It caches each plan for 30 days, so identical statistics never pay twice. The real backstop is a spend limit on the Anthropic workspace that holds the key.

Everything except secrets is in the repo:

| File | What it does |
| --- | --- |
| `wrangler.toml` | The Worker and its environments (`dev`, `test`, `production`): model, daily limits, rate limits, KV cache |
| `worker/index.js`, `worker/prompt.js` | The `/api/prep` endpoint, the instructions for Claude and the output schema |
| `.github/workflows/deploy.yml` | Deploys `main` to production and `dev` to dev. Run it by hand to deploy any environment |

One-time setup:

1. In the [Anthropic Console](https://console.anthropic.com), create a workspace per environment, each with a spend limit and an API key.
2. In Cloudflare, create an API token from the **Edit Cloudflare Workers** template, and note your account ID.
3. In GitHub, go to **Settings → Environments** and create `dev`, `test` and `production`, each with the secrets `ANTHROPIC_API_KEY`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

The first deploy of each environment creates its KV namespace. After that the app is at `https://chess-coach.<your-subdomain>.workers.dev`, and at `chess-coach-dev.…` and `chess-coach-test.…` for the other environments.

To run it locally (Wrangler needs Node 22+):

```bash
npm install
cp .dev.vars.example .dev.vars   # add a dev-workspace key
npm run dev                      # app + API at http://localhost:8787
```

### Developing the app

```bash
npx live-server app --port=8766
```

This serves `app/` at http://localhost:8766 and reloads the page on every save. Offline mode is turned off on `localhost` so edits always show up; it only runs on the published site.

## Limits

chess.com's public API exposes puzzle ratings but not puzzle history, so tactical drills come from positions in your real games.
