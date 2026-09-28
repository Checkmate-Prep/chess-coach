# Listing Checkmate Prep on the App Store and Google Play

A plan, not done yet. It says what each store needs, what has to change in the app and the Worker, and in which order.

## The approach

| | Google Play | Apple App Store |
| --- | --- | --- |
| Wrapper | **Trusted Web Activity (TWA)**, generated with Bubblewrap or PWABuilder | **Capacitor**: a native WKWebView shell with the `app/` files inside it |
| Where the app runs from | `https://checkmateprep.com`, the same address as the website | Files packed into the app (`capacitor://localhost`) |
| User data | Shared with the Chrome install, since it's the same address. Nothing moves. | A separate store. Accounts sync is how data moves over. |
| Updates | Instant, like the website. You only resubmit for manifest or icon changes. | Every `app/` change needs a new build and a new review (or a live-update plugin). |
| Main review risk | Low | **Guideline 4.2 ("minimum functionality")**, which rejects apps that are just a website in a wrapper |

The split follows from the rule that checkmateprep.com is permanent: a TWA keeps Android users on that address, so their data stays where it is. Apple doesn't allow TWAs, and they're wary of a Capacitor app that only loads a remote URL. Packing the files into the app works in our favour there: games, stats, traps and Stockfish all run offline on the device, which is a real argument that it isn't a thin wrapper.

## Phase 0: Accounts and paperwork (start now, it's the slowest part)

1. **Apple Developer Program** ($99/year). Enrolling as an individual is quickest. Enrolling as an organisation needs a D-U-N-S number but shows a company name instead of a person's.
2. **Google Play Console** ($25 once). **New personal accounts must run a closed test with at least 12 testers for 14 days in a row before production is unlocked.** Start recruiting testers early. Organisation accounts (D-U-N-S needed) skip this.
3. **EU trader status** (EU Digital Services Act) on both stores. A trader's address and phone number are shown publicly.
4. **Privacy policy page**, required by both stores. Serve it at `checkmateprep.com/privacy`, e.g. a static `app/privacy.html`. It should say:
   - Games come from the public chess.com API.
   - Games, analysis and prep are stored on the device.
   - The optional account stores the email (Auth0) plus the synced opponents, names and drill progress (Cloudflare D1).
   - Usage stats: the screen names opened, a random device id, the account id when signed in, and the country (`/api/event`, Workers Analytics Engine), with a switch in Settings to turn them off.
   - There are no ads and nothing is sold or shared for tracking.
5. **Support URL and contact email.**

## Phase 1: Web app changes both stores need

1. **In-app account deletion.** Apple requires this under guideline 5.1.1(v), and Google requires a deletion link.
   - Today "Delete account" calls `DELETE /api/sync` (`worker/sync.js`), which deletes only the synced data. The Auth0 user remains.
   - Make the Worker also delete the Auth0 user through the Management API. The M2M application used by the Auth0 deploy script can be reused, with the `delete:users` scope added and its credentials stored as Worker secrets.
   - Add a public web page explaining how to delete an account, for the Play listing.
2. **Sign in with Apple.** Only needed if Auth0 offers Google or other social logins on iOS (guideline 4.8). With email and password only, it isn't needed. If social logins stay, add the Apple connection in Auth0.
3. **Store assets:**
   - A 1024×1024 icon with no transparency for Apple.
   - A 512×512 icon and a 1024×500 feature graphic for Play.
   - Screenshots: iPhone 6.9" (1320×2868) and Play phone screenshots. iPad screenshots too, unless iPad is excluded.
   - A separate PNG maskable icon (the current 512 does double duty as "any maskable").
4. **Wording and trademarks.** "For chess.com players" in the description is fine. Keep chess.com's name and logo out of the app name and icon, or review will flag it.

## Phase 2: Google Play (TWA), the quicker win

1. Pass the Lighthouse PWA checks: the manifest is already good, and the service worker gives offline support.
2. Generate the Android project with `bubblewrap init --manifest https://checkmateprep.com/manifest.webmanifest`:
   - Package id, e.g. `com.checkmateprep.app`.
   - Let Play App Signing manage the key.
