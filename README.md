# Checkmate Prep

**Know your next opponent before the game.** Checkmate Prep (https://checkmateprep.com) prepares you for games against the people you play on chess.com. This repository, `chess-coach`, holds the web app and the personal pipeline it grew out of.

It started as a personal chess coach for preparing games against friends on chess.com.

It downloads your games and your friends' games from the chess.com public API, runs Stockfish over them, and builds a profile of each player: openings and how they score with them, where their mistakes happen (opening, middlegame or endgame), how they handle the clock, and positions where they repeat the same mistake. The conclusions go into `notes.py`, and `build_report.py` turns everything into a prep book page with game plans, opening traps and drills from your own games.

**How it's built:** this project is being built iteratively with Claude Code. [`docs/build-log.md`](docs/build-log.md) records every request, word for word, and what came of it.

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

`app/` is an installable web app (PWA). Its home is **https://checkmateprep.com**, served by the Cloudflare Worker (with accounts). The GitHub Pages copy at https://simonletort.github.io/chess-coach/ stays up without accounts. Open it on a device and choose **Add to Home Screen**. Anyone can use it: enter your chess.com username, then add the people you play. No account is needed, because everything used is public on chess.com. An optional account keeps your opponents, names and drill progress the same on your phone and laptop.

- **Prep:** an automatic file on each opponent, built locally from up to 1,500 of their recent games. It covers ratings, your head-to-head record, how they play, and the lines where they score badly. **Find traps** runs Stockfish on the device over the positions they reach most often and flags moves they keep repeating that the engine refutes, with the punishing line.
- **Game plan:** every opponent file gets an automatic plan for both colours: which opening to play (preferring ones you already play, and ranked on a sample-adjusted score so a few lucky games can't decide it), what they usually answer, the engine-checked trap to aim for, lines where they score badly, and advice on time control, clock and game length. Every number is counted from their games; no AI writes it.
- **Explore:** tap through an opening and see what an opponent (or you) played next and how it scored.
- **Drill:** punish each opponent's traps, play prepared lines from memory, and solve positions from your own games. Wrong answers are checked by the engine, so an equally good move also counts.
- **You:** your profile plus an engine review of your games (blunders by phase, converting wins, punishing blunders, the clock). Your worst moments become puzzles.

Everything is stored in the device's browser (IndexedDB). The engine is Stockfish 19 lite (single-threaded WASM, about 1.8 MB) in a Web Worker. It runs at roughly 10 seconds per game review and 1–3 minutes per trap scan.

The hand-written prep in `notes.py` still ships in `app/prep.json`. It shows up as "Hand-written prep" for the opponents it covers, and it's added automatically when the player it was written for sets up the app. `python3 coach.py refresh` rebuilds it; pushing `app/` to `main` redeploys the site.

### Accounts and sync

Signing in is optional. It keeps your chess.com username, your opponents, the names you gave them and your drill progress the same on every device. Games and engine results aren't synced: each device downloads and analyses them itself.

- **Sign-in** is handled by [Auth0](https://auth0.com) (free plan): Google, or a one-time link by email. The app never sees a password.
- **Sync** runs on a Cloudflare Worker (`worker/`) with a D1 database. Each account has one small document (`app/syncdoc.js`). On every change, and whenever the app comes back into view, a device sends its copy and gets back the merge with the other devices'. For each opponent the latest change wins; drill progress from all devices adds up. Removals reach the other devices too.
- **Where it runs:** accounts only appear when the app is served by the Worker. On GitHub Pages (no `/api`) the app works as before, without the Sign in button.
- **Privacy:** the server stores the Auth0 user id and that document, nothing else. **Delete synced data** in Settings removes it.

| File | What it does |
| --- | --- |
| `app/sync.js` | Sign-in (Auth0 SPA SDK, vendored in `app/vendor/auth0/`), when to sync, applying changes from other devices |
| `app/syncdoc.js` | What syncs and how two copies merge; shared by the app and the Worker |
| `worker/index.js`, `worker/sync.js`, `worker/auth.js` | `/api/config` (is sign-in set up?), `/api/sync` (merge and store, delete), checking Auth0 tokens |
| `wrangler.toml` | The Worker and its environments (`dev`, `test`, `production`): Auth0 settings, D1 database, rate limit |
| `.github/workflows/deploy.yml` | Deploys `main` to production and `dev` to dev. Run it by hand to deploy any environment |
| `tests/syncdoc.test.mjs` | Merge rules, run with the other app tests (`npm test`) |

#### Domain: checkmateprep.com

The product domain is **checkmateprep.com**, registered at Cloudflare Registrar in the same Cloudflare account as the Worker. The browser keeps each user's data (games, analysis, settings, the installed app) per address, so this address must never change once people use it; the host behind it can.

| Address | What it is |
| --- | --- |
| `checkmateprep.com` | The app and `/api` (production Worker, set as a custom domain in `wrangler.toml`) |
| `www.checkmateprep.com` | Redirects to `checkmateprep.com` (`worker/index.js`) |
| `login.checkmateprep.com` | Auth0 sign-in page (Auth0 custom domain, set up below) |
| `chess-coach-dev.…workers.dev`, `chess-coach-test.…workers.dev` | The dev and test environments. Production has no workers.dev address, so there is only one place its data can live |

- **DNS** is managed in Cloudflare. Deploying the production Worker creates the records for `checkmateprep.com` and `www`; if a record already exists on either name (a parking page, for example), delete it first or the deploy fails.
- **Email:** Cloudflare Email Routing (free) can forward an address like `hello@checkmateprep.com` to a personal inbox, for Auth0, payment and user mail. Sending sign-in emails needs a sending provider (below).
- **Protect the domain:** auto-renew on, two-factor sign-in on the Cloudflare account.

One-time setup:

1. **Auth0:** create a tenant (one per environment, or one for all). Add an **API** (its identifier is `AUTH0_AUDIENCE`, for example `https://api.checkmateprep.com` (an identifier only; nothing needs to answer there)) and turn on **Allow Offline Access** so the app stays signed in. Add a **Single Page Application** (its Client ID is `AUTH0_CLIENT_ID`). In the application, set **Allowed Callback URLs**, **Allowed Logout URLs** and **Allowed Web Origins** to the Worker's address (`https://checkmateprep.com` in production), and turn on **Refresh Token Rotation**. Under Authentication, turn on Google and/or Passwordless Email. Auth0's built-in email sender is for testing only: for sign-in links in production, set up your own email provider in Auth0 (Resend, Amazon SES, …), sending from an address on `checkmateprep.com` and adding the provider's SPF and DKIM records in Cloudflare DNS. For a branded sign-in page, add the Auth0 custom domain `login.checkmateprep.com` (free plan, needs a card on file): create the CNAME Auth0 gives you in Cloudflare DNS with the proxy **off** (grey cloud), then use `login.checkmateprep.com` as `AUTH0_DOMAIN`.
2. **wrangler.toml:** fill in `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID` and `AUTH0_AUDIENCE` for each environment. They're public values, not secrets. Left empty, the app runs without accounts.
3. **Cloudflare:** create an API token from the **Edit Cloudflare Workers** template (with D1 edit access), and note your account ID.
4. **GitHub:** in **Settings → Environments**, create `dev`, `test` and `production`, each with the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Until then, the deploy workflow skips Cloudflare and says so.

The first deploy of each environment creates its D1 database, and the Worker creates its table on first use. Production is then at `https://checkmateprep.com`, and dev and test at `chess-coach-dev.<your-subdomain>.workers.dev` and `chess-coach-test.…`.

To run the Worker locally (Node 22+):

```bash
npm install
npm test                         # app tests, including the merge rules
cp .dev.vars.example .dev.vars   # optional: a dev Auth0 tenant's values turn on accounts
npm run dev                      # app + API at http://localhost:8787
```

### Developing the app

```bash
npx live-server app --port=8766
```

This serves `app/` at http://localhost:8766 and reloads the page on every save. Offline mode is turned off on `localhost` so edits always show up; it only runs on the published site.

## Limits

chess.com's public API exposes puzzle ratings but not puzzle history, so tactical drills come from positions in your real games.
