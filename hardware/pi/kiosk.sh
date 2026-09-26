#!/bin/sh
# Opens this Pi's kiosk in Chromium, full screen, and keeps it open.
#
# Run by the labwc session at login (install.sh puts it in the autostart).
# The URL carries everything the page needs: which device, where Core is,
# the panel calibration, and the hardware drivers. D-135, D-156.
set -eu

. /etc/toran/kiosk.env

# The export and the daemon are services; give them a moment after boot.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/', timeout=1)" 2>/dev/null; then
    break
  fi
  sleep 1
done

URL="http://127.0.0.1:8080/kiosk/${TORAN_DEVICE}/?sensor=hw&card=hw&scale=${TORAN_SCALE}&core=${TORAN_CORE}"

# Bookworm calls it chromium-browser, Trixie calls it chromium.
BROWSER=$(command -v chromium-browser || command -v chromium)

# A kiosk that crashes comes back. Each flag is there for a reason:
#   --kiosk, --noerrdialogs, --disable-infobars: nothing on screen but the page
#   --disable-pinch, --overscroll-history-navigation=0: a visitor's two
#     fingers or a swipe cannot zoom the panel or leave the page
#   --autoplay-policy: the audio-first voice and the AV Archive play on a tap
#     that the page, not the browser, is listening for
#   --check-for-update-interval: no update prompt in front of a visitor
#   --disable-features=Translate: the page does its own languages
while true; do
  "$BROWSER" \
    --kiosk --noerrdialogs --disable-infobars --no-first-run \
    --disable-pinch --overscroll-history-navigation=0 \
    --autoplay-policy=no-user-gesture-required \
    --check-for-update-interval=31536000 \
    --disable-features=Translate,TouchpadOverscrollHistoryNavigation \
    --disable-session-crashed-bubble \
    "$URL" || true
  sleep 2
done
