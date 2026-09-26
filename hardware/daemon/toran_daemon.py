"""
The kiosk hardware daemon. DECISIONS.md D-061, D-156.

Owns the HC-SR04 and the PN532 on a Raspberry Pi and speaks the three
messages of `KioskHardwareMessage` (packages/contracts/src/kiosk.ts) to the
kiosk's browser over a WebSocket on 127.0.0.1:8765:

  hello     on connecting: which sensors are attached right now
  distance  ten times a second, in metres, 5.0 meaning nobody
  card      once per tap, with the card's Sutra token

Either part may be missing, and the daemon runs anyway and says so in its
hello. The kiosk already degrades without either: no sensor boots to Subtle,
no reader means a language picked by hand. A reader unplugged mid-day is
looked for again every 30 seconds.

  python3 toran_daemon.py                  on the Pi, under systemd
  python3 toran_daemon.py --simulate       anywhere: a visitor walks up every
                                           80 s and taps one of two cards
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys
import threading
import time
from pathlib import Path

from cards import Taps, token_for
from wsserver import Hub

VERSION = "toran-daemon 1.0"
DISTANCE_HZ = 10
READER_RETRY_S = 30

log = logging.getLogger("toran-daemon")


def now_ms() -> int:
    return int(time.time() * 1000)


class Attached:
    """What is plugged in at this moment. Read by every new connection's hello."""

    def __init__(self) -> None:
        self.proximity = False
        self.nfc = False

    def hello(self) -> dict:
        sensors = [name for name, on in (("proximity", self.proximity), ("nfc", self.nfc)) if on]
        return {"type": "hello", "daemon": VERSION, "sensors": sensors}


def run_proximity(args, attached: Attached, emit, stop: threading.Event) -> None:
    try:
        from proximity import Proximity

        sensor = Proximity(trigger=args.trigger, echo=args.echo)
    except Exception as error:  # gpiozero raises its own family, and ImportError off a Pi.
        log.warning("no proximity sensor: %s", error)
        return
    attached.proximity = True
    log.info("proximity sensor on GPIO %d (trigger) and %d (echo)", args.trigger, args.echo)
    try:
        while not stop.wait(1 / DISTANCE_HZ):
            emit({"type": "distance", "metres": round(sensor.metres(), 3), "at": now_ms()})
    finally:
        sensor.close()


def run_reader(args, attached: Attached, emit, stop: threading.Event) -> None:
    from pn532 import PN532, FrameError, SerialPort

    try:
        secret = load_secret(args.secret_file)
    except (OSError, ValueError) as error:
        # Without the hall's secret a tap cannot become the token the other
        # kiosks know, so the reader stays off and the sensor carries on.
        log.error("card reader disabled: %s", error)
        return
    taps = Taps()
    while not stop.is_set():
        try:
            port = SerialPort(args.serial)
            reader = PN532(port)
            reader.begin()
        except (OSError, FrameError) as error:
            attached.nfc = False
            log.warning("no card reader on %s (%s); looking again in %d s", args.serial, error, READER_RETRY_S)
            stop.wait(READER_RETRY_S)
            continue
        attached.nfc = True
        log.info("card reader on %s", args.serial)
        try:
            while not stop.is_set():
                uid = reader.read_uid()
                tapped = taps.read(uid, time.monotonic())
                if tapped is not None:
                    emit({"type": "card", "token": token_for(tapped, secret), "at": now_ms()})
                    # The UID is not logged. It is the one thing that ties a
                    # token back to a piece of plastic.
                    log.info("card tapped")
                stop.wait(0.1)
        except (OSError, FrameError) as error:
            attached.nfc = False
            log.warning("card reader stopped answering: %s", error)
        finally:
            port.close()


def run_simulated(attached: Attached, emit, stop: threading.Event) -> None:
    """A visitor who walks up, stays forty seconds, taps a card and leaves, every 80 s."""
    attached.proximity = True
    attached.nfc = True
    secret = b"simulated-hall-secret-not-a-real-one"
    cards = [b"\x04\x11\x22\x33\x44\x55\x66", b"\x04\x77\x88\x99\xaa\xbb\xcc"]
    started = time.monotonic()
    tapped_this_visit = False
    visit = 0
    while not stop.wait(1 / DISTANCE_HZ):
        t = (time.monotonic() - started) % 80
        if t < 20:
            metres, tapped_this_visit = 5.0, False
        elif t < 30:
            metres = 4.0 - (t - 20) * 0.37
        elif t < 70:
            metres = 0.3
        else:
            metres = 0.3 + (t - 70) * 0.47
        emit({"type": "distance", "metres": round(metres, 3), "at": now_ms()})
        if 32 <= t < 33 and not tapped_this_visit:
            tapped_this_visit = True
            emit({"type": "card", "token": token_for(cards[visit % 2], secret), "at": now_ms()})
            visit += 1


def load_secret(path: str) -> bytes:
    secret = Path(path).read_bytes().strip()
    if len(secret) < 16:
        raise ValueError(f"{path} holds fewer than 16 bytes; install.sh writes one")
    return secret


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="The Toran kiosk hardware daemon.")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument(
        "--origin",
        action="append",
        help="an origin a kiosk page is served from; repeatable",
    )
    ap.add_argument("--trigger", type=int, default=23, help="HC-SR04 trigger, BCM numbering")
    ap.add_argument("--echo", type=int, default=24, help="HC-SR04 echo, BCM numbering, through a divider")
    ap.add_argument("--serial", default="/dev/serial0", help="the PN532's UART")
    ap.add_argument("--secret-file", default="/etc/toran/card-secret")
    ap.add_argument("--simulate", action="store_true", help="no hardware: a scripted visitor")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s", stream=sys.stderr)

    # Loopback only, whatever --host says: nothing on the museum network may
    # drive a kiosk or listen to its sensor.
    if args.host not in ("127.0.0.1", "::1", "localhost"):
        raise SystemExit("the daemon listens on loopback only")

    origins = args.origin or ["http://127.0.0.1:8080", "http://localhost:8080"]
    attached = Attached()
    hub = Hub(origins, attached.hello)
    stop = threading.Event()

    async def serve() -> None:
        loop = asyncio.get_running_loop()

        def emit(message: dict) -> None:
            loop.call_soon_threadsafe(hub.broadcast, message)

        workers = (
            [threading.Thread(target=run_simulated, args=(attached, emit, stop), daemon=True)]
            if args.simulate
            else [
                threading.Thread(target=run_proximity, args=(args, attached, emit, stop), daemon=True),
                threading.Thread(target=run_reader, args=(args, attached, emit, stop), daemon=True),
            ]
        )
        for worker in workers:
            worker.start()

        server = await asyncio.start_server(hub.handle, args.host, args.port)
        done = asyncio.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, done.set)
        log.info("listening on ws://%s:%d for %s", args.host, args.port, ", ".join(origins))
        async with server:
            await done.wait()
            log.info("stopping")
            stop.set()
            hub.close_all()

    asyncio.run(serve())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
