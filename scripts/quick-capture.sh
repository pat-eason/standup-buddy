#!/usr/bin/env bash
# Opens the Standup Buddy quick-note window: a small, centered Chrome app window
# (no tabs or address bar) showing /capture. Bind this script to a global hotkey
# (see README, "Quick capture") for a Spotlight-style note popup.
#
# Environment:
#   STANDUP_BUDDY_URL  base URL            (default http://standup.buddy.localhost:8080)
#   CAPTURE_WIDTH      window width in px  (default 600)
#   CAPTURE_HEIGHT     window height in px (default 290)
#   DRY_RUN=1          print the command instead of running it
set -euo pipefail

BASE="${STANDUP_BUDDY_URL:-http://standup.buddy.localhost:8080}"
W="${CAPTURE_WIDTH:-600}"
H="${CAPTURE_HEIGHT:-290}"

# Main screen size in points; JXA needs no automation permission prompt.
SCREEN_W="$(osascript -l JavaScript -e 'ObjC.import("AppKit"); $.NSScreen.mainScreen.frame.size.width' 2>/dev/null || echo 1440)"
SCREEN_H="$(osascript -l JavaScript -e 'ObjC.import("AppKit"); $.NSScreen.mainScreen.frame.size.height' 2>/dev/null || echo 900)"
X=$(( (${SCREEN_W%.*} - W) / 2 ))
Y=$(( ${SCREEN_H%.*} / 4 ))

CMD=(open -na "Google Chrome" --args "--app=${BASE}/capture" "--window-size=${W},${H}" "--window-position=${X},${Y}")

if [[ "${DRY_RUN:-}" == "1" ]]; then
  printf '%q ' "${CMD[@]}"; echo
else
  "${CMD[@]}"
fi
