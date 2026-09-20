"""
OCR pipeline B: manuscript hands, with a vision language model. D-012.

Run:  python3 pipeline/ocr/handwriting.py [--page ID] [--passes N]

Surya does not read handwriting and says so, so a hand goes to a vision model
instead. The provider is Groq, on its free tier, which is the provider the
Research Assistant already uses. Needs GROQ_API_KEY in .env.local. Nothing
here runs on a kiosk: this is a build-time step and only its output ships.

Confidence is the hard part. A vision model will happily rate its own reading
0.95 and be wrong, and there are no token probabilities to fall back on, so
asking it how sure it is would be inventing a number. Instead the page is read
several times independently and the confidence of a line is how far the
readings agree on it. Three readings that say the same thing is evidence.
Three that disagree is exactly the place a curator should look. D-115.

Standard library only, so this runs on the system Python.
"""

from __future__ import annotations

import argparse
import base64
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ocr.common import SCANS, normalise, scans, write_result
from oais.packages import Premis, now

ROOT = Path(__file__).resolve().parent.parent.parent
AIP = ROOT / "data" / "aip"
PIPELINE = "vlm"
ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
# Groq's free tier allows 30 requests a minute. Three passes a page is well
# inside it, and the sleep keeps a run of pages inside it too.
PAUSE = 2.5
LONG_EDGE = 1600

PROMPT = (
    "This is a photograph of a handwritten manuscript page. Transcribe it exactly, "
    "line by line, as the writer wrote it.\n"
    "Keep the original spelling, punctuation and capitalisation, including anything "
    "you think is a mistake. Keep the line breaks of the page.\n"
    "Where a word is struck through, transcribe it and wrap it in [struck: ].\n"
    "Where you genuinely cannot read a word, write [illegible] rather than guessing.\n"
    "Do not translate, summarise, correct or explain. Return only the transcription."
)


def api_key() -> str:
    env = ROOT / ".env.local"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("GROQ_API_KEY=") and not line.lstrip().startswith("#"):
                key = line.split("=", 1)[1].strip().strip("\"'")
                if key:
                    return key
    key = os.environ.get("GROQ_API_KEY", "").strip()
    if key:
        return key
    raise SystemExit(
        "No GROQ_API_KEY. Copy .env.example to .env.local and put a key in it.\n"
        "A free key, no card, is at https://console.groq.com/keys"
    )


def sendable(source: Path) -> str:
    """A data URL the API will accept: long edge 1600, JPEG, under a megabyte."""
    with tempfile.TemporaryDirectory() as tmp:
        small = Path(tmp) / "page.jpg"
        subprocess.run(
            ["magick", str(source), "-auto-orient", "-colorspace", "sRGB",
             "-resize", f"{LONG_EDGE}x{LONG_EDGE}>", "-quality", "88", str(small)],
            check=True,
        )
        return "data:image/jpeg;base64," + base64.b64encode(small.read_bytes()).decode()


def read_once(key: str, data_url: str, temperature: float) -> str:
    body = json.dumps({
        "model": MODEL,
        "temperature": temperature,
        "max_completion_tokens": 2048,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }],
    }).encode()
    request = urllib.request.Request(
        ENDPOINT, data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                reply = json.loads(response.read())
            return reply["choices"][0]["message"]["content"].strip()
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:300]
            if error.code not in (429, 500, 502, 503) or attempt == 4:
                raise SystemExit(f"Groq returned {error.code}: {detail}")
            wait = error.headers.get("Retry-After")
            time.sleep(int(wait) if wait and wait.isdigit() else 5 * 2**attempt)
    raise AssertionError("unreachable")


FENCE = re.compile(r"^```[a-z]*\n|\n```$", re.I)


def lines_of(transcript: str) -> list[str]:
    text = FENCE.sub("", transcript.strip())
    return [line.strip() for line in text.splitlines() if line.strip()]


def agreement(readings: list[list[str]]) -> list[tuple[str, float]]:
    """
    One line per line of the first reading, with how far the others agree.

    The first reading is the transcription kept. Each other reading is aligned
    to it line by line, and a line's confidence is the mean similarity of the
    lines the others put in its place. A line every reading wrote identically
    scores 1.0. A line they each read differently scores near 0, which is the
    signal a curator needs.
    """
    base = readings[0]
    scores: list[list[float]] = [[] for _ in base]
    for other in readings[1:]:
        matcher = difflib.SequenceMatcher(
            None, [normalise(x) for x in base], [normalise(x) for x in other]
        )
        matched = {}
        for i, j, size in matcher.get_matching_blocks():
            for k in range(size):
                matched[i + k] = j + k
        for index, line in enumerate(base):
            if index in matched:
                scores[index].append(1.0)
            else:
                # Not an exact line match: score it against the nearest line
                # the other reading offers, so a one-character difference is
                # not counted the same as a line nobody else saw.
                best = max(
                    (difflib.SequenceMatcher(None, normalise(line), normalise(o)).ratio()
                     for o in other),
                    default=0.0,
                )
                scores[index].append(best)
    return [
        (line, round(sum(s) / len(s), 4) if s else 1.0)
        for line, s in zip(base, scores)
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--page", help="one page id, otherwise every handwritten page")
    parser.add_argument("--passes", type=int, default=3, help="independent readings, at least 2")
    args = parser.parse_args()
    if args.passes < 2:
        raise SystemExit("confidence comes from readings disagreeing, so at least 2 passes")

    pages = [p for p in scans("handwritten") if args.page in (None, p["id"])]
    if not pages:
        raise SystemExit("no handwritten pages to read")

    key = api_key()
    premis = Premis(AIP / "premis.jsonl")
    for page in pages:
        data_url = sendable(SCANS / page["file"])
        readings = []
        for i in range(args.passes):
            # The first reading is greedy and is the one kept; the others vary,
            # so agreement between them means something.
            readings.append(lines_of(read_once(key, data_url, 0.0 if i == 0 else 0.4)))
            time.sleep(PAUSE)
        scored = agreement(readings)
        regions = [
            {
                "id": f"l{i:03d}",
                "order": i,
                "label": "Line",
                # A line of a hand has no box: the model returns words, not
                # coordinates. The station shows these against the whole page.
                "polygon": None,
                "text": line,
                "confidence": score,
            }
            for i, (line, score) in enumerate(scored)
        ]
        payload = {
            "pageId": page["id"],
            "pipeline": PIPELINE,
            "model": f"groq {MODEL}",
            "kind": "handwritten",
            "language": page["language"],
            "script": page["script"],
            "ranAt": now(),
            "imageSha256": page["sha256"],
            "passes": args.passes,
            "confidenceIs": "agreement between independent readings, not the model's own estimate",
            "regions": regions,
        }
        path = write_result(page["id"], payload)
        mean = sum(r["confidence"] for r in regions) / len(regions) if regions else 0.0
        low = sum(1 for r in regions if r["confidence"] < 0.9)
        premis.event(
            "creation", "success",
            f"{page['id']}: OCR by {MODEL} over {args.passes} readings, "
            f"{len(regions)} lines, mean agreement {mean:.3f}",
            objects=[f"manuscripts/{page['sourceId']}/original.png"],
            agent=f"groq {MODEL}",
        )
        print(f"  {page['id']:<28} {len(regions):>3} lines  mean agreement {mean:.3f}  "
              f"under 0.9: {low}  -> {path.name}")

    print(f"handwriting OCR: {len(pages)} page(s), {args.passes} readings each")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
