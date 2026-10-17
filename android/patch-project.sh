#!/bin/sh
# Pins the Android Gradle Plugin and Gradle versions in the project Bubblewrap
# generates. Run it after `bubblewrap update`, from anywhere:
#   android/patch-project.sh [project folder]    (default: ~/checkmate-prep-android)
set -eu

AGP=8.13.2
GRADLE=8.13

dir=${1:-$HOME/checkmate-prep-android}
build="$dir/build.gradle"
wrapper="$dir/gradle/wrapper/gradle-wrapper.properties"

[ -f "$build" ] && [ -f "$wrapper" ] || { echo "Not a Bubblewrap project: $dir" >&2; exit 1; }

sed -i.bak "s|com.android.tools.build:gradle:[0-9.]*|com.android.tools.build:gradle:$AGP|" "$build"
sed -i.bak "s|gradle-[0-9.]*-bin.zip|gradle-$GRADLE-bin.zip|" "$wrapper"
rm -f "$build.bak" "$wrapper.bak"

grep -n "com.android.tools.build:gradle" "$build"
grep -n "distributionUrl" "$wrapper"
