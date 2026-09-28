# Listing Checkmate Prep on the App Store and Google Play

A plan, not done yet. It says what each store needs, what has to change in the app and the Worker, and in which order. Updated after #31–#39: AI game plans with Claude, the shared game store, analysis results synced to the account, dev and test on their own domains, and deleting data without signing in.

## The approach

| | Google Play | Apple App Store |
| --- | --- | --- |
| Wrapper | **Trusted Web Activity (TWA)**, generated with Bubblewrap or PWABuilder | **Capacitor**: a native WKWebView shell with the `app/` files inside it |
| Where the app runs from | `https://checkmateprep.com`, the same address as the website | Files packed into the app (`capacitor://localhost`), calling `https://checkmateprep.com/api/...` |
| User data | Shared with the Chrome install, since it's the same address. Nothing moves. | A separate store on the device. Signing in brings everything over: opponents, drill progress, Stockfish's reviews, trap scans and AI plans (#39). |
| Updates | Instant, like the website. You only resubmit for manifest or icon changes. | Every `app/` change needs a new build and a new review (or a live-update plugin). |
| Main review risk | Low | **Guideline 4.2 ("minimum functionality")**, which rejects apps that are just a website in a wrapper |

The split follows from the rule that checkmateprep.com is permanent: a TWA keeps Android users on that address, so their data stays where it is. Apple doesn't allow TWAs, and they're wary of a Capacitor app that only loads a remote URL. Packing the files into the app works in our favour there: games, stats, traps and Stockfish all run on the device, which is a real argument that it isn't a thin wrapper.

Since #39 the separate store on iOS matters much less. A signed-in user who installs the iOS app gets their analysis and AI plans from the account, and Stockfish only runs on what's missing.

## Why not a fully native iOS app

A native app means rewriting the app in Swift (SwiftUI, a native board, native Stockfish). It isn't worth it now:

- **Two copies of the logic.** Opening trees, stats, the game plan, the trap finder, drills and the sync merge rules would exist in JavaScript and in Swift. Every change would be made twice, and the Node tests and `parity.json` checks would cover only one of them.
- **The Worker shares the app's code.** `syncdoc.js` and `resultsdoc.js` run in both the app and the Worker. A Swift app would need its own copy of those rules and would drift from them.
- **Months, not weeks.** Capacitor reuses `app/` as it is. A rewrite starts from zero, for one platform, and the web and Android versions still need the JavaScript.
- **Apple's main worry is covered.** Guideline 4.2 is about thin wrappers. An app that runs a chess engine and all its analysis on the device, and works offline, isn't one.

What native would really add is a faster engine: multi-threaded Stockfish with the full network, instead of the single-threaded lite WASM build. That can come later without a rewrite, as a **Capacitor plugin that runs native Stockfish** behind the same UCI interface `engine.js` uses today. Do it only if trap scans and reviews are too slow on iPhones in TestFlight.

**Recommendation:** Capacitor now. Add a native Stockfish plugin if speed calls for it. Reconsider a native app only if the iOS app becomes the main way people use Checkmate Prep and the web version turns into the secondary one.

## Phase 0: Accounts and paperwork (start now, it's the slowest part)

1. **Apple Developer Program** ($99/year). Enrolling as an individual is quickest. Enrolling as an organisation needs a D-U-N-S number but shows a company name instead of a person's.
2. **Google Play Console** ($25 once). **New personal accounts must run a closed test with at least 12 testers for 14 days in a row before production is unlocked.** Start recruiting testers early. Organisation accounts (D-U-N-S needed) skip this.
3. **EU trader status** (EU Digital Services Act) on both stores. A trader's address and phone number are shown publicly.
4. **Privacy policy page**, required by both stores. Serve it at `checkmateprep.com/privacy`, e.g. a static `app/privacy.html`. It should say:
   - Games come from chess.com's public API, directly or through the shared game store (`/api/games`), which keeps public games for 180 days and records nothing about who asked. Players can ask to be removed (`npm run forget-player`).
   - Games, analysis and prep are stored on the device.
   - The optional account (Auth0: email, or Google sign-in) keeps the synced opponents, names, drill progress and analysis results (Stockfish reviews, trap scans, AI plans) in Cloudflare D1.
   - **AI game plans:** "Write the plan" sends both chess.com usernames, ratings, statistics, lines, the head-to-head record, traps and the name you gave the opponent to Anthropic (Claude) through the Worker. Plans are cached on the server for 30 days.
   - Usage stats: the screen names opened, a random device id, the account id when signed in, and the country (`/api/event`, Workers Analytics Engine), with a switch in Settings to turn them off.
   - There are no ads, and nothing is sold or shared for tracking.
5. **Support URL and contact email.**

## Phase 1: Web app and Worker changes both stores need

1. **Account deletion that deletes the account.** Apple requires this under guideline 5.1.1(v), and Google requires a deletion link.
   - Done: "Delete account" signed in removes the synced doc and all analysis results (`DELETE /api/sync`), and signed out clears the device (#33).
   - Still missing: the **Auth0 user** remains. Make the Worker also delete it through the Management API. The M2M application used by the Auth0 deploy script can be reused, with the `delete:users` scope added and its credentials stored as Worker secrets.
   - Add a public web page explaining how to delete an account, for the Play listing.
2. **Consent before AI plans.** Apple's guideline 5.1.2(i) asks apps to say clearly when personal data goes to a third-party AI, and to ask first. Before the first "Write the plan", show a one-time note: what is sent, that it goes to Anthropic, and a button to agree. Remember the answer on the device.
3. **Sign in with Apple.** Required on iOS because Auth0 offers Google sign-in (guideline 4.8). Add the Apple connection in Auth0 (it works on the web too), or hide Google in the iOS app and keep email codes only.
4. **Store assets:**
   - A 1024×1024 icon with no transparency for Apple.
   - A 512×512 icon and a 1024×500 feature graphic for Play.
   - Screenshots: iPhone 6.9" (1320×2868) and Play phone screenshots. iPad screenshots too, unless iPad is excluded. Include the three-step opponent page and an AI plan.
   - A separate PNG maskable icon (the current 512 does double duty as "any maskable").
5. **Wording and trademarks.** "For chess.com players" in the description is fine. Keep chess.com's name and logo out of the app name and icon, or review will flag it. Mention that AI plans are written by Claude.

## Phase 2: Google Play (TWA), the quicker win

1. Pass the Lighthouse PWA checks: the manifest is already good, and the service worker gives offline support.
2. Generate the Android project with `bubblewrap init --manifest https://checkmateprep.com/manifest.webmanifest`:
   - Package id, e.g. `com.checkmateprep.app`.
   - Let Play App Signing manage the key.
   - Optionally a second build pointing at `dev.checkmateprep.com` for testing PRs on a phone (#35, #39 made dev a real domain that every PR deploys to).
3. **Digital Asset Links.** Serve `/.well-known/assetlinks.json` with the Play signing key's SHA-256. Without it, Chrome shows a URL bar and the app looks like a browser tab.
   - Easiest: add a route in `worker/index.js`, which avoids any doubt about serving a dot-folder from assets. Every environment gets it for free.
   - The file isn't secret, so it can live in the repo.
4. No change for Auth0, the AI plan's origin check or CORS: everything stays on the same address.
5. Play Console:
   - Store listing.
   - **Data safety form**: email (optional, for accounts), user content (synced opponents, names, progress and results), app interactions and a device id (usage stats), data sent to Anthropic for AI plans. All encrypted in transit and deletable.
   - Content rating questionnaire, target audience, ads = no.
6. Internal test, then the **closed test (12 testers × 14 days)**, then production.
7. Keep the Android wrapper in its own folder such as `android/`, or in a separate repo. It must not go under `app/`, which is published.

## Phase 3: Apple (Capacitor)

1. `npm i @capacitor/core @capacitor/ios`, with `webDir: "app"`.
   - This keeps the "no build step" rule for the web app: Capacitor copies `app/` as it is.
   - Needs Xcode on the Mac.
2. Code changes so `app/` works inside the shell:
   - **API base URL.** The app calls relative `api/...` paths from `app.js` (`/api/prep`), `chesscom.js` (`/api/games`), `results.js`, `sync.js` and `track.js`. In the native app these must go to `https://checkmateprep.com/api/...`. One `API_BASE` helper, set when `window.Capacitor` exists, used by all five.
   - **CORS.** The Worker sends no CORS headers today. Allow the `capacitor://localhost` origin (with preflight for the `authorization` header) on all `/api/*` routes.
   - **The AI plan's origin check.** `/api/prep` rejects any origin other than the site's own (`worker/prep.js`). Accept `capacitor://localhost` too. The per-IP limits, daily caps and spend limit stay the backstop; Apple's App Attest can harden it later.
   - **The game store.** `chesscom.js` only uses `/api/games` when served by the Worker, and falls back to chess.com otherwise. Make the native app use the store too, through `API_BASE`.
   - **Auth0 in a native app.** `redirect_uri: location.origin + location.pathname` won't work from `capacitor://`.
     - Add an Auth0 **Native** application with a custom-scheme or universal-link callback, on `login.checkmateprep.com`.
     - Open sign-in in the system browser (`@capacitor/browser`) and handle the callback with `@capacitor/app` `appUrlOpen`.
     - Sign-out and "Delete account" must also log out of Auth0 in the system browser.
     - This is the biggest piece of new work.
   - **Service worker.** WKWebView doesn't support service workers on custom schemes. Skip `sw.js` registration in the native app; the files are already local. Leave the localhost rule as it is.
   - **Stockfish.** The single-threaded lite build doesn't need SharedArrayBuffer, so it should run in WKWebView. Test on a real device, including keeping the engine going (`whileAwake`) when the app goes to the background. Measure how long a trap scan takes; that decides the native Stockfish plugin (see above).
   - **AI plans in the background.** The plan is written on the server (a Cloudflare Workflow), so closing the app is fine. Optionally, a local notification when a plan the user asked for is ready.
3. Add some native value to strengthen the 4.2 case: haptics on moves, share-sheet export of a game plan, a proper splash screen and safe-area layout (the tab bar work in #31 helps). Optionally local notifications for drill reminders.
4. App Store Connect:
   - App Privacy "nutrition label", matching the Play data safety form, including the data sent to Anthropic.
   - Age rating questionnaire (AI-written content is chess advice only).
   - Export compliance: HTTPS only, so exempt (set `ITSAppUsesNonExemptEncryption = NO`).
   - **Demo account in the review notes**, plus a chess.com username the reviewer can try. Make sure production has `ANTHROPIC_API_KEY` set so the reviewer sees AI plans work.
5. TestFlight (internal, then external beta), then submit.

## Phase 4: Licences and ongoing work

- **Stockfish is GPLv3.** For store distribution, publish the app's full source, including the iOS and Android wrappers. The repo is public, which covers most of it. Keep `COPYING.txt` and add an in-app "Licences / source code" link.
  - GPL and Apple's terms have clashed before (VLC). Stockfish apps are on the App Store today, but this is the one real legal grey area here, so check it early. A native Stockfish plugin would be GPL too.
  - Vendored Auth0 SDK and chess.js: add their licence notices to the same screen.
- **CI.** Add a workflow to build the iOS app (Fastlane or Xcode Cloud) so shipping `app/` changes to iOS isn't manual. Android updates itself through the TWA.
- **Tests.** The API base, CORS and the widened origin check need tests. The Worker tests from #39 (D1 on `node:sqlite`, a fake R2) make that easy.
- **CLAUDE.md.** Add the two wrappers to the layout table, and a rule that iOS needs a rebuild after `app/` changes.

## Suggested order

1. Enrol in both programs, write the privacy policy, and start recruiting Play testers (days of waiting, little work).
2. Auth0 user deletion, the AI consent note and Sign in with Apple: about one PR each.
3. The TWA, `assetlinks.json` and the Play closed test: about one PR, then 14+ days of testing.
4. Capacitor iOS with the API base, CORS, the origin check and native Auth0: the largest part, 2–3 PRs.
5. Store assets, listings and submissions.
6. Later, if iPhones are slow: the native Stockfish plugin.
