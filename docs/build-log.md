# Build log

How this project is being built with [Claude Code](https://claude.com/claude-code), one request at a time.

Each entry quotes the prompt **word for word**, lightly cleaned where privacy needs it: friends appear as Friend A and Friend B, a local folder path is shortened, and replaced text is shown in [brackets]. Two typos were fixed. Then it says what Claude did, what changed along the way, and which pull request came out of it. Answers picked from multiple-choice questions Claude asked are shown as *Choice*.

**Summary:** from "I'd like an AI chess coach" to an installable web app with on-device Stockfish, automatic game plans and drills, in 7 pull requests over two days (26–27 September 2026).

---

## 1. A coach on the Mac

### 1. The idea
> I'd like to have an ai chess coach that would help me prepare games against friends who play on chess.com
> coach would learn my style, strength and weaknesses from my previous games and puzzles on chess.com
> and also analyze my friends style on chess.com to help me get ready for our games

**What Claude did:** checked that chess.com's public API was reachable and that Python was available, proposed a plan (download games, analyze them with Stockfish, profile each player, write prep per friend), and asked for the usernames. It flagged a limit early: the public API exposes puzzle ratings but not puzzle history.

### 2. The players
> me: https://www.chess.com/member/slnyc
> [friend A]: https://www.chess.com/member/[friend A's username]
> [friend B]: https://www.chess.com/member/[friend B's username]

**What Claude did:** built the pipeline in a scratch folder:
- `fetch.py` downloads the game archives.
- `analyze.py` evaluates every move with native Stockfish 19. Homebrew couldn't write to its folders, so Claude downloaded the official binary instead.
- `profile.py` builds each player's statistics.
- `explore.py` is an opening explorer.

It analyzed 17 of Simon's games and 150 each for Friend A and Friend B, checked every recommended line with the engine, and published a prep-book page with step-through boards.

**Findings along the way:**
- Friend A answers `1.e4 e5 2.Nf3 Nf6 3.Bc4` with `3…Bc5?!` in 85 of 102 games. Stockfish shows `4.Nxe5! Qe7 5.Bxf7+! Kf8 6.d4!` wins about four pawns, and that the natural `6.Bb3??` throws it away.
- Against Friend B, `1.d4 d5 2.Bf4 Nc6 3.Nc3 Nf6 4.Nb5!` means every natural reply except `4…e5` loses a rook to `Nxc7+`.
- Simon's own pattern: he gives winning positions back, often by missing what the opponent's last move changed. Four of those moments became "find the move" drills.

## 2. Into a repository

### 3. Moving to the repo
> move to local git repo ~/Documents/GitHub/chewss-coach which is clone for https://github.com/simonletort/chess-coach

**What Claude did:** noticed the folder `chewss-coach` didn't exist and used the `chess-coach` clone instead. It copied the project, kept the Stockfish binary (114 MB), the game data and the generated page out of git, made `analyze.py` download Stockfish automatically, and wrote a README. The app's folder move also left a stale nested copy, which Claude checked and removed.

### 4. First pull request
*Action: Create PR (button in the app)*
> gh auth login -h github.com
> done

**What Claude did:** the GitHub repo was empty, so there was no `main` to open a PR against. Claude pushed a minimal `main` (README and `.gitignore`), then opened the PR from a branch. The first push failed because the GitHub CLI's saved sign-in had expired; Simon signed in again from the terminal. → [#1](https://github.com/simonletort/chess-coach/pull/1)

> merged

## 3. A phone app

### 5. Make it a mobile app
> make it a mobile app

*Choice: Phone web app. Features: read my prep on the go, live refresh from chess.com, opening explorer, drill mode. Publish on GitHub Pages: yes.*

**What Claude did:** checked the options (no Xcode on this Mac) and confirmed that chess.com's API allows direct calls from a web page. It built `app/`, an installable web app with no build step:
- **Prep:** plans with step-through boards.
- **Refresh:** pulls friends' latest games from chess.com. "Watch" lines say whether they still play the move each trap relies on.
- **Explore:** a tappable opening explorer.
- **Drill:** play the trap lines from memory and solve the puzzles.
- **Offline support** through a service worker.

It also set up a GitHub Pages deploy workflow. → [#2](https://github.com/simonletort/chess-coach/pull/2)

## 4. Anyone can use it

### 6. Their own username
> I'd like use to be able to authenticate and provider their own chess.com user.
> should I setup an oauth profile? or can you do that for me?

**What Claude did:** checked chess.com's OAuth program. There's no self-service console (you apply through a form reviewed by chess.com), and it isn't needed, because all the data is public. The real work was moving the analysis onto the phone. Claude proposed three parts: (1) stats computed on the device, (2) Stockfish on the device, (3) AI-written prep, which needs a server.

### 7. Build it
> yes, build 1 and 2

**What Claude did:**
- A setup screen for your username and opponents.
- Up to 1,500 games per player stored in the browser.
- A JavaScript port of the profiling code.
- Stockfish 19 lite (1.8 MB WebAssembly) running in the browser.
- On the device: game review, a **trap finder** (moves an opponent keeps repeating that the engine refutes), and puzzles generated from the review.

**Validation:**
- The phone-side trap finder independently rediscovered Friend A's `3…Bc5` trap in 37 seconds.
- The phone-side review matched the full Mac analysis: 3.1 opening blunders per 100 moves in both, and 64% of winning positions converted in both.

→ [#3](https://github.com/simonletort/chess-coach/pull/3)

### 8. Testing it
> how can I test the pr?

> add this info to the PR as comment

**What Claude did:** explained three ways to test (local server, phone on the same Wi-Fi, the live site after merge) and posted them as a PR comment with a checklist. It left Simon's local network address out of the public comment.

## 5. Navigation polish

Each of these went into [#4](https://github.com/simonletort/chess-coach/pull/4), checked at phone size after every change.

### 9. Settings in the tab bar
> instead of settings in https://simonletort.github.io/chess-coach/#me, have settings as an icon in the bottom bar, to the right of "You"

**What Claude did:** added a gear tab, drawn as an outline icon because the ⚙ character renders as a color emoji on iPhones. The Settings page was retitled, and opponents with hand-written prep show their names.

### 10. "You" first
> Move "You" to the first position on the left in the menu at the bottom

### 11. Land on "You"
> landing page should be "You", not "Prep"

### 12. App header
> add a header / title = AI Chess Coach on each pages

**What Claude did:** added a sticky header, renamed the app to "AI Chess Coach" (with "Chess Coach" under the home-screen icon), and changed the welcome heading to "Get started" so the name isn't repeated.

### 13. Live reload
> how can I get my localhost preview to refresh automatically when changes are made locally?

> yes, add it to PR #4

**What Claude did:** recommended `npx live-server`, then found the real catch: the app's offline cache would keep serving old files. It turned offline mode off on localhost, including a self-cleanup for a stale install, and confirmed a file change reloads the page.

### 14. Profile link under "You"
> on "You" page, put the url chess.com/user just below You instead of above

### 15. Settings header
> on page "Settings" remove the chess.com/user at the top

### 16. Too many opponents
> switching on Prep tab is too crowded with more than 4 opponents. propose a solution

*Choice: Opponent list (from three mockups). Fix Explore too: yes, with a picker.*

**What Claude did:** Prep now opens on a list of opponents showing ratings, your record and badges; each file has a back link; Explore uses a dropdown. Tested with six opponents.

### 17. Profile link under the opponent's name
> on /prep/opponent, the chess.com/user is displayed above the name of the player. move it just under the player name

### 18. Naming opponents
> in settings, allow user to associate a name to the chess.com user name (like [a friend's name] for [their username])

**What Claude did:** added editable names, used everywhere through one `displayName()` helper, falling back to the hand-written names and then the username.

### 19. Naming yourself
> also allow name for "You" in settings at the top, and display that name on "You" page at the top of the page above the chess.com url

## 6. Automatic game plans

### 20. Where does the prep come from?
> when running locally (python) it generates "hand-written prep" for each opponents, how do I get the same when running on the webapp.

**What Claude did:** corrected the assumption. Python never wrote the prep; Claude wrote `notes.py` by reading the analysis. It offered three paths: (A) ask Claude per opponent, (B) an automatic plan from on-device data with no AI, (C) AI-written prep through a server holding the API key.

### 21. Option B
> do B

**What Claude did:** built `plan.js`. For each colour it gives the opening to play, his usual answer, the trap to aim for and a weak line, plus advice on time control and the clock. → [#5](https://github.com/simonletort/chess-coach/pull/5)

**Iterations driven by testing:**
- The first version recommended openings Simon never plays, on thin evidence. It told him to answer Friend A's 1.e4 with `1…b6` on only 21 games. Claude added three rules: prefer your own openings when close, rank on a sample-adjusted score, and require 40 or more games to recommend a new move.
- A trap scan hung forever at "0 of 78". Claude traced it to browsers pausing hidden pages, which stalls the engine. The same would happen on a phone in the background. The fix: engine time limits that only count visible time, automatic engine replacement, and a screen wake lock during long jobs.

### 22. Explaining scores
> what does "scores x%" means in the app?

> yes, add the ⓘ note to PR #5

**What Claude did:** explained that a score is points earned (win 1, draw ½), and added an ⓘ note wherever scores appear.

*Outside this session: #6 changed opponents from "he" to "they" throughout the app. Work on AI-written prep through a Cloudflare Worker (option C) is in progress on the `ai-prep` branch.* → [#6](https://github.com/simonletort/chess-coach/pull/6)

## 7. Documenting how it's built

### 23. Claude files
> I've noticed that there is no claude.md or claude related files in the repo. can you check?

> yes, do it on a separate branch

**What Claude did:** found that its own earlier `.gitignore` rule excluded all of `.claude/`. It wrote `CLAUDE.md` (project map, commands, the rules that have mattered, testing, workflow) and narrowed the ignore rule so the launch config is shared. A near-miss: `git add -A` also picked up the Worker's local files from another branch. Claude caught it before committing and staged only the intended files. → [#7](https://github.com/simonletort/chess-coach/pull/7)

### 24. This log
> where in the repo could we store an high level overview of the history of the prompts and work done via Claude?
> my goal is to showcase how the project is being built iteratively via claude code.

> yes for backfill, word for word, lightly cleaned only where needed for privacy. and add rule in claude.md "After each PR, add an entry to docs/build-log.md, lightly clean the prompt where there is need for privacy."

**What Claude did:** recommended `docs/build-log.md` over the wiki, a changelog or raw transcripts, then backfilled this log from the session and added the rule to `CLAUDE.md` so future sessions keep it up to date. → [#7](https://github.com/simonletort/chess-coach/pull/7)

### 25. Cleaning up the log
> fix the typos: "strenght" and "too crowder"
> anonymize friends (I'll clean up the repo later)

**What Claude did:** fixed the two typos, replaced the friends with Friend A and Friend B (with replaced text in [brackets]) and updated the log's intro. It noted that the branch's first log commit still had the names, and recommended squash-merging. → [#7](https://github.com/simonletort/chess-coach/pull/7)

### 26. The `.claude/` folder
> shouldn't we have some info in ./claude about settings, rules, skills, command, output-styles, agents, workflows or plugins

> yes, add the three on existing doc branch and pr. also what rules files could be split out of claude.md?

**What Claude did:** recommended three of the eight: shared settings with a hook, and two skills. It skipped the rest as not worth maintaining at this size. Then it checked the current Claude Code docs for exact formats before writing:
- **`settings.json`:** pre-approves the common build, preview and read-only commands; denies reading the Worker's secrets file and pushing to `main`; and adds a hook that runs `build_app.py` whenever Claude edits `app/`, turning the most-forgotten rule into an automatic step.
- **`build_app.py`** now works without local game data, so the hook doesn't fail on a fresh clone.
- **`prep-opponent` skill:** the Mac workflow behind the hand-written prep, as a repeatable recipe.
- **`ship-change` skill:** the checklist every PR has followed.

Both the hook's success and failure paths were tested. → [#7](https://github.com/simonletort/chess-coach/pull/7)
