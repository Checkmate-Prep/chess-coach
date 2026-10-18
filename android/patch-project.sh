#!/bin/sh
# Patches the project Bubblewrap generates, because `bubblewrap update` resets
# both of these. Run it after `bubblewrap update`, from anywhere:
#   android/patch-project.sh [project folder]    (default: ~/checkmate-prep-android)
#
# 1. Pins the Android Gradle Plugin and Gradle versions.
# 2. Adds the themed (monochrome) launcher icon. Bubblewrap's
#    `monochromeIconUrl` only feeds notification and shortcut icons, and its
#    adaptive icon has no <monochrome> layer, so Android 13+ can't tint the app.
set -eu

AGP=8.13.2
GRADLE=8.13

repo=$(cd "$(dirname "$0")/.." && pwd)
dir=${1:-$HOME/checkmate-prep-android}
build="$dir/build.gradle"
wrapper="$dir/gradle/wrapper/gradle-wrapper.properties"
res="$dir/app/src/main/res"
adaptive="$res/mipmap-anydpi-v26/ic_launcher.xml"
mono="$repo/app/icon-512-monochrome.png"

[ -f "$build" ] && [ -f "$wrapper" ] || { echo "Not a Bubblewrap project: $dir" >&2; exit 1; }
[ -f "$adaptive" ] || { echo "No adaptive icon in $dir (expected $adaptive)" >&2; exit 1; }
[ -f "$mono" ] || { echo "Missing $mono" >&2; exit 1; }

sed -i.bak "s|com.android.tools.build:gradle:[0-9.]*|com.android.tools.build:gradle:$AGP|" "$build"
sed -i.bak "s|gradle-[0-9.]*-bin.zip|gradle-$GRADLE-bin.zip|" "$wrapper"
rm -f "$build.bak" "$wrapper.bak"

# The knight sits inside the adaptive icon's safe zone, so it is used as the
# whole 108dp layer, without an inset. The launcher tints it; only the alpha
# channel matters.
mkdir -p "$res/drawable-nodpi"
cp "$mono" "$res/drawable-nodpi/ic_launcher_monochrome.png"
if ! grep -q "<monochrome" "$adaptive"; then
  perl -0pi -e 's#</adaptive-icon>#    <monochrome android:drawable="\@drawable/ic_launcher_monochrome" />\n</adaptive-icon>#' "$adaptive"
fi
grep -q '<monochrome android:drawable="@drawable/ic_launcher_monochrome"' "$adaptive" \
  || { echo "Could not add the monochrome layer to $adaptive" >&2; exit 1; }

grep -n "com.android.tools.build:gradle" "$build"
grep -n "distributionUrl" "$wrapper"
grep -n "<monochrome" "$adaptive"
