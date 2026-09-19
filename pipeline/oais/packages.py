"""
OAIS packaging (ISO 14721).

Three package types, on disk, in three directories.

  SIP   what arrived. The original bytes, untouched, plus where they came
        from and what they hashed to on arrival.
  AIP   what is kept. Normalised records, descriptive metadata in Dublin
        Core, a preservation event log in PREMIS, and a fixity manifest.
  DIP   what is served. Derived from the AIP and freely rebuildable, so it
        is never the thing being preserved.

The AIP is the authority. If the DIP and the AIP disagree, the DIP is wrong
and is rebuilt.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

AGENT = "toran-pipeline"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )


class Premis:
    """
    Append-only preservation event log.

    A curator correction is an event, not an overwrite. The machine output and
    the human correction both survive, which is the point of keeping events
    rather than only keeping state.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def event(
        self,
        event_type: str,
        outcome: str,
        detail: str,
        objects: Iterable[str] = (),
        agent: str = AGENT,
    ) -> None:
        record = {
            "eventType": event_type,
            "eventDateTime": now(),
            "eventOutcome": outcome,
            "eventOutcomeDetail": detail,
            "linkingAgentIdentifier": agent,
            "linkingObjectIdentifier": list(objects),
        }
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")


# The fifteen elements of the Dublin Core Metadata Element Set. Only these
# names are emitted, so the record validates against the standard rather than
# against our own invention.
DC_ELEMENTS = (
    "title",
    "creator",
    "subject",
    "description",
    "publisher",
    "contributor",
    "date",
    "type",
    "format",
    "identifier",
    "source",
    "language",
    "relation",
    "coverage",
    "rights",
)


def dublin_core(**fields: Any) -> dict[str, Any]:
    """Build a Dublin Core record, rejecting anything outside the element set."""
    unknown = set(fields) - set(DC_ELEMENTS)
    if unknown:
        raise ValueError(f"not Dublin Core elements: {sorted(unknown)}")
    return {k: fields[k] for k in DC_ELEMENTS if fields.get(k) is not None}


def write_fixity(sip: Path, out: Path) -> dict[str, str]:
    """Digest every submitted object. The submission records are not objects."""
    fixity = {}
    for path in sorted(sip.rglob("*")):
        if path.is_file() and path.name != "submission.json":
            fixity[str(path.relative_to(sip))] = sha256_file(path)
    write_json(out, fixity)
    return fixity


def verify_fixity(root: Path, manifest: dict[str, str]) -> list[str]:
    """Re-hash everything in the manifest. Returns the paths that changed."""
    failures = []
    for rel, expected in manifest.items():
        target = root / rel
        if not target.exists():
            failures.append(f"{rel}: missing")
        elif sha256_file(target) != expected:
            failures.append(f"{rel}: digest changed")
    return failures
