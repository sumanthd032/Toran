"""
Page extraction for typeset PDFs.

The citable unit in an archive is the page as printed, not an index into a
file. BAWS volumes carry the printed number in the running head: on a verso
it leads the line, on a recto it trails it. Neither position is reliable on
its own, because appendix and map headings look identical to a running head
with a trailing number, so a detected number is only trusted when it also
agrees with the surrounding sequence.

Pages where the number had to be inferred are marked. A citation to an
inferred page is weaker than one to an observed page and the archive records
which it is rather than flattening the difference.
"""

from __future__ import annotations

import re
import subprocess
from collections import Counter
from dataclasses import dataclass, asdict
from pathlib import Path

# A running head is a number beside a title set in capitals. Requiring the
# capitalised title is what separates a real running head from "APPENDIX 4".
VERSO = re.compile(r"^(\d{1,4})\s{2,}([A-Z][A-Z0-9 .:,;'&()\-]{7,})$")
RECTO = re.compile(r"^([A-Z][A-Z0-9 .:,;'&()\-]{7,}?)\s{2,}(\d{1,4})$")

ROMAN_VERSO = re.compile(r"^([IVXLCDM]{1,8})\s{2,}([A-Z][A-Z0-9 .:,;'&()\-]{7,})$")
ROMAN_RECTO = re.compile(r"^([A-Z][A-Z0-9 .:,;'&()\-]{7,}?)\s{2,}([IVXLCDM]{1,8})$")

# Headings that are not running heads, however much they look like one.
NOT_A_HEAD = re.compile(
    r"^\s*(APPENDIX|MAP|TABLE|CHART|PLATE|FIGURE|PART|CHAPTER|SECTION)\b", re.I
)

# Some volumes were printed with the typesetter's slug line still on the page,
# for example "D:\AMBEDKAR\VOL-07\VOL7-01  Mk S.K.-26-09-2013>DK>9-11-2013  32".
# It is production residue, not part of the work, so it is skipped when looking
# for the running head and removed from the text the archive serves.
SLUG = re.compile(r"^[A-Z]:\\|\\VOL-?\d|\bMk\s+[A-Z]\.[A-Z]\.")

ROMAN_VALUE = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def roman_to_int(s: str) -> int | None:
    total = 0
    prev = 0
    for ch in reversed(s.upper()):
        v = ROMAN_VALUE.get(ch)
        if v is None:
            return None
        total += -v if v < prev else v
        prev = max(prev, v)
    return total or None


@dataclass
class Page:
    """One physical page of one source document."""

    pdf_index: int          # 1-based position in the file
    printed: str | None     # the page number as printed, "23" or "xiv"
    numbering: str          # arabic | roman | none
    observed: bool          # True if read off the page, False if inferred
    text: str
    chars: int

    def to_json(self) -> dict:
        d = asdict(self)
        return d


def extract_pages(pdf: Path) -> list[str]:
    """Raw per-page text, preserving layout so running heads stay on one line."""
    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf), "-"],
        capture_output=True,
        text=True,
        check=True,
    )
    pages = result.stdout.split("\f")
    # pdftotext emits a trailing form feed, so the last element is empty.
    if pages and not pages[-1].strip():
        pages.pop()
    return pages


def strip_slug_lines(page_text: str) -> str:
    """Remove typesetter slug lines. They are not part of the work."""
    kept = [l for l in page_text.split("\n") if not SLUG.search(l.strip())]
    return "\n".join(kept)


def _candidate(page_text: str) -> tuple[str | None, str]:
    """
    The number in this page's running head, if it has one.

    The head is not always the first line: a slug line may precede it, and a
    chapter opening may push it down, so the first few lines are tried.
    """
    lines = [l.rstrip() for l in page_text.split("\n") if l.strip()]
    for raw in lines[:3]:
        if SLUG.search(raw.strip()):
            continue
        # Verso heads sit flush left, recto heads are centred, so the line is
        # stripped before matching and the number's position carries the side.
        head = raw.strip()
        if NOT_A_HEAD.match(head):
            continue

        m = VERSO.match(head)
        if m:
            return m.group(1), "arabic"
        m = RECTO.match(head)
        if m:
            return m.group(2), "arabic"
        m = ROMAN_VERSO.match(head)
        if m and roman_to_int(m.group(1)):
            return m.group(1), "roman"
        m = ROMAN_RECTO.match(head)
        if m and roman_to_int(m.group(2)):
            return m.group(2), "roman"
    return None, "none"


def _dominant_offset(candidates: dict[int, int]) -> dict[int, int]:
    """
    Map each pdf index to the offset (pdf_index - printed) that the local
    neighbourhood agrees on. Sequences in a book are locally constant and
    shift at inserted plates, so a single global offset would be wrong.
    """
    if not candidates:
        return {}
    offsets = {i: i - n for i, n in candidates.items()}
    indices = sorted(offsets)
    resolved: dict[int, int] = {}
    window = 12
    for i in indices:
        near = [offsets[j] for j in indices if abs(j - i) <= window]
        resolved[i] = Counter(near).most_common(1)[0][0]
    return resolved


def parse(pdf: Path) -> list[Page]:
    """Per-page records with printed numbers, observed where possible."""
    raw_pages = [strip_slug_lines(p) for p in extract_pages(pdf)]

    arabic: dict[int, int] = {}
    roman: dict[int, str] = {}
    for idx, text in enumerate(raw_pages, start=1):
        value, kind = _candidate(text)
        if kind == "arabic" and value is not None:
            arabic[idx] = int(value)
        elif kind == "roman" and value is not None:
            roman[idx] = value

    # Trust an arabic candidate only where it agrees with its neighbours.
    resolved = _dominant_offset(arabic)
    trusted = {i: n for i, n in arabic.items() if i - n == resolved.get(i)}

    pages: list[Page] = []
    trusted_indices = sorted(trusted)
    for idx, text in enumerate(raw_pages, start=1):
        if idx in trusted:
            printed, numbering, observed = str(trusted[idx]), "arabic", True
        elif idx in roman:
            printed, numbering, observed = roman[idx], "roman", True
        elif trusted_indices:
            # Infer from the nearest trusted anchor using its local offset.
            anchor = min(trusted_indices, key=lambda a: abs(a - idx))
            offset = anchor - trusted[anchor]
            inferred = idx - offset
            if inferred >= 1:
                printed, numbering, observed = str(inferred), "arabic", False
            else:
                printed, numbering, observed = None, "none", False
        else:
            printed, numbering, observed = None, "none", False

        pages.append(
            Page(
                pdf_index=idx,
                printed=printed,
                numbering=numbering,
                observed=observed,
                text=text,
                chars=len(text.strip()),
            )
        )
    return pages
