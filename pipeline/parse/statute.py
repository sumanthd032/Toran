"""
Act of Parliament parser, for a consolidated text published as a PDF.

The text is read with pdftotext's layout mode, which keeps a section's heading
at the margin and its sub-sections indented. A heading is only accepted as the
next section if it carries the number that section should have: 7 is followed
by 7A or 8, never by a numbered sub-section that happens to sit at the margin.

A consolidated text interleaves the amending history with the law: footnotes
such as "Subs. by Act 106 of 1976" at the margin, and bare figures on a line of
their own that anchor them. Both are removed from the text the archive serves,
and the bracket notation that marks an amendment inside a provision is kept,
because it is part of the text as published.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path

# A heading has one space after its number. The sub-sections are list items
# with a tab after theirs, which layout mode turns into several spaces.
HEADING = re.compile(r"^\s{0,6}\[?(\d{1,2}[A-Z]{0,2})\. (?! )([A-Z][^\n]{2,160}?)\s*$")
FOOTNOTE = re.compile(
    r"^\d{1,2}\.\s+(Subs\b|Ins\b|The words|Clause|Extended|1st June|Omitted|Added|"
    r"Renumbered|Sub-section|Proviso|Section\s+\d|Now\b|Rep\.|Cl\.)"
)
MARKER = re.compile(r"^\s*\d{1,2}\s*$")


@dataclass
class Section:
    section: str
    heading: str
    text: str

    def to_json(self) -> dict:
        return asdict(self)


def _order(number: str) -> tuple[int, str]:
    m = re.match(r"(\d+)([A-Z]*)", number)
    return (int(m.group(1)), m.group(2)) if m else (0, "")


def _follows(previous: str | None, number: str) -> bool:
    """7 may be followed by 7A or 8; 7A by 7B or 8."""
    if previous is None:
        return number == "1"
    p, n = _order(previous), _order(number)
    if n[0] == p[0]:
        return n[1] > p[1]
    return n[0] == p[0] + 1 and n[1] in ("", "A")


def _flat(lines: list[str]) -> str:
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def read_layout(pdf: Path) -> str:
    return subprocess.run(
        ["pdftotext", "-layout", str(pdf), "-"], check=True, capture_output=True, text=True,
    ).stdout


def without_history(layout: str) -> list[str]:
    """The Act's lines without its amending history: footnote blocks and the
    bare figures that point to them. Lines are dropped, never rewritten."""
    kept: list[str] = []
    in_note = False
    for line in layout.replace("\f", "\n").split("\n"):
        if FOOTNOTE.match(line):
            in_note = True
            continue
        if in_note:
            if line.strip() == "":
                in_note = False
            continue
        if MARKER.match(line):
            continue
        kept.append(line)
    return kept


def parse(layout: str) -> list[Section]:
    kept = without_history(layout)

    # The long title runs from "An Act to" to the enacting formula.
    text = "\n".join(kept)
    title = re.search(r"(An Act to .*?)\n\s*BE it enacted", text, re.S)
    sections: list[Section] = []
    if title is not None:
        sections.append(Section("title", "Long title", _flat([title.group(1)])))

    start = text.find("BE it enacted")
    body = text[start:].split("\n") if start != -1 else kept
    current: Section | None = None
    buffer: list[str] = []
    previous: str | None = None
    for line in body[1:]:
        m = HEADING.match(line)
        if m is not None and _follows(previous, m.group(1)):
            if current is not None:
                current.text = _flat(buffer)
                sections.append(current)
            previous = m.group(1)
            current = Section(previous, m.group(2).strip().rstrip("."), "")
            buffer = []
            continue
        if current is not None:
            buffer.append(line)
    if current is not None:
        current.text = _flat(buffer)
        sections.append(current)
    return sections
