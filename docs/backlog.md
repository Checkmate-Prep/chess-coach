# Backlog

How work is ordered, and the ideas that aren't issues yet.

## How the work is organized

- **Issues are the scheduled work.** One issue = one PR. Priority is the order below; at most two in progress.
- **Milestones are the goals.** Fixes go to "Before real users"; coaching features to "Better coaching".
- **Refactor where you're already working.** Cleanups ride in the feature PR that touches that code. Only an enabling refactor gets its own issue.
- **The parking lot** (below) holds ideas, polish and cleanups that aren't scheduled. They become issues only when they're about to be worked on.
- **Sprint review** (about weekly): close what's done, promote at most two parking-lot items to issues, and re-order the rest using what users actually open (`npm run stats`).

## Order of work

From the code review of October 2026. Each sprint is about a week.

| Sprint | Goal | Issues |
| --- | --- | --- |
| 1 | Nothing looks broken or loses data | #124 stray `}` and plan caption · #125 offline after an update · #126 missing games · #127 set-up positions, move validation |
| 2 | Numbers you can trust; code ready for features | #128 drill and scan identity · #129 plan numbers and copy · #130 start-up without waiting · #131 split `app.js` |
| 3 | The opponent file answers "how do I beat them?" first | #132 plan first, every main first move · #133 choose the time control |
| 4 | Prep for the games you'll really play | #134 likely positions · #135 drill sessions |
| 5 | Practice that feels like the real game | #136 spar against their repertoire · #137 punish their blunders |
| 6 | Smarter signals, closing the loop | #138 where they slow down · #139 after the game · #140 AI plan uses the new signals |

## Parking lot

Not scheduled. Promote an item by opening an issue (with a milestone and "Done when") and removing it here.

**Coaching**
- Filter an opponent's games to players near your rating (about ±200).
- Opening names next to lines (games already carry chess.com's opening name).
- Kinds of mistakes they make (hanging piece, missed capture, back rank), as `profile.py` already counts missed captures.

**UX**
- Explore past move 8 says "No games reach this position": the tree stops at 16 plies; say so.
- Board usable with a keyboard and a screen reader.
- Underpromotion: the board always promotes to a queen.
- "Remove" opponent: confirm, and clean up their games, reviews and traps.
- Welcome page promises AI where it isn't available (GitHub Pages, offline).
- "1…Nf6 ×29 (50%)" reads better as "29 games, 50%".
- "Review 20 more games" on You stays clickable when nothing is left to review.

**Code health**
- Store each game's review separately: `review:<player>` is rewritten whole after every game.
- Cache derived stats (`profile()`, `summarize()`, the depth-6 trees), recomputed on every render.
- A job manager for background work (downloads, reviews, trap scans, AI jobs) instead of the maps kept in step by hand in `app.js`.
- Dead code: `bestUci`, `prep.json`; rename `oppName` (it's the username).
- One rule for "this line is weak": shrink small samples (as `plan.js` does) and compare to the player's own overall score.

**Pipeline**
- `analyze.py`: `tar.extractall` without `filter="data"`.
- `coach.py` hard-codes friends' usernames and first names in a public repo.
