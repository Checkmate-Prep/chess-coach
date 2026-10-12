# Testing the iOS app

The iOS app is the website in a Capacitor shell: a native WKWebView that serves the files in `app/` unchanged from `capacitor://localhost` and calls `https://checkmateprep.com/api/...`. There is no separate app code to build, so testing means running the shell and checking what the shell changes: where the API calls go, the engine's speed, backgrounding, safe areas, and sign-in. To test changes to the web app itself, use the website (`npm run dev`, or dev.checkmateprep.com).

The shell needs a Mac with Xcode. The plan and the App Store steps are in [app-stores.md](app-stores.md).

## 1. Prepare the project

```bash
npm ci                # Node 22 or newer, see .nvmrc
npm run ios:sync      # copies app/ into ios/App/App/public (that folder is gitignored)
npm run ios:open      # opens ios/App/App.xcodeproj in Xcode
```

Run `npm run ios:sync` again after any change in `app/`. The `public` folder is only a copy and Xcode does not refresh it.

Facts about the project: bundle id and URL scheme `com.checkmateprep.app`, scheme **App**, Swift packages (no CocoaPods), `capacitor.config.json` at the repo root with `webDir: "app"`.

## 2. Run in the simulator

1. In Xcode's toolbar set the destination to an iPhone simulator, then press **⌘R**. The first build resolves the Swift packages and takes a minute or two.
2. No signing team is needed for the simulator.
3. To see network requests: Safari → **Develop → Simulator → Checkmate Prep**. If the Develop menu is missing, turn it on in Safari → Settings → Advanced.

The simulator is good for layout and for the flow. **Don't use it for engine timings:** Stockfish is heavy, and a busy Mac makes WebKit's GPU process unresponsive, which shows as a white screen. A real iPhone is the check that counts.

## 3. Run on a real iPhone

1. Connect the phone, tap **Trust This Computer**, and turn on **Settings → Privacy & Security → Developer Mode** (the phone restarts).
2. To inspect the page from the Mac, turn on **Settings → Apps → Safari → Advanced → Web Inspector**.
3. In Xcode, select the **App** target → **Signing & Capabilities**, tick **Automatically manage signing** and choose a Team. A personal Apple ID is fine until the company's Apple Developer enrolment is accepted (add it under Xcode → Settings → Accounts).
4. If the bundle id is rejected as taken, use a temporary one such as `com.checkmateprep.app.dev`. Don't commit that change.
5. Pick the phone as the destination and press **⌘R**.
6. First launch only: **Settings → General → VPN & Device Management → your Apple ID → Trust**, then open the app.

A build signed with a personal team stops working after 7 days; run it again from Xcode.

## What to check

| Check | How | Expected |
| --- | --- | --- |
| Loads | Open the app, add a chess.com username and an opponent. | The welcome and setup screens work; the opponent's games download. |
| API base | Web Inspector → Network. | Requests go to `https://checkmateprep.com/api/...` with origin `capacitor://localhost`; profile and stats come from `api.chess.com`. |
| Game store fallback | Block `/api/games` (airplane mode for the store, or a content blocker) and add an opponent. | Games still download, from chess.com. |
| No service worker | Web Inspector → Application (or `navigator.serviceWorker.controller`). | None registered. Offline mode doesn't apply to the native app. |
| Engine speed | Run a game review and a trap scan with a stopwatch. | Note both times with the phone model and iOS version. If they are too slow, open a separate issue for a native engine plugin behind the same UCI interface. |
| Backgrounding | Start a trap scan, press Home, wait about 20 seconds, come back. | It resumes through `whileAwake`; it must not stall at "0 of N". |
| Tab bar | Look at the bottom bar. | All five icons are drawn, with no "?" boxes. |
| Safe areas | Look at the Dynamic Island, the home indicator and the keyboard. | Nothing is cut off or hidden. |
| Piece figurines | Open a game review with captures. | The figurines (♔♕♖♗♘) show; they are text characters and may need replacing like the tab icons were. |

## Sign-in

Signing in from the app needs three things outside the app:

1. **An Auth0 Native application** with Allowed Callback URLs and Allowed Logout URLs both set to `com.checkmateprep.app://login.checkmateprep.com/capacitor/com.checkmateprep.app/callback`, **`capacitor://localhost` in both Allowed Origins (CORS) and Allowed Web Origins** (the app exchanges the sign-in code from its web view, and Auth0 refuses it otherwise: `Failed Cross Origin Authentication`, "Load failed" in the app), Authorization Code and Refresh Token grants, and the Checkmate Prep API authorized for user access.
2. **Its connections:** email code on, Google **off** (App Store guideline 4.8 asks for Sign in with Apple wherever Google is offered).
3. **The Worker returning its client id** as `auth.nativeClientId` from `/api/config`. Production does (`AUTH0_NATIVE_CLIENT_ID` in `wrangler.toml`); check with `curl https://checkmateprep.com/api/config`. Without it the app hides accounts and works signed out.

Then check: sign in opens the system browser and returns to the app; opponents, drill progress and results arrive; Sign out and Delete account also log out of Auth0 in the browser and return to the welcome screen. Use a throwaway address, and delete the test account afterwards, since the Auth0 tenant is shared with production.

## When something is off

| Symptom | Likely cause |
| --- | --- |
| White screen in the simulator that comes and goes | The Mac is overloaded: close other apps, or test on a phone. |
| App shows an old version of the web app | `npm run ios:sync` wasn't run after the last `app/` change. |
| "Untrusted Developer" on launch | Trust the Apple ID under VPN & Device Management. |
| Build fails on signing | Choose a Team, or use a temporary bundle id. |
| API calls fail with CORS errors | The Worker must allow `capacitor://localhost` (`worker/cors.js`); check production was deployed since that change. |
| Sign-in button missing | `/api/config` isn't returning `auth.nativeClientId` (check production was deployed), or the app can't reach it. |
| Sign-in returns to a blank page | The callback URL isn't in the Native application's Allowed Callback URLs. |
| "Sign-in didn't finish (Load failed)" | `capacitor://localhost` is missing from Allowed Origins (CORS). Auth0's log shows `fco`, "Origin capacitor://localhost is not allowed". |
| Auth0 shows "Authorize App" | Auth0's consent screen for a custom-scheme app. Tap Accept; enabling "Allow Skipping User Consent" on the API may hide it. |
| The sheet stays open after a good sign-in | Fixed once the sheet is closed on the callback (see the build log); tap X in older builds. |
