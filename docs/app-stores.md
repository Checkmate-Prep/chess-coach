# Listing Checkmate Prep on the App Store and Google Play

A plan, part done. It says what each store needs, what has to change in the app and the Worker, and in which order. The status below is kept up to date as steps land.

## Status (10 October 2026)

**Done**
- **Google Play Console account** created, as an **organisation** account for Artware Solutions LLC. No 12-tester, 14-day closed test is needed: internal testing, then production.
- **Privacy page** at `checkmateprep.com/privacy` and **account deletion page** at `checkmateprep.com/delete-account` (#44). They name Artware Solutions LLC and its address as the operator, with `privacy@checkmateprep.com` as the contact.
- **Delete account deletes the Auth0 login too**, after the synced data and results (#44, `worker/account.js`). Signed out, it clears the device (#33).
- **AI plans, the shared game store and synced results** are in the privacy page, so the store forms can be filled from it.

**Waiting**
- **Apple Developer Program:** enrolment as Artware Solutions LLC was refused because D&B listed the D-U-N-S number as out of business. A D&B update case was opened on 1 October (expected answer 7 October). Once D&B closes it, Apple can take up to about 14 days to see the change. Check with Apple's D-U-N-S lookup before filling in the form again, and use the legal name exactly as D&B and New York State have it ("LLC", not "LCC").
- **Google Play account verification** (identity, and access to a physical Android phone), if the Console still shows it as pending.

**To check**
- That the "Deploy actions" Auth0 app has `delete:users`, and that a real Delete account in production removes the user from Auth0. The deploy log says when an environment can't delete Auth0 users.

**Next steps, in order**
1. Build the Android app with Bubblewrap and upload it to internal testing (Phase 2, steps 1–4). On the Mac, by hand.
2. PR: serve `/.well-known/assetlinks.json` with the two SHA-256 fingerprints from step 1 (Phase 2, step 5).
3. ~~PR: a separate maskable icon and an `id` in the manifest, so the Android icon isn't cropped (Phase 1).~~ Done. If you built the Android app before this landed, run `bubblewrap update`, raise `appVersionCode` and rebuild, so it picks up the new icon.
4. PR: the one-time AI consent note before the first AI plan (Phase 1). Apple requires it; doing it now keeps both apps the same.
5. Store listing and App content forms in the Play Console (Phase 2, steps 6–7).
6. Internal testing, then production (Phase 2, step 8).
7. iOS, once Apple accepts the enrolment (Phase 3).

## The approach

| | Google Play | Apple App Store |
| --- | --- | --- |
| Wrapper | **Trusted Web Activity (TWA)**, generated with Bubblewrap | **Capacitor**: a native WKWebView shell with the `app/` files inside it |
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

## Phase 0: Accounts and paperwork

1. **Apple Developer Program** ($99/year). *Waiting on D&B, see Status.* Enrolling as an organisation needs the D-U-N-S number and shows Artware Solutions LLC as the seller. If D&B drags on, enrol as an individual and convert to the organisation later; the app and its reviews move with it.
2. **Google Play Console** ($25 once). *Done*, as an organisation account for Artware Solutions LLC, so the closed test that personal accounts need (12 testers for 14 days) doesn't apply.
3. **EU trader status** (EU Digital Services Act) on both stores. A trader's address and phone number are shown publicly. Artware Solutions LLC's address is already public on the privacy page.
4. **Privacy policy page.** *Done:* `app/privacy.html`, served at `checkmateprep.com/privacy` (#44). It covers device storage, the shared game store, the account (Auth0, D1), AI plans (both usernames and statistics go to Anthropic), usage stats, and the processors (Cloudflare, Auth0, Anthropic, Google Fonts).
5. **Support URL and contact email.** Use `checkmateprep.com` and `privacy@checkmateprep.com`, or add a `support@` address in Cloudflare Email Routing.

## Phase 1: Web app and Worker changes both stores need

1. **Account deletion.** *Done* (#33, #44). Delete account signed in removes the synced doc, all analysis results, then the Auth0 user (`worker/account.js`, needs `delete:users` on the "Deploy actions" M2M app). Signed out, it clears the device. `checkmateprep.com/delete-account` is the public page the Play listing asks for.
2. **Consent before AI plans.** *To do.* Apple's guideline 5.1.2(i) asks apps to say clearly when personal data goes to a third-party AI, and to ask first. Before the first "Write the plan", show a one-time note: what is sent, that it goes to Anthropic, a link to the privacy page, and a button to agree. Remember the answer on the device.
3. **Sign in with Apple.** *To do, iOS only.* Required because Auth0 offers Google sign-in (guideline 4.8). Add the Apple connection in Auth0 (it works on the web too), or hide Google in the iOS app and keep email codes only.
4. **Manifest and icons.** *Done.* `manifest.webmanifest` has `"id": "/"`, and `icon-512-maskable.png` (the knight at 80% inside the safe zone) is the "maskable" icon, apart from `icon-512.png` which is "any". The `id` is the app's identity for Chrome, so don't change it.
5. **Store assets:**
   - A 1024×1024 icon with no transparency for Apple.
   - A 512×512 icon and a 1024×500 feature graphic for Play.
   - Screenshots: 2–8 Play phone screenshots (1080×1920), iPhone 6.9" (1320×2868), and iPad unless iPad is excluded. Include the three-step opponent page and an AI plan.
6. **Wording and trademarks.** "For chess.com players" in the description is fine. Keep chess.com's name and logo out of the app name and icon, or review will flag it. Mention that AI plans are written by Claude.

## Phase 2: Google Play (TWA)

1. **Build the app on the Mac with Bubblewrap.**
   ```bash
   npm i -g @bubblewrap/cli
   mkdir ~/checkmate-prep-android && cd ~/checkmate-prep-android
   bubblewrap init --manifest https://checkmateprep.com/manifest.webmanifest
   bubblewrap build    # app-release-bundle.aab for Play, app-release-signed.apk for a phone
   ```
   - Domain `checkmateprep.com`, start URL `/`, name Checkmate Prep.
   - Package id `com.checkmateprep.app`. **It can never change.**
   - Let Bubblewrap create the upload keystore, and back up the file and both passwords in a password manager.
   - Keep the project out of `chess-coach/app/`, which is published. A separate private repo is fine. The keystore never goes in a public repo.
2. **Try it on a phone:** `bubblewrap install` with USB debugging on. It shows a URL bar until step 5.
3. **Create the app** in the Play Console: Checkmate Prep, App, Free, then accept the declarations.
4. **Internal testing → Create release**, upload `app-release-bundle.aab`, and accept Play App Signing. Add yourself as a tester.
5. **Digital Asset Links**, so the app opens without a URL bar.
   - Collect two SHA-256 fingerprints: the *app signing key* (Play Console → Test and release → App integrity → App signing) and the *upload key* (`bubblewrap fingerprint`). They aren't secret.
   - Serve them at `/.well-known/assetlinks.json` from the Worker: a route in `worker/index.js`, and `/.well-known/*` added to `run_worker_first` in `wrangler.toml`. Every environment gets it, so a dev build on `dev.checkmateprep.com` can be tested too.
6. **App content** (Policy → App content):
   - Privacy policy: `https://checkmateprep.com/privacy`.
   - App access: all functionality is available without special access (sign-in is optional).
   - Ads: no.
   - Content rating questionnaire: no violence or user chat; expect Everyone.
   - Target audience: 13 and over, to stay out of the Families programme.
   - **Data safety:** email address (account, optional), user content (synced opponents, names, progress and analysis results), app interactions and a device id (usage stats, can be turned off), data shared with Anthropic for AI plans. All encrypted in transit and deletable.
   - Data deletion URL: `https://checkmateprep.com/delete-account`.
7. **Store listing:**
   - Short description (80 characters at most), e.g. "Prep for the people you play on chess.com: openings, traps and drills."
   - Full description, the 512×512 icon, the 1024×500 feature graphic and the phone screenshots (Phase 1).
8. **Testing, then production.** The account is an organisation account, so: internal test on a few phones, then Production → Create release. Review takes a few days. (A personal account would first need a 14-day closed test with 12 testers.)
9. **After launch:** web changes reach the app straight away. Rebuild only when the manifest or icons change: raise `appVersionCode` in `twa-manifest.json`, `bubblewrap build`, upload the new `.aab`.

## Phase 3: Apple (Capacitor)

Starts once the Apple enrolment is accepted. The code work in step 2 can start before.

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
     - Sign-out and Delete account must also log out of Auth0 in the system browser.
     - This is the biggest piece of new work.
   - **Service worker.** WKWebView doesn't support service workers on custom schemes. Skip `sw.js` registration in the native app; the files are already local. Leave the localhost rule as it is.
   - **Stockfish.** The single-threaded lite build doesn't need SharedArrayBuffer, so it should run in WKWebView. Test on a real device, including keeping the engine going (`whileAwake`) when the app goes to the background. Measure how long a trap scan takes; that decides the native Stockfish plugin (see above).
   - **AI plans in the background.** The plan is written on the server (a Cloudflare Workflow), so closing the app is fine. Optionally, a local notification when a plan the user asked for is ready.
3. Add some native value to strengthen the 4.2 case: haptics on moves, share-sheet export of a game plan, a proper splash screen and safe-area layout (the tab bar work in #31 helps). Optionally local notifications for drill reminders.
4. App Store Connect:
   - App Privacy "nutrition label", matching the Play data safety form, including the data sent to Anthropic.
   - Privacy policy URL `https://checkmateprep.com/privacy`.
   - Age rating questionnaire (AI-written content is chess advice only).
   - Export compliance: HTTPS only, so exempt (set `ITSAppUsesNonExemptEncryption = NO`).
   - **Demo account in the review notes**, plus a chess.com username the reviewer can try. Make sure production has `ANTHROPIC_API_KEY` set so the reviewer sees AI plans work.
5. TestFlight (internal, then external beta), then submit.

## Phase 4: Licences and ongoing work

- **Stockfish is GPLv3.** For store distribution, publish the app's full source, including the iOS and Android wrappers. The repo is public, which covers most of it. Keep `COPYING.txt` and add an in-app "Licences / source code" link.
  - GPL and Apple's terms have clashed before (VLC). Stockfish apps are on the App Store today, but this is the one real legal grey area here, so check it early. A native Stockfish plugin would be GPL too.
  - Vendored Auth0 SDK and chess.js: add their licence notices to the same screen.
- **CI.** Add a workflow to build the iOS app (Fastlane or Xcode Cloud) so shipping `app/` changes to iOS isn't manual. Android updates itself through the TWA.
- **Tests.** The `assetlinks.json` route, the API base, CORS and the widened origin check need tests. The Worker tests (D1 on `node:sqlite`, a fake R2, a fake Auth0) make that easy.
- **CLAUDE.md.** Add the two wrappers to the layout table, and a rule that iOS needs a rebuild after `app/` changes.
