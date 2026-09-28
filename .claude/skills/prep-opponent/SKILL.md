---
name: prep-opponent
description: Write hand-written prep for a chess.com opponent (like the plans for the two friends in notes.py). Use when asked to "prepare", "prep" or "write a plan for" a specific opponent or chess.com username.
argument-hint: <chess.com username> [display name]
allowed-tools: Bash(python3 fetch.py *) Bash(python3 analyze.py *) Bash(python3 profile.py *) Bash(python3 explore.py *) Bash(python3 build_report.py)
---

# Prepare an opponent

Hand-written prep is Claude's own analysis, written into `notes.py`. The pipeline supplies the evidence; you draw the conclusions and check every recommended line with Stockfish. The result appears in the prep book (`report.html`); the app doesn't show hand-written prep.

**Local only:** `notes.py` is gitignored and must never be committed: this repo is public. If it's missing, ask the user for their copy (or restore an old version with `git show 72f215e:notes.py > notes.py`).

**Privacy first.** `notes.py` is about real people. Keep it out of commits, `app/` and anything published.

## 1. Get the data

```bash
python3 fetch.py <user> 12                        # last 12 months of games
python3 analyze.py <user> 150 blitz,daily,rapid   # engine pass, cached per game (~5 s/game)
python3 profile.py <user>                          # writes data/<user>.profile.json and prints it
```

Run the analysis in the background; 150 games takes 10–20 minutes. Add the player to `FRIENDS` in `coach.py` so `coach.py refresh` keeps them current.

## 2. Find what to play

- **Repertoire:** from the profile, note their first move as White, their replies to 1.e4 and 1.d4, and their main lines with scores.
- **Drill into candidate lines** with the explorer. Their score after each move is what matters; below 45% on 15+ games is worth a look:
  ```bash
  python3 explore.py <user> white "e4 e5 Nf3"
  python3 explore.py <user> black "d4 d5 Bf4"
  ```
- **Repeated mistakes:** `profile.py` prints `repeated_early_mistakes` (position + move played at least twice that the engine dislikes). These become traps.
- **Check every line you recommend with Stockfish** (depth 20+, MultiPV 3), including the opponent's likely replies and the natural wrong move for our side:
  ```python
  import chess, chess.engine
  e = chess.engine.SimpleEngine.popen_uci("bin/stockfish/stockfish-macos-universal")
  b = chess.Board(); [b.push_san(m) for m in "e4 e5 Nf3 Nf6 Bc4 Bc5".split()]
  for i in e.analyse(b, chess.engine.Limit(depth=22), multipv=3):
      print(b.san(i["pv"][0]), i["score"].white(), b.variation_san(i["pv"][:8]))
  e.quit()
  ```
- Prefer openings the user already plays (check the user's own tree with `explore.py slnyc white ""`).

## 3. Write the entry

Add the opponent to `FRIENDS` in `notes.py`, following the existing entries:

- `name`, `anchor`, `summary` (two or three plain sentences on who they are and how to beat them)
- `stats`: five `(value, label)` pairs such as main rating, games, record against the user
- `style`, `weak`: bullet lists; every claim backed by a count from their games
- `plans`: one per colour, each with `eyebrow` ("You have White"), `title`, `body` (paragraphs), `table` (line, games, their score), `line` (SAN moves for the board), `key_from` (ply where the gold moves start), `flip` (true when the user has Black), `caption`, and `watch` (`color`, `prefix`, `expect`: the move the trap relies on, so the app can flag if they stop playing it)
- `checklist`: game-day reminders, including which time control to ask for

Copy rules: short plain sentences, "they" for opponents, numbers counted from real games, and say how many games a number rests on.

## 4. Build the prep book

```bash
python3 build_report.py
```

Open `report.html` to check the opponent's section. Nothing to commit: `notes.py` and `report.html` are both gitignored and stay on this machine.
