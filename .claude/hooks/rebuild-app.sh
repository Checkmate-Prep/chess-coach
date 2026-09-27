#!/bin/sh
# PostToolUse hook: after Claude edits a file in app/, rebuild the app data so the
# service worker's cache name changes and installed apps pick up the new files.
# Silent on success; on failure, exit 2 so the error is shown to Claude.
file=$(python3 -c 'import json, sys; print(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))')
case "$file" in
  "$CLAUDE_PROJECT_DIR"/app/*) ;;
  *) exit 0 ;;
esac
cd "$CLAUDE_PROJECT_DIR" || exit 0
if ! out=$(python3 build_app.py 2>&1); then
  echo "build_app.py failed after editing $file:" >&2
  echo "$out" >&2
  exit 2
fi
exit 0
