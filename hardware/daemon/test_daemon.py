"""
The daemon without a Pi. Run: python3 -m unittest discover hardware/daemon

The PN532 frames are checked against the bytes NXP's manual and every
working driver send, the WebSocket against RFC 6455's own example, and the
server end to end on a real socket, because the part of a daemon that fails
in a hall is the part between the modules.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import struct
import unittest

from cards import Taps, token_for
from pn532 import ACK, PN532, FrameError, frame, parse, uid_of
from wsserver import Hub, accept_key, text_frame

CORE_TOKEN = re.compile(r"^[a-z0-9][a-z0-9-]{3,63}$", re.IGNORECASE)
BROWSER_TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{3,63}$")


def response(command: int, payload: bytes) -> bytes:
    """A frame as the reader sends it, for the scripted port."""
    body = bytes([0xD5, command]) + payload
    return bytes([0x00, 0x00, 0xFF, len(body), (0x100 - len(body)) & 0xFF]) + body + bytes([(0x100 - sum(body)) & 0xFF, 0x00])


class ScriptedPort:
    def __init__(self, replies: list[bytes]) -> None:
        self.replies = replies
        self.written: list[bytes] = []
        self.buffer = b""

    def write(self, data: bytes) -> None:
        self.written.append(data)
        # The reader answers a command, not a wake-up preamble.
        if data[:3] == b"\x00\x00\xff" and self.replies:
            self.buffer += self.replies.pop(0)

    def read(self, n: int) -> bytes:
        out, self.buffer = self.buffer[:n], self.buffer[n:]
        return out


class Frames(unittest.TestCase):
    def test_sam_configuration_is_the_manuals_bytes(self) -> None:
        self.assertEqual(
            frame(0x14, bytes([0x01, 0x14, 0x01])).hex(" "),
            "00 00 ff 05 fb d4 14 01 14 01 02 00",
        )

    def test_a_seven_byte_uid_is_read_from_a_target_answer(self) -> None:
        uid = bytes.fromhex("04a2b3c4d5e6f7")
        payload = bytes([0x01, 0x01, 0x00, 0x44, 0x00, len(uid)]) + uid
        command, body = parse(ACK + response(0x4B, payload))
        self.assertEqual(command, 0x4B)
        self.assertEqual(uid_of(body), uid)

    def test_no_card_is_none_not_an_error(self) -> None:
        self.assertIsNone(uid_of(bytes([0x00])))

    def test_a_bad_checksum_is_refused(self) -> None:
        good = response(0x4B, bytes([0x00]))
        bad = good[:-2] + bytes([(good[-2] + 1) & 0xFF]) + good[-1:]
        with self.assertRaises(FrameError):
            parse(bad)

    def test_a_uid_of_an_impossible_length_is_refused(self) -> None:
        with self.assertRaises(FrameError):
            uid_of(bytes([0x01, 0x01, 0x00, 0x44, 0x00, 0x05, 1, 2, 3, 4, 5]))

    def test_a_card_is_read_through_the_command_exchange(self) -> None:
        uid = bytes.fromhex("04112233445566")
        port = ScriptedPort(
            [
                ACK + response(0x15, b""),
                ACK + response(0x4B, bytes([0x01, 0x01, 0x00, 0x44, 0x00, 7]) + uid),
            ]
        )
        reader = PN532(port, timeout=0.2)
        reader.begin()
        self.assertEqual(reader.read_uid(wait=0.1), uid)
        self.assertEqual(port.written[-1], frame(0x4A, bytes([0x01, 0x00])))

    def test_a_reader_that_does_not_answer_is_an_error_not_a_hang(self) -> None:
        with self.assertRaises(FrameError):
            PN532(ScriptedPort([]), timeout=0.05).read_uid(wait=0.05)


class Cards(unittest.TestCase):
    SECRET = b"a-hall-secret-of-enough-bytes"

    def test_the_token_is_one_both_ends_accept_and_not_the_uid(self) -> None:
        uid = bytes.fromhex("04112233445566")
        token = token_for(uid, self.SECRET)
        self.assertRegex(token, CORE_TOKEN)
        self.assertRegex(token, BROWSER_TOKEN)
        self.assertNotIn(uid.hex(), token)
        self.assertEqual(token, token_for(uid, self.SECRET), "the same card at every kiosk")
        self.assertNotEqual(token, token_for(uid, b"another-hall-secret-entirely"))

    def test_a_short_secret_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            token_for(b"\x01\x02\x03\x04", b"short")

    def test_a_card_left_on_the_reader_is_one_tap(self) -> None:
        taps = Taps(gap=1.0)
        card = b"\x04\x01\x02\x03"
        self.assertEqual(taps.read(card, 0.0), card)
        # Resting for five seconds, read every 0.2 s the way the daemon polls.
        for step in range(1, 26):
            self.assertIsNone(taps.read(card, step * 0.2), f"still resting at {step * 0.2:.1f} s")
        self.assertIsNone(taps.read(None, 5.2))
        # Lifted, and laid down again two seconds later: a second tap.
        self.assertEqual(taps.read(card, 7.2), card)
        # A different card is a tap at once.
        self.assertEqual(taps.read(b"\x04\x09\x09\x09", 7.3), b"\x04\x09\x09\x09")


class Socket(unittest.TestCase):
    def test_the_accept_key_is_rfc_6455s_example(self) -> None:
        self.assertEqual(accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")

    def test_lengths_either_side_of_the_short_form(self) -> None:
        self.assertEqual(text_frame("x" * 125)[:2], bytes([0x81, 125]))
        self.assertEqual(text_frame("x" * 126)[:4], bytes([0x81, 126, 0, 126]))

    def test_the_hub_greets_broadcasts_and_turns_away_a_stranger(self) -> None:
        asyncio.run(self._hub())

    async def _hub(self) -> None:
        hub = Hub(["http://127.0.0.1:8080"], lambda: {"type": "hello", "daemon": "test", "sensors": ["proximity"]})
        server = await asyncio.start_server(hub.handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]

        async def connect(origin: str) -> tuple[asyncio.StreamReader, asyncio.StreamWriter, bytes]:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            key = base64.b64encode(os.urandom(16)).decode()
            writer.write(
                (
                    f"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                    f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: {origin}\r\n\r\n"
                ).encode()
            )
            head = await reader.readuntil(b"\r\n\r\n")
            return reader, writer, head

        async def message(reader: asyncio.StreamReader) -> dict:
            b0, b1 = await reader.readexactly(2)
            self.assertEqual(b0, 0x81)
            length = b1 & 0x7F
            if length == 126:
                (length,) = struct.unpack("!H", await reader.readexactly(2))
            return json.loads(await reader.readexactly(length))

        async with server:
            reader, writer, head = await connect("http://127.0.0.1:8080")
            self.assertIn(b"101 Switching Protocols", head)
            self.assertEqual((await message(reader))["type"], "hello")
            hub.broadcast({"type": "distance", "metres": 1.2, "at": 1})
            self.assertEqual((await message(reader))["metres"], 1.2)
            writer.close()

            _, stranger, refused = await connect("https://example.org")
            self.assertIn(b"403", refused)
            stranger.close()


if __name__ == "__main__":
    unittest.main()
