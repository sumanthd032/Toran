# hardware

What turns a Raspberry Pi 5 and a touchscreen into a Toran kiosk.

- `daemon/` is the hardware daemon. It owns the HC-SR04 proximity sensor and
  the PN532 card reader, and speaks three messages (`hello`, `distance`,
  `card`) to the kiosk page over `ws://127.0.0.1:8765`. It is standard-library
  Python plus `gpiozero`, which Raspberry Pi OS already ships.
- `pi/` has the install script, two systemd units and the Chromium launcher.

## What has been tested, and what has not

The daemon's protocol code is tested without a Pi. `python3 -m unittest
discover -s hardware/daemon` checks the PN532 frames against the bytes in
NXP's manual, the WebSocket handshake against RFC 6455's own example, the card
token and the tap debounce, and the socket end to end. `npm run
verify:hardware` runs the daemon in `--simulate` mode against a built kiosk
page and follows a visitor through every proximity zone, a card tap, and a
daemon restart. `npm run soak:kiosk` leaves the same setup alone for an hour.

The HC-SR04 and the PN532 themselves have **not** been tested, and neither has
`install.sh`, because no Pi has been on the bench yet. Treat those three as
unmeasured.

## Wiring

BCM numbering, with the header pin in brackets.

| Part | Pin | Pi |
| --- | --- | --- |
| HC-SR04 VCC | | 5 V (2) |
| HC-SR04 GND | | GND (6) |
| HC-SR04 TRIG | | GPIO 23 (16) |
| HC-SR04 ECHO | through a divider, 1 kΩ from ECHO, 2 kΩ to GND, tap to the Pi | GPIO 24 (18) |
| PN532 VCC | | 3.3 V (1) |
| PN532 GND | | GND (9) |
| PN532 TXD | | GPIO 15, RXD (10) |
| PN532 RXD | | GPIO 14, TXD (8) |

The ECHO pin answers at 5 V and a Pi's GPIO takes 3.3 V. Without the divider
the sensor will work for a while and then the pin will not.

Set the PN532 board to HSU (UART): on the common red boards that is both mode
switches off. Check the board's own label, as they differ.

## Install

On the build machine, `npm run build:quiet`, then copy the checkout (with
`apps/web/out`) to the Pi. On the first kiosk of a hall:

```sh
sudo hardware/pi/install.sh --device dev-01 --core http://192.168.1.10:8787 --new-secret
```

That writes `/etc/toran/card-secret`. Every other kiosk needs the same file,
or a card tapped at one is a stranger at the next:

```sh
sudo hardware/pi/install.sh --device dev-02 --core http://192.168.1.10:8787 \
     --secret-from /media/usb/card-secret
```

Reboot, and the Pi opens its kiosk in Chromium, full screen. To change which
device it is or where Core is, edit `/etc/toran/kiosk.env` and reboot.

## When a part is missing

The kiosk runs with neither part attached. With no sensor it boots to Subtle
and is an ordinary touch kiosk. With no reader, a visitor picks a language by
hand and their dossier stays on this machine. The daemon says what it has in
its `hello`, and looks for a missing reader again every 30 seconds.
