"""
Constituent Assembly Debates parser.

The debates have no stable pagination online, but the published transcription
numbers every paragraph as volume.sitting.paragraph, for example 7.62.186.
That is the citable unit and it is what the archive stores. Inventing page
numbers to make CAD look like a printed book would be a fabrication.

Each paragraph block in the source carries three things: the paragraph number,
the speaker where one is attributed, and the prose. Procedural text such as a
division result has no speaker, and that is recorded as no speaker rather than
being attributed to whoever spoke last.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, asdict

# Each paragraph is a grid row carrying a numeric anchor id.
BLOCK = re.compile(r'<div class="lg:grid[^"]*"\s+id="(\d+)">(.*?)(?=<div class="lg:grid|\Z)', re.S)
# The paragraph number sits in a highlighted span.
PARA_NUM = re.compile(r'<span class="[^"]*bg-\[#[0-9A-Fa-f]{6}\][^"]*">\s*([\d.]+)\s*</span>')
# The speaker sits in the second column of the left grid.
SPEAKER = re.compile(r'<span class="col-span-2 sm:col-span-4[^"]*">\s*(.*?)\s*</span>', re.S)
# The prose sits in the content column.
CONTENT = re.compile(r'<div class="[^"]*\bcontent\b[^"]*">(.*?)</div>', re.S)

TAG = re.compile(r"<[^>]+>")
WS = re.compile(r"[ \t]+")


def _text(fragment: str) -> str:
    # Paragraph and break boundaries become newlines before tags are dropped,
    # so sentences do not run together.
    s = re.sub(r"</p>|<br\s*/?>", "\n", fragment)
    s = TAG.sub("", s)
    s = html.unescape(s)
    s = WS.sub(" ", s)
    return "\n".join(line.strip() for line in s.split("\n") if line.strip())


@dataclass
class Paragraph:
    anchor: str
    volume: int
    sitting: int
    paragraph: int
    speaker: str | None
    text: str
    chars: int
    # True for an unnumbered procedural record located by the paragraph it
    # follows: division results, adoptions, the Assembly rising. The source
    # does not number these, and they carry the outcomes.
    procedural: bool = False

    def to_json(self) -> dict:
        return asdict(self)


def parse(html_source: str, expect_volume: int | None = None) -> list[Paragraph]:
    out: list[Paragraph] = []
    last: tuple[int, int, int] | None = None

    for anchor, block in BLOCK.findall(html_source):
        content = CONTENT.search(block)
        if content is None:
            continue
        text = _text(content.group(1))
        if not text:
            continue

        num = PARA_NUM.search(block)

        if num is not None:
            bits = num.group(1).split(".")
            if len(bits) != 3 or not all(b.isdigit() for b in bits):
                continue
            volume, sitting, paragraph = (int(b) for b in bits)
            if expect_volume is not None and volume != expect_volume:
                continue
            last = (volume, sitting, paragraph)
            sp = SPEAKER.search(block)
            speaker = _text(sp.group(1)) if sp else ""
            out.append(
                Paragraph(anchor, volume, sitting, paragraph,
                          speaker or None, text, len(text), procedural=False)
            )
            continue

        # Unnumbered. Keep it, located by the paragraph it follows. A record
        # before the first numbered paragraph has nothing to anchor to and is
        # the only thing dropped.
        if last is None:
            continue
        volume, sitting, paragraph = last
        out.append(
            Paragraph(anchor, volume, sitting, paragraph,
                      None, text, len(text), procedural=True)
        )
    return out


def sitting_date(html_source: str) -> str | None:
    """ISO date of the sitting, taken from the canonical URL."""
    m = re.search(r"/debates/(\d{2})-([a-z]{3})-(\d{4})/", html_source)
    if m is None:
        return None
    months = {
        "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
        "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
    }
    day, mon, year = m.groups()
    month = months.get(mon.lower())
    return None if month is None else f"{year}-{month}-{day}"
