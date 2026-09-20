"""
What both OCR pipelines share: where scans and results live, the shape of a
result, and the plain text of a region.

Standard library only, so the same code runs under the system Python and
under the Python 3.13 environment Surya needs.
"""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"
DIP = DATA / "dip"
SCANS = DIP / "scans"
OCR = DIP / "ocr"

sys.path.insert(0, str(ROOT / "pipeline"))


def scans(kind: str | None = None) -> list[dict]:
    """The scanned pages, optionally only the printed ones or only the hands."""
    index = DIP / "scans.json"
    if not index.exists():
        raise SystemExit("no scans yet. Run python3 pipeline/scans.py")
    pages = json.loads(index.read_text(encoding="utf-8"))
    return [p for p in pages if kind is None or p["kind"] == kind]


BLOCK = re.compile(r"</(p|div|h[1-6]|li|tr|table|section)>", re.I)
BREAK = re.compile(r"<br\s*/?>", re.I)
TAG = re.compile(r"<[^>]+>")


def text_of(markup: str) -> str:
    """
    The words a reader sees. Surya returns a block as HTML; a line break in
    the markup is a line break on the page, and everything else is dropped.
    """
    text = BREAK.sub("\n", markup)
    text = BLOCK.sub("\n", text)
    text = TAG.sub("", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def normalise(text: str) -> str:
    """
    For scoring only. Collapses whitespace so a line break where the original
    wrapped is not counted as an error, and nothing else: a wrong character
    stays wrong, and a dropped word stays dropped.
    """
    return re.sub(r"\s+", " ", text).strip()


def write_result(page_id: str, payload: dict) -> Path:
    OCR.mkdir(parents=True, exist_ok=True)
    path = OCR / f"{page_id}.{payload['pipeline']}.json"
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return path


def read_result(page_id: str, pipeline: str) -> dict | None:
    path = OCR / f"{page_id}.{pipeline}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def full_text(result: dict) -> str:
    """Every region of a result in reading order, as one passage."""
    ordered = sorted(result["regions"], key=lambda r: r["order"])
    return "\n\n".join(r["text"] for r in ordered if r["text"].strip())
