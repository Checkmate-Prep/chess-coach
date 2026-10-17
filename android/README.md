# Android app (Trusted Web Activity)

The Android app is a Trusted Web Activity built with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap). `twa-manifest.json` here is the source of truth for it: package id, version, icons, colours, `minSdkVersion: 24`, notifications off. It holds no secrets (only the keystore's file name and alias).

The generated Android project and the upload keystore stay **outside the repo**, in `~/checkmate-prep-android`. This repo is public: never commit the keystore or its passwords (they are in the password manager). `.gitignore` blocks `*.keystore`, `*.jks` and `android/*/` as a safety net.

## When to rebuild

Web changes reach the app straight away. Rebuild only when the web manifest, icons or `twa-manifest.json` change.

## Versions

Known-good: Bubblewrap CLI 1.27.0, Android Gradle Plugin 8.13.2, Gradle 8.13. Bubblewrap's template sets older AGP and Gradle versions, and `bubblewrap update` resets any edit, so `patch-project.sh` holds the pinned versions. To upgrade, change `AGP` and `GRADLE` at the top of the script and rebuild.

## Rebuild

1. Edit `android/twa-manifest.json` here and raise `appVersionCode` (and `appVersion` / `appVersionName` with it). Merge the change.
2. Copy it over the project's file and build:

   ```bash
   cp ~/chess-coach/android/twa-manifest.json ~/checkmate-prep-android/twa-manifest.json
   cd ~/checkmate-prep-android
   bubblewrap update     # regenerates the project; say yes if it offers to refetch the web manifest
   ~/chess-coach/android/patch-project.sh   # pins AGP and Gradle again (update resets them)
   bubblewrap build      # asks for the keystore and key passwords
   ```

   This writes `app-release-bundle.aab` (for Play) and `app-release-signed.apk` (for a phone). The icon URLs must already be live on checkmateprep.com.
3. Check the build on a device or emulator: see [docs/android-testing.md](../docs/android-testing.md). With Settings → Wallpaper & style → Themed icons on, the icon should be tinted and not clipped.
4. Play Console → Test and release → Create new release → upload the `.aab`.

If Bubblewrap changes a setting while you build (it can rewrite the file), copy the file back here and commit it.

The project folder needs `android.keystore` next to `twa-manifest.json`; the path in the file is relative for that reason.
