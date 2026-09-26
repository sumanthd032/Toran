"""
From a card's UID to a Sutra token, and from a reader's polling to taps.

The token is a keyed hash of the UID, not the UID. A UID is printed into the
chip and any phone reads it, so a token that was the UID would let anyone
with a phone and the card look up a visitor's dossier on Core. Keyed with a
secret every kiosk in the hall shares, the same card gives the same token at
all thirteen devices and nowhere else. D-156.

A card resting on the reader is one tap, not ten a second. A tap is a UID
that appears after the reader has seen no card, or a different card, for at
least `gap` seconds.
"""

from __future__ import annotations

import hashlib
import hmac

# Core accepts [a-z0-9][a-z0-9-]{3,63}; the browser accepts a superset. This
# is 29 characters of that, and 96 bits of hash is not going to collide in a
# bowl of a few hundred cards.
TOKEN_PREFIX = "card-"
TOKEN_HEX = 24


def token_for(uid: bytes, secret: bytes) -> str:
    if len(secret) < 16:
        raise ValueError("the hall's card secret must be at least 16 bytes")
    digest = hmac.new(secret, uid, hashlib.sha256).hexdigest()
    return TOKEN_PREFIX + digest[:TOKEN_HEX]


class Taps:
    """Turns a stream of reads (a UID or None, with a time) into taps."""

    def __init__(self, gap: float = 1.0) -> None:
        self.gap = gap
        self.current: bytes | None = None
        self.last_seen = float("-inf")

    def read(self, uid: bytes | None, now: float) -> bytes | None:
        """Returns the UID when this read is a new tap, else None."""
        if uid is None:
            return None
        tapped = uid != self.current or now - self.last_seen >= self.gap
        self.current = uid
        self.last_seen = now
        return uid if tapped else None
