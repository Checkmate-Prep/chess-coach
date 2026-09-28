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
| `notes.py` | The coach's written conclusions and prepared lines (only on the `ai-prep` branch) |
| `build_report.py` | Renders the prep book (`report.html`) |
| `build_app.py` | Packages the hand-written prep for the web app (`app/prep.json`) and versions its offline cache |

## Web app

`app/` is an installable web app (PWA). Its home is **https://checkmateprep.com**, served by the Cloudflare Worker (with accounts). The GitHub Pages copy at https://checkmate-prep.github.io/chess-coach/ stays up without accounts. Open it on a device and choose **Add to Home Screen**. Anyone can use it: enter your chess.com username, then add the people you play. No account is needed, because everything used is public on chess.com. An optional account keeps your opponents, names and drill progress the same on your phone and laptop.

- **Prep:** an automatic file on each opponent, built locally from up to 1,500 of their recent games. It covers ratings, your head-to-head record, how they play, and the lines where they score badly. **Find traps** runs Stockfish on the device over the positions they reach most often and flags moves they keep repeating that the engine refutes, with the punishing line.
- **Game plan:** every opponent file gets an automatic plan for both colours: which opening to play (preferring ones you already play, and ranked on a sample-adjusted score so a few lucky games can't decide it), what they usually answer, the engine-checked trap to aim for, lines where they score badly, and advice on time control, clock and game length. Every number is counted from their games; no AI writes it.
- **Explore:** tap through an opening and see what an opponent (or you) played next and how it scored.
- **Drill:** punish each opponent's traps, play prepared lines from memory, and solve positions from your own games. Wrong answers are checked by the engine, so an equally good move also counts.
- **You:** your profile plus an engine review of your games (blunders by phase, converting wins, punishing blunders, the clock). Your worst moments become puzzles.

Everything is stored in the device's browser (IndexedDB). The engine is Stockfish 19 lite (single-threaded WASM, about 1.8 MB) in a Web Worker. It runs at roughly 10 seconds per game review and 1–3 minutes per trap scan.

Hand-written prep (`notes.py`) is kept on the `ai-prep` branch only, so `main` and the published site ship an empty `app/prep.json`. On a branch that has `notes.py`, it shows up as "Hand-written prep" for the opponents it covers. `python3 coach.py refresh` rebuilds it; pushing `app/` to `main` redeploys the site.

### Accounts and sync

Signing in is optional. It keeps your chess.com username, your opponents, the names you gave them and your drill progress the same on every device. Games and engine results aren't synced: each device downloads and analyses them itself.

- **Sign-in** is handled by [Auth0](https://auth0.com) (free plan): Google, or a one-time code by email. The app never sees a password.
- **Sync** runs on a Cloudflare Worker (`worker/`) with a D1 database. Each account has one small document (`app/syncdoc.js`). On every change, and whenever the app comes back into view, a device sends its copy and gets back the merge with the other devices'. For each opponent the latest change wins; drill progress from all devices adds up. Removals reach the other devices too.
- **Where it runs:** accounts only appear when the app is served by the Worker. On GitHub Pages (no `/api`) the app works as before, without the Sign in button.
- **Privacy:** for sync, the server stores the Auth0 user id and that document, nothing else. **Delete account** in Settings removes it, and the copy on that device too. Signing out also clears the device, so the next visit starts from the welcome screen. Usage stats are separate (below).

| File | What it does |
| --- | --- |
| `app/sync.js` | Sign-in (Auth0 SPA SDK, vendored in `app/vendor/auth0/`), when to sync, applying changes from other devices |
| `app/syncdoc.js` | What syncs and how two copies merge; shared by the app and the Worker |
| `worker/index.js`, `worker/sync.js`, `worker/auth.js` | `/api/config` (is sign-in set up?), `/api/sync` (merge and store, delete), checking Auth0 tokens |
| `worker/events.js`, `app/track.js` | `/api/event`: which screens are opened (see Monitoring) |
| `wrangler.toml` | The Worker and its environments (`dev`, `test`, `production`): Auth0 settings, D1 database, usage stats dataset, rate limit |
| `.github/workflows/deploy.yml` | Deploys `main` to production and `dev` to dev. Run it by hand to deploy any environment |
| `tests/syncdoc.test.mjs` | Merge rules, run with the other app tests (`npm test`) |

### Monitoring

- **New accounts:** an Auth0 Action (`ops/auth0/notify-signup.js`) sends a phone notification through [ntfy.sh](https://ntfy.sh) the first time someone signs in to the production application, with their email and how they signed in. Dev and test sign-ins don't notify. It's deployed by `ops/auth0/deploy-actions.mjs` through the Auth0 Management API, and runs after each production deploy. It only touches this one Action and its place in the Login flow, and running it again changes nothing.
- **Usage:** each time a screen opens, the app (`app/track.js`) sends its name to `/api/event` (`worker/events.js`), which writes it to [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/). A screen that opens again after 30 minutes away counts as a new visit. Stored: the screen (`me`, `prep`, `prep-opp`, `explore`, `drill`, `drill-item`, `setup`, `add`, `welcome`, `start`, `signin`), a random id for the device, the Auth0 user id when signed in, and the country. Never usernames, opponents, games, the IP address or the browser. Data is kept 3 months. Settings has a **Share usage stats** switch (on by default). Nothing is sent on GitHub Pages or a static server.
- **Cloudflare:** Analytics Engine must be turned on once in each Cloudflare account that runs the Worker (**Workers → Analytics Engine → Enable**, free). Until then the deploy fails with code 10089. Production runs in the personal account for now; after moving it, turn it on in the project account too.
- **Reading it:** `CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run stats` prints active devices and signed-in accounts per day, screens, hours of the day (UTC) and the latest devices. Add `-- --env dev` or `-- --days 7` to change the environment or the period. The token needs **Account Analytics: Read**; a separate read-only token is best.

One-time setup for the sign-up notification:

1. **ntfy:** pick a long random topic name (for example `openssl rand -hex 16`). Anyone who knows it can read it. Install the ntfy app on your phone and subscribe to it.
2. **Auth0:** **Applications → Create Application → Machine to Machine**, named "Deploy actions", authorized on the **Auth0 Management API** with the permissions `read:actions`, `create:actions` and `update:actions`.
3. **GitHub:** in **Settings → Environments → `production`**, add the variable `AUTH0_MGMT_CLIENT_ID` and the secret `AUTH0_MGMT_CLIENT_SECRET` (from that application), and the secret `NTFY_TOPIC`. The Client ID isn't secret; a secret of that name also works. The next production deploy creates the Action; until then the deploy says it was skipped. To run it by hand: `AUTH0_MGMT_CLIENT_ID=… AUTH0_MGMT_CLIENT_SECRET=… NTFY_TOPIC=… npm run auth0:deploy`. Add `-- --force` to redeploy after changing the topic.

#### Domain: checkmateprep.com

The product domain is **checkmateprep.com**, registered at Cloudflare Registrar in the same Cloudflare account as the Worker. The browser keeps each user's data (games, analysis, settings, the installed app) per address, so this address must never change once people use it; the host behind it can.

| Address | What it is |
| --- | --- |
| `checkmateprep.com` | The app and `/api` (production Worker, set as a custom domain in `wrangler.toml`) |
| `www.checkmateprep.com` | Redirects to `checkmateprep.com` (`worker/index.js`) |
| `login.checkmateprep.com` | Auth0 sign-in page (Auth0 custom domain, set up below) |
| `dev.checkmateprep.com`, `test.checkmateprep.com` | The dev and test environments (their own Workers, databases and Auth0 application). No environment has a workers.dev address, so each one keeps its data in one place |

- **DNS** is managed in Cloudflare. Deploying the production Worker creates the records for `checkmateprep.com` and `www`; if a record already exists on either name (a parking page, for example), delete it first or the deploy fails.
- **Email:** Cloudflare Email Routing (free) can forward an address like `hello@checkmateprep.com` to a personal inbox, for Auth0, payment and user mail. Sending sign-in emails needs a sending provider (below).
- **Protect the domain:** auto-renew on, two-factor sign-in on the Cloudflare account.

#### Moving production to the project Cloudflare account

checkmateprep.com was registered in a personal Cloudflare account, so production (the Worker and its D1 database) runs there for now. Cloudflare only lets a domain move between accounts 10 days after registration. Then move everything to the project account together; users notice nothing, because the address and Auth0 stay the same.

Before you start (in the personal account):
- The registrant email is verified, with no pending registrant change, and **DNSSEC is off**.
- Write down every DNS record on checkmateprep.com, at least the `login` CNAME for Auth0 and any Email Routing records. A move keeps none of the old account's settings.
- Have a terminal in this repo with `npm install` done, and the personal account's token and ID at hand.

1. **Export the data** (personal account):
   ```bash
   export CLOUDFLARE_API_TOKEN=<personal token> CLOUDFLARE_ACCOUNT_ID=<personal account id>
   npx wrangler d1 export DB --remote --env production --table docs --no-schema --output prod.sql
   sed 's/^INSERT INTO/INSERT OR IGNORE INTO/' prod.sql > prod-import.sql
   ```
   `prod.sql` holds every account's synced data: keep it private and out of git.
2. **Move the domain:** in the personal account, open checkmateprep.com in **Domain Registration** and start the move to the project account; approve it from the project account's email within 5 days.
3. **Recreate the DNS records** you wrote down, in the project account. The `login` CNAME needs the proxy **off**. Then check that Auth0 still shows `login.checkmateprep.com` as Ready.
4. **Point every environment at the project account:** in GitHub, **Settings → Environments → `production`** (and `dev`, `test`), replace the secret `CLOUDFLARE_API_TOKEN` and the variable `CLOUDFLARE_ACCOUNT_ID` with the project account's (the token needs Workers, D1 edit and the checkmateprep.com zone).
5. **Deploy:** **Actions → Deploy to Cloudflare → Run workflow → `production`**, then `dev` and `test` (their data is test data: no export needed). This creates the Worker, the custom domains and an empty D1 database in the project account. If it fails because `checkmateprep.com` or `www` already has a record, delete that record and run it again.
6. **Import the data** (project account). Sign-ins between steps 5 and 6 are safe: `INSERT OR IGNORE` keeps a row written since, and devices re-send their own data on their next sync.
   ```bash
   export CLOUDFLARE_API_TOKEN=<project token> CLOUDFLARE_ACCOUNT_ID=<project account id>
   npx wrangler d1 execute DB --remote --env production --command "CREATE TABLE IF NOT EXISTS docs (sub TEXT PRIMARY KEY, doc TEXT NOT NULL, ver INTEGER NOT NULL, updated INTEGER NOT NULL)"
   npx wrangler d1 execute DB --remote --env production --file prod-import.sql
   ```
7. **Check:** https://checkmateprep.com loads, `www` redirects, and signing in shows your opponents.
8. **Clean up:** delete the old Workers (`chess-coach`, `chess-coach-dev`, `chess-coach-test`) and their D1 databases in the personal account, delete the personal account's API token, and delete `prod.sql` and `prod-import.sql`.

One-time setup:

1. **Auth0:** the free plan allows one tenant, `checkmateprep.us.auth0.com` (US region), shared by all environments. It has one **API**, identifier `https://api.checkmateprep.com` (`AUTH0_AUDIENCE`; an identifier only, nothing needs to answer there), signing algorithm RS256, with **Allow Offline Access** on so the app stays signed in. It has two **Single Page Applications**, each with **Refresh Token Rotation** on, and each authorized on the API (**APIs → the API → Application Access → the application → User Access: Authorized**). Without that, sign-in comes back with "Client … is not authorized to access resource server":

   | Application | Used by | Callback, logout URLs | Web origins, CORS | `AUTH0_DOMAIN` |
   | --- | --- | --- | --- | --- |
   | Checkmate Prep | production | `https://checkmateprep.com/` | `https://checkmateprep.com` | `login.checkmateprep.com` |
   | Checkmate Prep - non prod | dev, test, `npm run dev` | `http://localhost:8787/`, `https://dev.checkmateprep.com/`, `https://test.checkmateprep.com/` | the same without `/` | `checkmateprep.us.auth0.com` |

   Users are shared by both applications, so test sign-ins show up in the production user list; delete them afterwards. Synced data stays separate (each environment has its own D1 database). The password database is switched off for both applications. Under Authentication, turn on Google and/or Passwordless Email. Auth0's built-in email sender is for testing only: for sign-in codes in production, set up your own email provider in Auth0 (Resend, Amazon SES, …), sending from an address on `checkmateprep.com` and adding the provider's SPF and DKIM records in Cloudflare DNS. For a branded sign-in page, add the Auth0 custom domain `login.checkmateprep.com` (free plan, needs a card on file): create the CNAME Auth0 gives you in Cloudflare DNS with the proxy **off** (grey cloud), then use `login.checkmateprep.com` as `AUTH0_DOMAIN` (done for production). Google's OAuth client needs both `https://login.checkmateprep.com/login/callback` and `https://checkmateprep.us.auth0.com/login/callback` as redirect URIs, since the dev application signs in on the tenant's own address.
2. **wrangler.toml:** `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID` and `AUTH0_AUDIENCE` per environment. They're public values, not secrets. Production uses the Checkmate Prep application; dev and test share Checkmate Prep - non prod. Left empty, an environment runs without accounts.
3. **Cloudflare:** create an API token from the **Edit Cloudflare Workers** template (with D1 edit access), and note your account ID.
4. **GitHub:** in **Settings → Environments**, create `dev`, `test` and `production`, each with the secret `CLOUDFLARE_API_TOKEN` and the variable `CLOUDFLARE_ACCOUNT_ID` (not secret; a secret of that name also works). All three use the Cloudflare account that holds checkmateprep.com, so the same token and ID work for each. Until then, the deploy workflow skips Cloudflare and says so.

The first deploy of each environment creates its D1 database, and the Worker creates its table on first use. Production is then at `https://checkmateprep.com`, and dev and test at `https://dev.checkmateprep.com` and `https://test.checkmateprep.com`. All three must deploy to the Cloudflare account that holds the checkmateprep.com zone, since deploying creates their DNS records.

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
