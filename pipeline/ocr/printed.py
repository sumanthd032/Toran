"""
OCR pipeline A: printed pages, Devanagari and English, with Surya. D-012.

Run:  pipeline/.venv/bin/python pipeline/ocr/printed.py [--page ID]

Surya is built for document OCR and its own documentation says it does not
work on handwriting, which is why handwriting.py exists and why this script
refuses a page the archive records as a hand.

Every line and every word keeps the confidence Surya reports, the model's own
probability for what it produced. That number is shown to a visitor as heat on
the transcription rather than hidden, so a reader can see where the machine was
unsure. It is a model's estimate of itself and it is not calibrated: a high
confidence is not a promise. accuracy.py measures what it is worth.

Surya is pinned to 0.17.x. From 0.20 it runs its model through llama.cpp or
vLLM, neither of which is on this machine, and it stopped returning per-word
confidence, which the heat needs. D-113.

The first run downloads model weights, a few GB, into the Hugging Face cache.
Nothing of that ships to a kiosk. Only this script's output does.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ocr.common import SCANS, scans, text_of, write_result
from oais.packages import Premis, now

AIP = Path(__file__).resolve().parent.parent.parent / "data" / "aip"
PIPELINE = "surya"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--page", help="one page id, otherwise every printed page")
    args = parser.parse_args()

    pages = [p for p in scans("printed") if args.page in (None, p["id"])]
    if not pages:
        raise SystemExit("no printed pages to read")

    import importlib.metadata as md

    from PIL import Image
    from surya.detection import DetectionPredictor
    from surya.foundation import FoundationPredictor
    from surya.recognition import RecognitionPredictor

    version = md.version("surya-ocr")
    if not version.startswith("0.17."):
        raise SystemExit(f"this script is written against surya-ocr 0.17.x, found {version}")
    print(f"surya {version}, loading the model onto the CPU")
    recogniser = RecognitionPredictor(FoundationPredictor())
    detector = DetectionPredictor()

    premis = Premis(AIP / "premis.jsonl")
    images = [Image.open(SCANS / p["file"]).convert("RGB") for p in pages]
    start = time.time()
    results = recogniser(images, det_predictor=detector, math_mode=False, return_words=True)
    seconds = time.time() - start

    for page, result in zip(pages, results):
        regions = []
        for line in result.text_lines:
            text = text_of(line.text)
            if not text:
                continue
            regions.append({
                "id": f"l{len(regions):03d}",
                "order": len(regions),
                "label": "Line",
                "polygon": [[round(x, 1), round(y, 1)] for x, y in line.polygon],
                "text": text,
                # Surya's own estimate for the line. Not calibrated.
                "confidence": round(line.confidence or 0.0, 4),
                # Where the heat goes: one score a word, so a reader sees the
                # word the machine doubted, not the paragraph around it.
                "words": [
                    {
                        "text": word.text,
                        "confidence": round(word.confidence or 0.0, 4),
                        "polygon": [[round(x, 1), round(y, 1)] for x, y in word.polygon],
                    }
                    for word in (line.words or [])
                    if word.text.strip()
                ],
            })
        payload = {
            "pageId": page["id"],
            "pipeline": PIPELINE,
            "model": f"surya-ocr {version}",
            "kind": "printed",
            "language": page["language"],
            "script": page["script"],
            "ranAt": now(),
            "imageSha256": page["sha256"],
            "regions": regions,
        }
        path = write_result(page["id"], payload)
        scored = [r["confidence"] for r in regions if r["confidence"] is not None]
        mean = sum(scored) / len(scored) if scored else 0.0
        low = sum(1 for c in scored if c < 0.9)
        premis.event(
            "creation", "success",
            f"{page['id']}: OCR by surya-ocr {version}, {len(regions)} regions, "
            f"mean confidence {mean:.3f}",
            objects=[f"manuscripts/{page['sourceId']}/original.pdf"],
            agent=f"surya-ocr {version}",
        )
        chars = sum(len(r["text"]) for r in regions)
        print(f"  {page['id']:<28} {len(regions):>3} regions  {chars:>5} chars  "
              f"mean {mean:.3f}  under 0.9: {low}  -> {path.name}")

    print(f"printed OCR: {len(pages)} page(s) in {seconds:.1f}s on CPU")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
