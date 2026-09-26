"""
The HC-SR04 ultrasonic sensor, through gpiozero.

gpiozero ships with Raspberry Pi OS and drives the Pi 5's GPIO through lgpio,
so this adds nothing to install. It times the echo in its own thread and
hands back the latest distance, which is what the kiosk wants ten times a
second: the browser takes a median of five and adds the hysteresis, D-061.

The echo pin must come through a divider. The HC-SR04 answers at 5 V and a
Pi's GPIO takes 3.3 V; hardware/README.md has the two resistors.
"""

from __future__ import annotations

import math

# The browser reads 5 m as nobody there. A reading past what the sensor can
# see is reported as that, never as a guess.
NOBODY_M = 5.0


class Proximity:
    def __init__(self, trigger: int = 23, echo: int = 24) -> None:
        # Imported here, so the daemon runs on a machine with no GPIO at all
        # and simply reports no proximity sensor in its hello.
        from gpiozero import DistanceSensor

        self.sensor = DistanceSensor(echo=echo, trigger=trigger, max_distance=NOBODY_M, queue_len=3)

    def metres(self) -> float:
        value = self.sensor.distance
        if value is None or not math.isfinite(value) or value <= 0:
            return NOBODY_M
        return min(NOBODY_M, float(value))

    def close(self) -> None:
        self.sensor.close()
