"""
What the two OCR pipelines are actually worth, measured on a held-out set.

Run:  python3 pipeline/ocr/accuracy.py

The held-out passages are in data/curation/transcriptions.jsonl, with where
each one's words came from. A number is only as good as its ground truth, so
the method is printed beside every score and the two are never silently
averaged together.

A passage is found in a reading by aligning it against the reading's whole
text and taking the best matching span, because a page holds more than the
passage: running heads, marginal notes, the article before and the article
after. Scoring the whole page against one passage would measure the wrong
thing. Character error rate is Levenshtein distance over the length of the
ground truth; word error rate is the same over words.

Standard library only.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ocr.common import DIP, OCR, full_text, normalise, read_result, scans

HELD_OUT = Path(__file__).resolve().parent.parent.parent / "data" / "curation" / "transcriptions.jsonl"
PIPELINES = ["surya", "vlm"]


def distance(a: list[str] | str, b: list[str] | str) -> int:
    """Levenshtein, over characters or over words."""
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (x != y),
            ))
        previous = current
    return previous[-1]


def best_span(truth: str, reading: str) -> str:
    """
    The span of the reading that the ground truth best lines up with.

    Slides a window the length of the truth across the reading a word at a
    time and keeps the window with the fewest character errors. A page with
    nothing like the passage on it scores badly, which is correct.
    """
    words = reading.split()
    target = len(truth.split())
    if target == 0 or not words:
        return reading
    best, score = reading, None
    # Slack on both sides. A reading may split or join words, and a page's
    # marginal notes land inside the passage in reading order, which makes
    # the span that holds it longer than the passage itself.
    for width in range(max(1, target - 3), target + 9):
        for start in range(0, max(1, len(words) - width + 1)):
            span = " ".join(words[start : start + width])
            d = distance(span, truth)
            if score is None or d < score:
                best, score = span, d
    return best


def main() -> int:
    if not HELD_OUT.exists():
        raise SystemExit(f"no held-out set at {HELD_OUT}")
    held = [json.loads(line) for line in HELD_OUT.read_text(encoding="utf-8").splitlines() if line.strip()]
    by_id = {s["id"]: s for s in scans()}

    rows = []
    for item in held:
        scan = by_id.get(item["pageId"])
        if scan is None:
            raise SystemExit(f"{item['pageId']} is in the held-out set but not in the archive")
        for pipeline in PIPELINES:
            result = read_result(item["pageId"], pipeline)
            if result is None:
                continue
            truth = normalise(item["text"])
            span = best_span(truth, normalise(full_text(result)))
            cer = distance(span, truth) / max(1, len(truth))
            wer = distance(span.split(), truth.split()) / max(1, len(truth.split()))
            # How much of the span is text the passage does not contain. A
            # page's running head and marginal notes fall inside a passage in
            # reading order, and that is a different failing from misreading
            # a letter, so it is reported and not folded in.
            extra = max(0, len(span) - len(truth))
            rows.append({
                "pageId": item["pageId"],
                "passage": item["passage"],
                "hand": scan["kind"],
                "script": scan["script"],
                "language": scan["language"],
                "pipeline": pipeline,
                "model": result["model"],
                "method": item["method"],
                "characters": len(truth),
                "cer": round(cer, 4),
                "wer": round(wer, 4),
                "extraCharacters": extra,
                "read": span,
                "truth": truth,
            })

    if not rows:
        raise SystemExit("no OCR results to score. Run ocr:printed and ocr:handwriting first")

    print("\nOCR accuracy, on the held-out set in data/curation/transcriptions.jsonl\n")
    print(f"  {'page':<28} {'pipeline':<8} {'ground truth':<11} {'chars':>6} {'CER':>8} {'WER':>8} {'extra':>7}")
    for r in sorted(rows, key=lambda r: (r["pipeline"], r["pageId"])):
        print(f"  {r['pageId']:<28} {r['pipeline']:<8} {r['method']:<11} "
              f"{r['characters']:>6} {r['cer'] * 100:>7.1f}% {r['wer'] * 100:>7.1f}% "
              f"{r['extraCharacters']:>7}")

    summary = {}
    for pipeline in PIPELINES:
        mine = [r for r in rows if r["pipeline"] == pipeline]
        if not mine:
            continue
        summary[pipeline] = {
            "passages": len(mine),
            "model": mine[0]["model"],
            "cer": round(sum(r["cer"] for r in mine) / len(mine), 4),
            "wer": round(sum(r["wer"] for r in mine) / len(mine), 4),
            "methods": sorted({r["method"] for r in mine}),
        }
        print(f"\n  {pipeline}: {len(mine)} passage(s), "
              f"mean CER {summary[pipeline]['cer'] * 100:.1f}%, "
              f"mean WER {summary[pipeline]['wer'] * 100:.1f}%  ({mine[0]['model']})")

    # What is not measured is as much part of the result as what is.
    missing = []
    for scan in scans():
        if not any(r["pageId"] == scan["id"] for r in rows):
            missing.append(f"{scan['id']} ({scan['script']}, {scan['kind']})")
    if missing:
        print("\n  not scored, for want of a checked transcription:")
        for m in missing:
            print(f"    {m}")

    OCR.mkdir(parents=True, exist_ok=True)
    (DIP / "ocr" / "accuracy.json").write_text(
        json.dumps({"summary": summary, "rows": rows, "unscored": missing},
                   ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n  written to {(DIP / 'ocr' / 'accuracy.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
