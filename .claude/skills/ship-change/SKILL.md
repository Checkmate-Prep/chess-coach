---
name: ship-change
description: The checklist for landing any change in this repo, from branch to PR to build-log entry. Use when finishing a change, before opening or updating a pull request.
allowed-tools: Bash(python3 build_app.py) Bash(node --check *) Bash(npm test) Bash(git status *) Bash(git diff *) Bash(git log *) Bash(gh pr view *) Bash(gh pr list *)
---

# Ship a change

## 1. Branch

- If the change belongs to an open PR on the same topic, add it there; otherwise start a new branch from an up-to-date `main` (`git fetch && git checkout -b <topic> origin/main`).
- Never commit to `main` directly.

## 2. Build and check

- After editing `app/`, the project hook runs `python3 build_app.py` automatically. After edits made outside Claude's tools, run it yourself: it stamps the service-worker cache name, and without that, installed apps keep the old files.
- Syntax-check changed modules (they are ES modules, so check a `.mjs` copy):
  ```bash
  for f in app board store chesscom stats engine analysis plan sync syncdoc; do cp app/$f.js /tmp/chk-$f.mjs && node --check /tmp/chk-$f.mjs || echo "FAIL $f"; done
  ```
- If `worker/`, `app/syncdoc.js` or `app/sync.js` changed: `npm test`, and try the API with `npm run dev` (app + Worker at http://localhost:8787).
- Preview with `npx live-server app --port=8766` and check the change at phone size (375×812) in the built-in browser. If the browser pane is hidden, the engine stalls; don't read that as a bug.
- Clear test data afterwards: `localStorage` and the `chess-prep` IndexedDB database.

## 3. Commit

- Stage files by name. Don't use `git add -A`: untracked local files (for example `.wrangler/`, `node_modules/` or `data/` on some branches) are easy to pick up.
- Commit message: what changed and why.

## 4. Pull request

- Title says what the user gets. The body covers what changed, why, what was tested, and what wasn't (be explicit about anything the built-in browser can't test, like offline mode or the engine with a hidden pane).
- When adding to an existing PR, update its title and description to match.

## 5. Build log

Add an entry to `docs/build-log.md` for the request, following the existing format: the prompt word for word (lightly cleaned where privacy needs it: friends as Friend A/B, replaced text in [brackets]), what Claude did, what changed along the way, and the PR link.
