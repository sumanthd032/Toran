"""
The smallest WebSocket server the kiosk protocol needs. RFC 6455.

The daemon only ever sends: a hello, a distance ten times a second, a card
when one is laid down. So this does the opening handshake, writes unmasked
text frames, answers a ping, honours a close, and nothing else. A library
would do more, and would be one more package to keep installed on thirteen
Raspberry Pis for years.

It listens on loopback only, and it checks the page's Origin. Loopback keeps
the museum network from driving a kiosk; the Origin check keeps any other
page the kiosk's browser might open from reading its sensor. D-156.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import struct
from typing import Callable, Iterable

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_HEADER_BYTES = 8192


def accept_key(key: str) -> str:
    """Sec-WebSocket-Accept for a Sec-WebSocket-Key. RFC 6455 section 4.2.2."""
    return base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()


def text_frame(text: str) -> bytes:
    """One final, unmasked text frame. A server never masks. RFC 6455 section 5.1."""
    payload = text.encode()
    n = len(payload)
    if n < 126:
        head = struct.pack("!BB", 0x81, n)
    elif n < 1 << 16:
        head = struct.pack("!BBH", 0x81, 126, n)
    else:
        head = struct.pack("!BBQ", 0x81, 127, n)
    return head + payload


def control_frame(opcode: int, payload: bytes = b"") -> bytes:
    return struct.pack("!BB", 0x80 | opcode, len(payload)) + payload


def parse_request(raw: bytes) -> tuple[str, dict[str, str]]:
    """The request line and the headers, lower-cased."""
    lines = raw.decode("latin-1").split("\r\n")
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if ":" in line:
            name, value = line.split(":", 1)
            headers[name.strip().lower()] = value.strip()
    return lines[0], headers


class Hub:
    """The connected pages, and a broadcast to all of them."""

    def __init__(self, origins: Iterable[str], hello: Callable[[], dict]) -> None:
        self.origins = set(origins)
        # A function, because what the daemon has attached can change while it
        # runs: a reader plugged in after boot is announced to the next page.
        self.hello = hello
        self.clients: set[asyncio.StreamWriter] = set()

    def broadcast(self, message: dict) -> None:
        data = text_frame(json.dumps(message, separators=(",", ":")))
        for writer in list(self.clients):
            if writer.is_closing():
                self.clients.discard(writer)
                continue
            writer.write(data)

    def close_all(self) -> None:
        """
        A close frame to every page, then the sockets. Sent on shutdown so a
        kiosk hears at once that the daemon is going, rather than waiting on a
        socket nobody will write to again. Since Python 3.12 the server also
        waits for every connection to close before it stops, so without this a
        restart under systemd would hang until the kill timeout.
        """
        for writer in list(self.clients):
            if not writer.is_closing():
                writer.write(control_frame(0x8, struct.pack("!H", 1001)))
                writer.close()
        self.clients.clear()

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=5)
        except (asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            writer.close()
            return
        if len(raw) > MAX_HEADER_BYTES:
            writer.close()
            return
        request, headers = parse_request(raw)
        key = headers.get("sec-websocket-key")
        origin = headers.get("origin")
        if not request.startswith("GET ") or headers.get("upgrade", "").lower() != "websocket" or key is None:
            writer.write(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
            writer.close()
            return
        # No Origin at all is a native client on this machine, like a test.
        # A browser always sends one, and only the kiosk's own is let in.
        if origin is not None and origin not in self.origins:
            writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            writer.close()
            return
        writer.write(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept_key(key)}\r\n\r\n"
            ).encode()
        )
        writer.write(text_frame(json.dumps(self.hello(), separators=(",", ":"))))
        self.clients.add(writer)
        try:
            await self._read_frames(reader, writer)
        finally:
            self.clients.discard(writer)
            writer.close()

    async def _read_frames(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        """Reads what the page sends, which should only ever be pings and a close."""
        while True:
            try:
                head = await reader.readexactly(2)
                opcode = head[0] & 0x0F
                masked = head[1] & 0x80
                length = head[1] & 0x7F
                if length == 126:
                    (length,) = struct.unpack("!H", await reader.readexactly(2))
                elif length == 127:
                    (length,) = struct.unpack("!Q", await reader.readexactly(8))
                if length > 1 << 16:
                    return
                mask = await reader.readexactly(4) if masked else b"\x00\x00\x00\x00"
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(await reader.readexactly(length)))
            except (asyncio.IncompleteReadError, ConnectionError):
                return
            if opcode == 0x8:
                writer.write(control_frame(0x8, payload[:2]))
                return
            if opcode == 0x9:
                writer.write(control_frame(0xA, payload[:125]))
