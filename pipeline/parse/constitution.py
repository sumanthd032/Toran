"""
Constitution of India article parser.

Each article page carries the ratified text and, where the drafting history is
recorded, the earlier versions it passed through. The version labels name the
draft article number and the year, for example "Article 11, Draft Constitution
of India 1948", which is the link from a ratified article back to the draft the
Assembly actually debated.

That link is an assertion made by the source, not by us, and it is stored with
the source attached so step 7 can show a reader where it came from rather than
asking them to trust it.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, asdict

# The article number is taken from the canonical URL rather than from the
# page furniture, because the slug is stable and the markup around the number
# is not.
SLUG = re.compile(r'/articles/article-(\d{1,3}[a-z]?)-[^"/]*/', re.I)
HEADING = re.compile(r'<h1[^>]*>\s*(.*?)\s*</h1>', re.S)
INTRO = re.compile(r'<div class="[^"]*\bcontent\b[^"]*">\s*<p>(.*?)</p>', re.S)
VERSION = re.compile(
    r'<h3[^>]*>\s*Version\s+(\d+)\s*</h3>.*?'
    r'<div class="article-detail__content__sub-block[^"]*">\s*'
    r'<p><strong>(.*?)</strong></p>\s*(.*?)\s*</div>',
    re.S,
)
VERSION_LABEL = re.compile(
    r'Article\s+(\d{1,3}[A-Z]?)\s*,\s*(.*?)\s*(\d{4})\s*$'
)
SUMMARY_DEBATED = re.compile(
    r'Draft Article\s+(\d{1,3}[A-Z]?)[^.]*?was debated on\s*</?[^>]*>?\s*([0-9]{1,2}\s+\w+\s+[0-9]{4})',
    re.S,
)
TAG = re.compile(r"<[^>]+>")


def _text(fragment: str) -> str:
    s = re.sub(r"</p>|<br\s*/?>", "\n", fragment)
    s = TAG.sub("", s)
    s = html.unescape(s).replace("\xa0", " ")
    s = re.sub(r"[ \t]+", " ", s)
    return "\n".join(line.strip() for line in s.split("\n") if line.strip())


@dataclass
class Version:
    ordinal: int
    label: str
    article: str | None
    document: str | None
    year: int | None
    text: str


@dataclass
class Article:
    article: str
    heading: str
    text: str
    versions: list[Version]
    debated_on: str | None

    def to_json(self) -> dict:
        return asdict(self)


MONTHS = {m.lower(): f"{i:02d}" for i, m in enumerate(
    ["January","February","March","April","May","June","July",
     "August","September","October","November","December"], start=1)}


def _iso(day_month_year: str) -> str | None:
    m = re.match(r"(\d{1,2})\s+(\w+)\s+(\d{4})", day_month_year.strip())
    if m is None:
        return None
    day, month, year = m.groups()
    mm = MONTHS.get(month.lower())
    return None if mm is None else f"{year}-{mm}-{int(day):02d}"


def parse(html_source: str) -> Article | None:
    slug = SLUG.search(html_source)
    head = HEADING.search(html_source)
    if slug is None or head is None:
        return None
    article, heading = slug.group(1).upper(), _text(head.group(1))

    intro = INTRO.search(html_source)
    text = _text(intro.group(1)) if intro else ""

    versions: list[Version] = []
    for ordinal, label_raw, body in VERSION.findall(html_source):
        label = _text(label_raw)
        m = VERSION_LABEL.match(label)
        versions.append(Version(
            ordinal=int(ordinal),
            label=label,
            article=m.group(1) if m else None,
            document=m.group(2).strip() if m else None,
            year=int(m.group(3)) if m else None,
            text=_text(body),
        ))

    flat = _text(html_source)
    d = re.search(r"Draft Article\s+\d{1,3}[A-Z]?.*?was debated on\s*(\d{1,2}\s+\w+\s+\d{4})", flat, re.S)
    debated = _iso(d.group(1)) if d else None

    return Article(article=article, heading=heading, text=text,
                   versions=versions, debated_on=debated)
