# Testing the Android app on a Mac

The Android app is a Trusted Web Activity (a Chrome window that fills the screen) around `https://checkmateprep.com`. There is no app code to run: testing it means installing the build Play serves and checking that it opens the website full screen. To test changes to the web app itself, use the website (`npm run dev`, or dev.checkmateprep.com).

A Mac can't install from Google Play, so use an Android emulator or a real phone.

## What you need

- **Android Studio** (free), with the Android SDK.
- A **Google account on the internal testers list** (Play Console → Testing → Internal testing → Testers). Add the address there first and select the list for the track.
- The track's **opt-in link** (same Testers tab, "Copy link").

## 1. Create an emulator with the Play Store

1. Open Android Studio, then **More Actions → Virtual Device Manager** (or **Tools → Device Manager**).
2. **Create Virtual Device**, choose a phone such as Pixel 8, then a system image of Android 13 or newer.
3. Pick an image that shows the **Play Store** icon in the Play Store column of the list. Images without it can't install from Play.
4. Finish and start the device. Apple Silicon Macs run the arm64 images natively.

## 2. Install from internal testing

1. In the emulator, open the **Play Store** and sign in with the tester account.
2. In the emulator's **Chrome**, open the opt-in link, tap **Become a tester**, then **Download it on Google Play**.
3. Install and open **Checkmate Prep**.

If Play says the item isn't found, wait a few minutes after opting in, close and reopen the Play Store, and check that the signed-in account is the one on the testers list.

## What to check

- **No address bar** at the top. If Chrome's URL bar shows, Android couldn't confirm the app belongs to the website: the fingerprint in `worker/assetlinks.js` doesn't match the key the build is signed with. A build installed from Play is signed with the **app signing** key (Console → Test and release → App integrity → App signing); a build from your own keystore uses the **upload** key. Both are listed there.
- **Icon and name** on the launcher. On Android 13+ with *Themed icons* switched on (Settings → Wallpaper & style), the icon should be tinted and not clipped (the monochrome layer, `app/icon-512-monochrome.png`, added to the project by `android/patch-project.sh`). On an emulator, switch it on under Wallpaper & style → Home screen → Themed icons; the setting isn't picked up from adb. An APK built before the patch keeps its full-colour icon.
- **Launch and sign-in:** the welcome screen, then sign in with Google and with an email code. A signed-in session should show the same opponents as the website.
- **Offline and back:** turn on airplane mode in the emulator's extended controls and reopen the app. The app files are cached by the service worker, so it should still open and show saved opponents; only downloading new games needs the network.
- **Phone size:** about 360×800. Look for text cut off or buttons off the screen.

The app shares its data with the Chrome on that device, since it is the same address. Clear it under Settings → Apps → Chrome → Storage if you want a clean start.

## Installing a build that isn't in Play yet

Use this to check a new `.aab` before uploading it. The Android project lives outside the repo (`~/checkmate-prep-android`); `android/twa-manifest.json` in the repo is its source, and `android/README.md` has the rebuild steps.

```bash
# once: bundletool turns the .aab into installable files
brew install bundletool

bundletool build-apks --bundle=app-release.aab --output=app.apks --mode=universal
bundletool install-apks --apks=app.apks      # installs to the running emulator or a USB phone
```

A build installed this way is not signed with the Play key, so the address bar may show. That is the fingerprint check above and not a bug. Bubblewrap's own `bubblewrap install` does the same for a build from the project folder.

## When something is off

| Symptom | Likely cause |
| --- | --- |
| Address bar shows | Signing key isn't in `worker/assetlinks.js`. Check what `https://checkmateprep.com/.well-known/assetlinks.json` returns against the Console's fingerprints. |
| "Item not found" in Play | Account isn't on the testers list, or the opt-in step wasn't done in that account. |
| Opens a browser, not the app | Chrome isn't the default browser, or no browser supports TWAs on the device. |
| Sign-in loops | A stale session on the old issuer: sign out and in again. |
