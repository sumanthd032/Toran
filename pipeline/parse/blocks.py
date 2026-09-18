"""
Reading structure for a printed page.

pdftotext -layout keeps the printed geometry. A paragraph opens with an
indent, a heading or a section numeral is centred, a table keeps its columns.
The reading view is page faithful, so it needs that structure back.

The same pass joins words the typesetter broke across lines. Left alone,
"Untouch-" at the end of one line and "ables" at the start of the next reach
a visitor as "Untouch- ables", and reach the search index as two tokens that
match nothing. Chunks are cut from the text this module produces, so what a
visitor reads and what search indexes are the same characters.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

# A word broken at a line end: letters, then the typesetter's hyphen.
BROKEN_TAIL = re.compile(r"([A-Za-z][A-Za-z'’]*)-$")
BROKEN_HEAD = re.compile(r"^([a-z][A-Za-z'’]*)")
WORD = re.compile(r"[A-Za-z][A-Za-z'’]*(?:-[A-Za-z][A-Za-z'’]*)*")

# Compounds the printed volumes hyphenate when the joined form is not seen
# anywhere else. A line break after "self-" is far more likely to be
# "self-imposed" than "selfimposed".
HYPHEN_PREFIXES = frozenset({
    "self", "non", "inter", "sub", "cross", "well", "deep", "co", "anti",
    "pre", "ex", "semi", "quasi", "ultra", "counter", "over", "under",
    "half", "post", "pro", "neo", "all", "twice", "thrice",
})

# Tables are set in columns separated by runs of spaces. Census tables in
# volume 1 are the reason this exists.
COLUMN_GAP = re.compile(r"\s{2,}")
WIDE_GAP = re.compile(r"\S\s{6,}\S")
# A cell of figures, or of several figures set a space apart as one column.
FIGURE = re.compile(r"^[\d.,:%()\-–]+(?: [\d.,:%()\-–]+)*$|^\.\.+$")

SENTENCE_END = re.compile(r"[.!?:;\"”’)]$")


@dataclass
class Block:
    kind: str  # paragraph | heading | table
    text: str
    # A paragraph carried over from the previous page, printed without an indent.
    continued: bool = False
    # Headings are centred as printed, or set right, as a signature is.
    align: str = "centre"

    def to_json(self) -> dict:
        d: dict = {"kind": self.kind, "text": self.text}
        if self.kind == "paragraph" and self.continued:
            d["continued"] = True
        if self.kind == "heading" and self.align != "centre":
            d["align"] = self.align
        return d


def vocabulary(pages: Iterable[str]) -> set[str]:
    """
    Every word the volume prints whole, lower cased.

    The two pieces of a broken word are left out, so a word only counts as
    known if the typesetter set it unbroken somewhere else.
    """
    seen: set[str] = set()
    for text in pages:
        lines = text.split("\n")
        for i, line in enumerate(lines):
            tokens = WORD.findall(line)
            if not tokens:
                continue
            if BROKEN_TAIL.search(line.rstrip()):
                tokens = tokens[:-1]
            prev = lines[i - 1].rstrip() if i > 0 else ""
            if prev and BROKEN_TAIL.search(prev) and BROKEN_HEAD.match(line.lstrip()):
                tokens = tokens[1:]
            seen.update(t.lower() for t in tokens)
    return seen


def join_broken(left: str, right: str, known: set[str]) -> str:
    """How to rejoin "left-" at a line end with "right" at the next start."""
    whole = f"{left}{right}".lower()
    hyphenated = f"{left}-{right}".lower()
    if whole in known and hyphenated not in known:
        return f"{left}{right}"
    if hyphenated in known:
        return f"{left}-{right}"
    if left.lower() in HYPHEN_PREFIXES:
        return f"{left}-{right}"
    return f"{left}{right}"


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _cells(line: str) -> list[str]:
    return [c for c in COLUMN_GAP.split(line.strip()) if c]


def _table_rows(lines: list[str]) -> set[int]:
    """
    Which lines belong to a table.

    A line set in three or more columns, or with a gap no prose line has, is
    set in columns. It is a table row if most of its cells are figures, or if
    it sits within two lines of one that is: a column header of place names
    has no figures, but it heads a table that does. Short lines caught between
    rows, a header word set on its own line, stay in the table.
    """
    wide = [WIDE_GAP.search(l.strip()) is not None for l in lines]
    columnar = [len(_cells(l)) >= 3 or wide[i] for i, l in enumerate(lines)]
    numeric = [
        columnar[i] and sum(1 for c in _cells(l) if FIGURE.match(c)) * 2 >= len(_cells(l))
        for i, l in enumerate(lines)
    ]
    rows: set[int] = set()
    grew = True
    while grew:
        grew = False
        for i, is_col in enumerate(columnar):
            if not is_col or i in rows:
                continue
            near = range(max(0, i - 2), min(len(lines), i + 3))
            if numeric[i] or any(numeric[j] or j in rows for j in near if j != i):
                rows.add(i)
                grew = True
    ordered = sorted(rows)
    for a, b in zip(ordered, ordered[1:]):
        if b - a <= 4 and all(len(lines[k].strip()) <= 30 for k in range(a + 1, b)):
            rows.update(range(a + 1, b))
    return rows


def _is_heading(line: str, width: int) -> bool:
    stripped = line.strip()
    indent = _indent(line)
    if not stripped or len(stripped) > 70:
        return False
    centred = indent >= max(10, width // 5) and len(stripped) <= width * 0.6
    if not centred:
        return False
    letters = [c for c in stripped if c.isalpha()]
    upper = bool(letters) and sum(c.isupper() for c in letters) >= len(letters) * 0.8
    return upper or len(stripped) <= 40


def page_blocks(text: str, known: set[str]) -> list[Block]:
    """
    Paragraphs, headings and tables, in printed order.

    Lines inside a paragraph are joined with a space, or with nothing after a
    dash, and a broken word is rejoined by `join_broken`. A table keeps its
    spacing, trimmed of the indent its rows share, so it can be set as printed.
    """
    lines = [l.rstrip() for l in text.split("\n")]
    width = max((len(l) for l in lines), default=0)
    blocks: list[Block] = []
    para: list[str] = []
    table: list[str] = []
    heading: list[str] = []

    def flush_para() -> None:
        if not para:
            return
        joined = para[0].strip()
        for nxt in para[1:]:
            nxt = nxt.strip()
            tail = BROKEN_TAIL.search(joined)
            head = BROKEN_HEAD.match(nxt)
            if tail and head:
                left, right = tail.group(1), head.group(1)
                joined = joined[: tail.start()] + join_broken(left, right, known) + nxt[len(right):]
            elif joined.endswith(("—", "–")):
                joined += nxt
            else:
                joined += " " + nxt
        blocks.append(Block("paragraph", re.sub(r"\s+", " ", joined).strip()))
        para.clear()

    def flush_table() -> None:
        if not table:
            return
        shared = min(_indent(l) for l in table if l.strip())
        blocks.append(Block("table", "\n".join(l[shared:] for l in table).strip("\n")))
        table.clear()

    def flush_heading() -> None:
        if not heading:
            return
        right = all(_indent(h) > width * 0.4 and len(h) >= width - 2 for h in heading)
        text = re.sub(r"\s+", " ", " ".join(h.strip() for h in heading))
        blocks.append(Block("heading", text, align="right" if right else "centre"))
        heading.clear()

    rows = _table_rows(lines)
    prev = ""
    for number, line in enumerate(lines):
        if not line.strip():
            flush_para()
            flush_heading()
            if table:
                table.append("")
            prev = ""
            continue
        if number in rows:
            flush_para()
            flush_heading()
            table.append(line)
            prev = line
            continue
        if table:
            # A single blank line inside a table is kept; the table ends at text.
            while table and not table[-1].strip():
                table.pop()
            flush_table()
        if _is_heading(line, width):
            # A section numeral often follows its paragraph with no blank line.
            flush_para()
            heading.append(line)
            prev = line
            continue
        flush_heading()
        indent = _indent(line)
        # The second half of a broken word never opens a paragraph.
        carried = BROKEN_TAIL.search(prev) is not None and BROKEN_HEAD.match(line.lstrip())
        starts = not carried and (
            not para
            or (indent >= 2 and indent - _indent(prev) >= 2)
            or (
                SENTENCE_END.search(prev.strip()) is not None
                and len(prev.strip()) < width * 0.8
                and indent >= 2
            )
        )
        if starts:
            flush_para()
        para.append(line)
        prev = line

    flush_para()
    flush_heading()
    while table and not table[-1].strip():
        table.pop()
    flush_table()

    first = next((l for l in lines if l.strip()), "")
    if blocks and blocks[0].kind == "paragraph" and _indent(first) < 2:
        blocks[0].continued = True
    return blocks


def body_text(blocks: list[Block]) -> str:
    """The page as one run of text, for chunking and indexing."""
    return " ".join(re.sub(r"\s+", " ", b.text).strip() for b in blocks).strip()
