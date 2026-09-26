#!/bin/sh
# Turns a Raspberry Pi 5 running Raspberry Pi OS (Bookworm, desktop) into
# one Toran kiosk. Run as root from a checkout that has a built export:
#
#   npm run build:quiet                        on the build machine
#   sudo hardware/pi/install.sh --device dev-01 --core http://192.168.1.10:8787 \
#        --secret-from /media/usb/card-secret
#
# Every kiosk in a hall needs the same card secret, or a card tapped at one
# will be a stranger at the next. The first install writes one with
# --new-secret; copy /etc/toran/card-secret to the others. D-156.
#
# Safe to run again: it replaces what it installed and keeps the secret.
set -eu

DEVICE=""
CORE=""
SCALE="1.471"
SECRET_FROM=""
NEW_SECRET=0
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
WEB="$REPO/apps/web/out"
DESKTOP_USER="${SUDO_USER:-pi}"

while [ $# -gt 0 ]; do
  case "$1" in
    --device) DEVICE="$2"; shift 2 ;;
    --core) CORE="$2"; shift 2 ;;
    --scale) SCALE="$2"; shift 2 ;;
    --web) WEB="$2"; shift 2 ;;
    --secret-from) SECRET_FROM="$2"; shift 2 ;;
    --new-secret) NEW_SECRET=1; shift ;;
    --user) DESKTOP_USER="$2"; shift 2 ;;
    *) echo "install.sh: unknown option $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "install.sh: run as root" >&2; exit 1; }
case "$DEVICE" in
  dev-[0-9][0-9]) ;;
  *) echo "install.sh: --device dev-01 to dev-13" >&2; exit 2 ;;
esac
[ -f "$WEB/kiosk/$DEVICE/index.html" ] || {
  echo "install.sh: no built kiosk at $WEB/kiosk/$DEVICE; run npm run build:quiet" >&2
  exit 1
}
python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))' || {
  echo "install.sh: the daemon needs Python 3.11 or later" >&2
  exit 1
}

echo "Toran kiosk: $DEVICE, Core ${CORE:-none}, scale $SCALE"

# A system user for the daemon and the export, with the GPIO and serial groups.
id toran >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin toran
usermod -a -G gpio,dialout toran

# The code and the export. Replaced whole, so nothing from an older build lingers.
install -d -m 0755 /opt/toran /opt/toran/hardware
rm -rf /opt/toran/hardware/daemon /opt/toran/hardware/pi /opt/toran/web
cp -r "$REPO/hardware/daemon" "$REPO/hardware/pi" /opt/toran/hardware/
rm -rf /opt/toran/hardware/daemon/__pycache__
cp -r "$WEB" /opt/toran/web
chmod 0755 /opt/toran/hardware/pi/kiosk.sh

# What this Pi is.
install -d -m 0755 /etc/toran
cat > /etc/toran/kiosk.env <<ENV
TORAN_DEVICE=$DEVICE
TORAN_CORE=$CORE
TORAN_SCALE=$SCALE
ENV

# The hall's card secret, readable by the daemon and nobody else.
if [ -n "$SECRET_FROM" ]; then
  install -m 0400 -o toran -g toran "$SECRET_FROM" /etc/toran/card-secret
elif [ "$NEW_SECRET" = 1 ] && [ ! -f /etc/toran/card-secret ]; then
  python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > /etc/toran/card-secret
  chown toran:toran /etc/toran/card-secret
  chmod 0400 /etc/toran/card-secret
  echo "  wrote a new card secret; copy /etc/toran/card-secret to every other kiosk"
elif [ ! -f /etc/toran/card-secret ]; then
  echo "  no card secret: pass --secret-from or --new-secret. Cards stay off until then."
fi

# The PN532 is on the UART, so the UART is the reader's and not a login console.
if command -v raspi-config >/dev/null 2>&1; then
  raspi-config nonint do_serial_hw 0
  raspi-config nonint do_serial_cons 1
  # A kiosk's screen never blanks. The proxemic states decide what it shows.
  raspi-config nonint do_blanking 1
fi

install -m 0644 "$HERE/toran-daemon.service" /etc/systemd/system/toran-daemon.service
install -m 0644 "$HERE/toran-web.service" /etc/systemd/system/toran-web.service
systemctl daemon-reload
systemctl enable --now toran-web.service toran-daemon.service

# Chromium opens with the desktop session. Bookworm's desktop is labwc.
AUTOSTART="/home/$DESKTOP_USER/.config/labwc/autostart"
install -d -o "$DESKTOP_USER" -g "$DESKTOP_USER" "$(dirname "$AUTOSTART")"
touch "$AUTOSTART"
grep -q '/opt/toran/hardware/pi/kiosk.sh' "$AUTOSTART" || echo '/opt/toran/hardware/pi/kiosk.sh &' >> "$AUTOSTART"
chown "$DESKTOP_USER:$DESKTOP_USER" "$AUTOSTART"

echo "  installed. Reboot, and the Pi opens as $DEVICE."