3. **Digital Asset Links.** Serve `https://checkmateprep.com/.well-known/assetlinks.json` with the Play signing key's SHA-256. Without it, Chrome shows a URL bar and the app looks like a browser tab.
   - Easiest: add a route in `worker/index.js`, which avoids any doubt about serving a dot-folder from assets.
   - The file isn't secret, so it can live in the repo.
4. Auth0 needs no change: sign-in stays on the same address.
5. Play Console:
   - Store listing.
   - **Data safety form**: email (optional, for accounts), user content (synced), app interactions and a device id (usage stats). All encrypted in transit and deletable.
   - Content rating questionnaire, target audience, ads = no.
6. Internal test, then the **closed test (12 testers × 14 days)**, then production.
7. Keep the Android wrapper in its own folder such as `android/`, or in a separate repo. It must not go under `app/`, which is published.

## Phase 3: Apple (Capacitor)

1. `npm i @capacitor/core @capacitor/ios`, with `webDir: "app"`.
   - This keeps the "no build step" rule for the web app: Capacitor copies `app/` as it is.
   - Needs Xcode on the Mac.
2. Code changes so `app/` works inside the shell:
   - **API base URL.** `sync.js` and `track.js` fetch relative `api/...` paths. In the native app these must go to `https://checkmateprep.com/api/...`, e.g. an `API_BASE` set when `window.Capacitor` exists. The Worker then needs **CORS** for the `capacitor://localhost` origin.
   - **Auth0 in a native app.** `redirect_uri: location.origin + location.pathname` won't work from `capacitor://`.
     - Use a new Auth0 **Native** application with a custom-scheme or universal-link callback.
     - Open sign-in in the system browser (`@capacitor/browser`) and handle the callback with `@capacitor/app` `appUrlOpen`.
     - This is the biggest piece of new work.
   - **Service worker.** WKWebView doesn't support service workers on custom schemes. Skip `sw.js` registration in the native app; the files are already local. Leave the localhost rule as it is.
   - **Stockfish.** The single-threaded lite build doesn't need SharedArrayBuffer, so it should run in WKWebView. Test on a real device, including keeping the engine going (`whileAwake`) when the app goes to the background.
3. Add some native value to strengthen the 4.2 case: haptics on moves, share-sheet export of a game plan, a proper splash screen and safe-area layout. Optionally local notifications for drill reminders.
4. App Store Connect:
   - App Privacy "nutrition label", matching the Play data safety form (usage data and a device id are "not linked to identity" only when signed out).
   - Age rating questionnaire.
   - Export compliance: HTTPS only, so exempt (set `ITSAppUsesNonExemptEncryption = NO`).
   - **Demo account in the review notes**, plus a chess.com username the reviewer can try.
5. TestFlight (internal, then external beta), then submit.

## Phase 4: Licences and ongoing work

- **Stockfish is GPLv3.** For store distribution, publish the app's full source, including the iOS and Android wrappers. Keep `COPYING.txt` and add an in-app "Licences / source code" link.
  - GPL and Apple's terms have clashed before (VLC). Stockfish apps are on the App Store today, but this is the one real legal grey area here, so check it early.
  - Vendored Auth0 SDK and chess.js: add their licence notices to the same screen.
- **CI.** Add a workflow to build the iOS app (Fastlane or Xcode Cloud) so shipping `app/` changes to iOS isn't manual. Android updates itself through the TWA.
- **Tests.** The API base and CORS logic in `sync.js`, `track.js` and the Worker need tests.
- **CLAUDE.md.** Add the two wrappers to the layout table, and a rule that iOS needs a rebuild after `app/` changes.

## Suggested order

1. Enrol in both programs, write the privacy policy, and start recruiting Play testers (days of waiting, little work).
2. Account deletion in the Worker and the UI: about one PR.
3. The TWA, `assetlinks.json` and the Play closed test: about one PR, then 14+ days of testing.
4. Capacitor iOS with the API base, CORS and native Auth0: the largest part, 2–3 PRs.
5. Store assets, listings and submissions.
