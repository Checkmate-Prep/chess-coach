# Contributing to Checkmate Prep

Thanks for helping. Checkmate Prep (https://checkmateprep.com) is built in the open, mostly with Claude Code. Every request and what came of it is in [`docs/build-log.md`](docs/build-log.md).

## Ways to help

- **Report a bug or suggest an idea:** [open an issue](https://github.com/Checkmate-Prep/chess-coach/issues/new). For a bug, say what you did, what you expected and what happened, plus your device and browser. Please search the open issues first.
- **Pick up an issue:** the [open issues](https://github.com/Checkmate-Prep/chess-coach/issues) are the todo list. Comment on one before you start, so two people don't work on the same thing.
- **Send a pull request:** small, focused changes are easiest to review. For anything bigger, open an issue first to agree on the approach.

Never put your own or anyone else's private data (chess.com games of real people, emails, keys) in an issue or pull request. The repo is public.

## Run it locally

You need Node 22+ (see `.nvmrc`). Python 3 is only needed for the pipeline and `build_app.py`.

```bash
npm install
pip install -r requirements.txt
npx live-server app --port=8766   # the web app, without accounts or AI prep
npm run dev                       # app + Worker at http://localhost:8787
```

The app works fully without `/api`: games, stats, traps, game plans and drills all run in the browser. Accounts and AI prep need a `.dev.vars` file (copy `.dev.vars.example`) with your own dev Auth0 tenant and Anthropic key. Most changes don't need them.

## How the code is organised

- `app/`: the web app. Plain ES modules with no framework and no build step. Libraries are vendored in `app/vendor/`.
- `worker/`: the Cloudflare Worker that serves the app and adds `/api` (sign-in, sync, shared game store, AI prep).
- The Python files at the root (`fetch.py`, `analyze.py`, `profile.py`, …): the original pipeline that runs on a Mac.
- `tests/`: Node tests for the app and the Worker, Python tests for the pipeline.

[`CLAUDE.md`](CLAUDE.md) has the full map, and the [README](README.md) explains each feature.

## Rules that matter

- **After any change in `app/`, run `python3 build_app.py`.** It updates the service worker's cache name. Without it, installed apps keep the old files.
- **Everything in `app/` is public.** No secrets or private data there. API keys live only in the Worker's secrets.
- **Keep it simple:** no framework or build step in `app/`.
- **Accounts and AI are optional.** Everything must keep working signed out, and on a plain static server.
- **Privacy:** the shared game store must never record who looked up a player. New stored data needs an update to [`app/privacy.html`](app/privacy.html).
- **Copy:** plain, short sentences. Opponents are "they". Numbers shown to users are counted from real games.

## Tests

```bash
npm test                                # app and Worker tests
python3 -m unittest discover -s tests   # pipeline tests
```

Add or update tests for logic you change. Test fixtures are synthetic games in `tests/fixtures/`. Never copy real people's games or usernames into tests. UI changes (`app.js`, `board.js`) aren't covered by tests yet. Check them in a browser at phone size (375×812) and on desktop.

## Pull requests

1. Branch from an up-to-date `main`. Use one branch and one pull request per change.
2. Write commit messages that say what changed and why.
3. In the pull request, say what changed, why, what you tested and what you didn't. If it fixes an issue, add `Closes #<number>`.
4. CI runs both test suites on every pull request, and they must pass. Pull requests from the main repository also deploy to https://dev.checkmateprep.com. Pull requests from forks don't have the deploy secrets, so a maintainer checks them on dev.
5. After merging, the maintainer adds an entry to `docs/build-log.md`.

## Working with Claude Code

This project is set up for [Claude Code](https://claude.com/claude-code): `CLAUDE.md` gives it the project's rules, and `.claude/` holds shared settings, a hook that runs `build_app.py` after edits in `app/`, and skills such as `/ship-change` (the checklist for landing a change). Using it is optional. Human-written pull requests are just as welcome.

## Licence

The repository doesn't have a licence file yet. Until it has one, ask in an issue before reusing the code elsewhere. The vendored Stockfish is GPL (see `app/vendor/stockfish/`).
