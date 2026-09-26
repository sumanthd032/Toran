"""
The PN532 NFC reader, over its high-speed UART.

The Sutra card is an NTAG213 sticker, and the kiosk needs one thing from it:
its UID, each time it is laid on the reader. That is three PN532 commands,
so this file speaks the frame format directly rather than pulling in a
library and its dependencies onto a machine an archivist will have to keep
running. NXP UM0701-02, sections 6.2 and 7.

The serial port is anything with read(n) and write(bytes). On the Pi it is
`SerialPort` below, raw termios on /dev/serial0; in the tests it is a script.
"""

from __future__ import annotations

import os
import termios
import time
from typing import Protocol

HOST_TO_PN532 = 0xD4
PN532_TO_HOST = 0xD5

SAM_CONFIGURATION = 0x14
IN_LIST_PASSIVE_TARGET = 0x4A

ACK = bytes([0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00])

# The PN532 sleeps until it sees a long run of 0x55 on HSU. UM0701-02 7.2.11.
WAKEUP = bytes([0x55, 0x55, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])


class Port(Protocol):
    def read(self, n: int) -> bytes: ...

    def write(self, data: bytes) -> None: ...


class FrameError(Exception):
    """A frame that does not add up. The read is dropped, never trusted."""


def frame(command: int, params: bytes = b"") -> bytes:
    """One normal information frame from the host: preamble, length, TFI, data, checksums."""
    body = bytes([HOST_TO_PN532, command]) + params
    length = len(body)
    if length > 0xFF:
        raise FrameError("a normal frame carries at most 255 bytes")
    return (
        bytes([0x00, 0x00, 0xFF, length, (0x100 - length) & 0xFF])
        + body
        + bytes([(0x100 - sum(body)) & 0xFF, 0x00])
    )


def parse(data: bytes) -> tuple[int, bytes]:
    """
    The first response frame in `data`: (command, payload).

    Checks both checksums and the frame identifier. The command returned is
    the response code, which is the request's plus one.
    """
    at = 0
    while True:
        start = data.find(b"\x00\xff", at)
        if start == -1:
            break
        rest = data[start + 2 :]
        if len(rest) < 2:
            raise FrameError("frame cut short before its length")
        length, lcs = rest[0], rest[1]
        # An ACK (LEN 00, LCS FF) or a NACK (FF 00) is not a response: step
        # past its start code, length and checksum to the frame that follows.
        if (length, lcs) in ((0x00, 0xFF), (0xFF, 0x00)):
            at = start + 4
            continue
        if (length + lcs) & 0xFF != 0:
            raise FrameError("length checksum does not add up")
        body = rest[2 : 2 + length]
        if len(body) < length or len(rest) < 3 + length:
            raise FrameError("frame cut short")
        dcs = rest[2 + length]
        if (sum(body) + dcs) & 0xFF != 0:
            raise FrameError("data checksum does not add up")
        if len(body) < 2 or body[0] != PN532_TO_HOST:
            raise FrameError("not a frame from the reader")
        return body[1], bytes(body[2:])
    raise FrameError("no frame")


def uid_of(payload: bytes) -> bytes | None:
    """
    The UID from an InListPassiveTarget answer, or None when no card is there.

    Payload: NbTg, then for the first target Tg, SENS_RES (2), SEL_RES (1),
    NFCIDLength, NFCID. UM0701-02 7.3.5, 106 kbps type A.
    """
    if len(payload) < 1 or payload[0] == 0:
        return None
    if len(payload) < 6:
        raise FrameError("target answer cut short")
    length = payload[5]
    uid = payload[6 : 6 + length]
    if len(uid) != length or length not in (4, 7, 10):
        raise FrameError("a type A UID is 4, 7 or 10 bytes")
    return bytes(uid)


class PN532:
    def __init__(self, port: Port, timeout: float = 0.5) -> None:
        self.port = port
        self.timeout = timeout

    def _read_until(self, predicate, timeout: float) -> bytes:
        deadline = time.monotonic() + timeout
        got = b""
        while time.monotonic() < deadline:
            got += self.port.read(64)
            if predicate(got):
                return got
        return got

    def command(self, code: int, params: bytes = b"", timeout: float | None = None) -> bytes:
        """Sends a command and returns its response payload. Raises FrameError on anything else."""
        self.port.write(frame(code, params))
        wait = self.timeout if timeout is None else timeout
        got = self._read_until(lambda b: ACK in b, wait)
        if ACK not in got:
            raise FrameError("the reader did not acknowledge")
        after = got[got.index(ACK) + len(ACK) :]

        def complete(b: bytes) -> bool:
            try:
                parse(b)
                return True
            except FrameError:
                return False

        if not complete(after):
            after += self._read_until(lambda b: complete(after + b), wait)
        response, payload = parse(after)
        if response != code + 1:
            raise FrameError(f"expected response {code + 1:#x}, got {response:#x}")
        return payload

    def begin(self) -> None:
        """Wakes the reader and puts its secure access module in normal mode."""
        self.port.write(WAKEUP)
        # Mode normal, a timeout of 50 ms steps (0x14, one second), and IRQ used.
        self.command(SAM_CONFIGURATION, bytes([0x01, 0x14, 0x01]))

    def read_uid(self, wait: float = 0.2) -> bytes | None:
        """The UID of a card on the reader now, or None. One target, 106 kbps type A."""
        payload = self.command(IN_LIST_PASSIVE_TARGET, bytes([0x01, 0x00]), timeout=wait + self.timeout)
        return uid_of(payload)


class SerialPort:
    """/dev/serial0 in raw mode at 115200 8N1, with a 100 ms read timeout."""

    def __init__(self, path: str = "/dev/serial0", baud: int = termios.B115200) -> None:
        self.fd = os.open(path, os.O_RDWR | os.O_NOCTTY)
        attrs = termios.tcgetattr(self.fd)
        attrs[0] = 0  # iflag: no translation of the bytes the reader sends
        attrs[1] = 0  # oflag
        attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL  # cflag: 8N1
        attrs[3] = 0  # lflag: not a terminal
        attrs[4] = baud
        attrs[5] = baud
        attrs[6][termios.VMIN] = 0
        attrs[6][termios.VTIME] = 1
        termios.tcsetattr(self.fd, termios.TCSANOW, attrs)
        termios.tcflush(self.fd, termios.TCIOFLUSH)

    def read(self, n: int) -> bytes:
        return os.read(self.fd, n)

    def write(self, data: bytes) -> None:
        os.write(self.fd, data)

    def close(self) -> None:
        os.close(self.fd)
