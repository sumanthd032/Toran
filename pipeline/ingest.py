"""
Toran ingest. SIP to AIP to DIP.

Run:  python3 pipeline/ingest.py [--refetch]

Reads pipeline/sources.json, fetches what is listed, and writes three package
types under data/. The AIP is the authority; the DIP is derived and can be
deleted and rebuilt at any time.

Nothing is ingested that is not in the manifest, and every object carries the
digest it had on arrival.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from oais.packages import Premis, dublin_core, now, sha256_file, sha256_text, verify_fixity, write_json
from parse import cad as cad_parser
from parse import constitution as coi_parser
from parse.blocks import body_text, page_blocks, vocabulary
from parse.pdf_pages import parse as parse_pdf

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SIP, AIP, DIP = DATA / "sip", DATA / "aip", DATA / "dip"

UA = "toran-pipeline/0.1 (SIH26096 research project)"

# Retrieval chunks never cross a page or a paragraph, because the unit they
# cross is the unit a reader is sent to. A chunk that spans two pages cannot
# be cited to either.
CHUNK_TARGET = 900
CHUNK_MIN = 220


def fetch(url: str, dest: Path, refetch: bool) -> bool:
    """Returns True if the file was downloaded rather than already present."""
    if dest.exists() and not refetch:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as response:
        dest.write_bytes(response.read())
    return True


def split_text(text: str) -> list[str]:
    """Split one page or paragraph into retrieval chunks on sentence bounds."""
    body = re.sub(r"\s+", " ", text).strip()
    if len(body) <= CHUNK_TARGET:
        return [body] if len(body) >= CHUNK_MIN else ([body] if body else [])

    sentences = re.split(r"(?<=[.!?”])\s+", body)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if current and len(current) + 1 + len(sentence) > CHUNK_TARGET:
            chunks.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        # Fold a stub tail into the previous chunk rather than emitting it.
        if chunks and len(current) < CHUNK_MIN:
            chunks[-1] = f"{chunks[-1]} {current}"
        else:
            chunks.append(current)
    return chunks


def ingest_pdf_source(source: dict, refetch: bool, premis: Premis) -> dict:
    sid = source["id"]
    sip_dir = SIP / sid
    original = sip_dir / "original.pdf"

    downloaded = fetch(source["url"], original, refetch)
    digest = sha256_file(original)
    premis.event(
        "ingestion" if downloaded else "validation",
        "success",
        f"{'retrieved' if downloaded else 'already present'} {source['url']}",
        objects=[f"{sid}/original.pdf"],
    )
    premis.event("message digest calculation", "success", f"sha256 {digest}", objects=[f"{sid}/original.pdf"])

    write_json(sip_dir / "submission.json", {
        "sourceId": sid,
        "url": source["url"],
        "retrieved": now(),
        "sha256": digest,
        "bytes": original.stat().st_size,
        "format": source["format"],
        "rights": source["rights"],
        "rightsVerified": source["rights_verified"],
    })

    pages = parse_pdf(original)
    premis.event(
        "normalization", "success",
        f"extracted {len(pages)} pages with pdftotext -layout",
        objects=[f"{sid}/original.pdf"],
    )

    # Words the typesetter broke across lines are rejoined against the words
    # this volume prints whole. See parse/blocks.py.
    known = vocabulary(p.text for p in pages)

    aip_dir = AIP / sid
    records = []
    chunks = []
    reading = []
    observed = 0
    for page in pages:
        if page.printed is None or page.chars == 0:
            continue
        if page.observed:
            observed += 1
        page_id = f"{sid}-p{page.pdf_index:04d}"
        records.append({
            "pageId": page_id,
            "pdfIndex": page.pdf_index,
            "printed": page.printed,
            "numbering": page.numbering,
            "observed": page.observed,
            "chars": page.chars,
            "head": page.head,
            "sha256": sha256_text(page.text),
        })
        if page.numbering != "arabic":
            continue  # front matter is kept but not indexed for retrieval
        locator = {
            "kind": "page",
            "volume": source["volume"],
            "part": source["part"],
            "page": int(page.printed),
            "observed": page.observed,
        }
        blocks = page_blocks(page.text, known)
        reading.append({
            "pageId": page_id,
            "workId": sid,
            "corpus": source["corpus"],
            "locator": locator,
            "language": source["language"],
            "head": page.head,
            "blocks": [b.to_json() for b in blocks],
        })
        # Chunks are cut from the same text the reading view sets, so a search
        # hit can always be found again on its page.
        for n, body in enumerate(split_text(body_text(blocks))):
            chunks.append({
                "chunkId": f"{page_id}-c{n:02d}",
                "pageId": page_id,
                "workId": sid,
                "corpus": source["corpus"],
                "locator": locator,
                "language": source["language"],
                "speaker": None,
                "text": body,
            })

    write_json(aip_dir / "pages.json", records)
    write_json(aip_dir / "dublin-core.json", dublin_core(
        title=source["title"],
        creator=source["creator"],
        publisher=source["publisher"],
        language=source["language"],
        type="Text",
        format=source["format"],
        identifier=sid,
        source=source["url"],
        rights=source["rights"],
        relation=source.get("contains"),
    ))
    (aip_dir / "pages").mkdir(parents=True, exist_ok=True)
    for page in pages:
        if page.printed is None or page.chars == 0:
            continue
        (aip_dir / "pages" / f"{sid}-p{page.pdf_index:04d}.txt").write_text(page.text, encoding="utf-8")

    premis.event("validation", "success",
                 f"{observed} of {len(records)} page numbers read from the page, the rest inferred",
                 objects=[sid])

    return {"id": sid, "pages": len(records), "observedPages": observed,
            "chunks": chunks, "reading": {"pages": reading}, "sha256": digest}


def ingest_cad_source(source: dict, refetch: bool, premis: Premis) -> dict:
    sid = source["id"]
    sip_dir = SIP / sid
    all_chunks = []
    records = []
    sittings: dict[int, dict] = {}
    digests = {}

    for date in source["sittings"]:
        day, month, year = date.split("-")[2], date.split("-")[1], date.split("-")[0]
        months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]
        slug = f"{day}-{months[int(month)-1]}-{year}"
        url = f"https://www.constitutionofindia.net/debates/{slug}/"
        dest = sip_dir / f"{date}.html"

        downloaded = fetch(url, dest, refetch)
        digest = sha256_file(dest)
        digests[f"{sid}/{date}.html"] = digest
        premis.event("ingestion" if downloaded else "validation", "success",
                     f"{'retrieved' if downloaded else 'already present'} {url}",
                     objects=[f"{sid}/{date}.html"])
        premis.event("message digest calculation", "success", f"sha256 {digest}",
                     objects=[f"{sid}/{date}.html"])

        html_source = dest.read_text(encoding="utf-8", errors="replace")
        paragraphs = cad_parser.parse(html_source, expect_volume=source["volume"])
        premis.event("normalization", "success",
                     f"extracted {len(paragraphs)} records for sitting {date}",
                     objects=[f"{sid}/{date}.html"])

        for p in paragraphs:
            suffix = "plus" if p.procedural else "para"
            rec_id = f"{sid}-{p.sitting}-{p.paragraph}-{suffix}-{p.anchor}"
            records.append({
                "pageId": rec_id,
                "sitting": p.sitting,
                "paragraph": p.paragraph,
                "procedural": p.procedural,
                "speaker": p.speaker,
                "date": date,
                "chars": p.chars,
                "sha256": sha256_text(p.text),
            })
            sitting = sittings.setdefault(p.sitting, {
                "id": f"{sid}-{p.sitting}",
                "workId": sid,
                "corpus": source["corpus"],
                "volume": p.volume,
                "sitting": p.sitting,
                "date": date,
                "language": source["language"],
                "paragraphs": [],
            })
            sitting["paragraphs"].append({
                "pageId": rec_id,
                "paragraph": p.paragraph,
                "procedural": p.procedural,
                "speaker": p.speaker,
                "text": p.text,
            })
            for n, body in enumerate(split_text(p.text)):
                all_chunks.append({
                    "chunkId": f"{rec_id}-c{n:02d}",
                    "pageId": rec_id,
                    "workId": sid,
                    "corpus": source["corpus"],
                    "locator": {
                        "kind": "paragraph",
                        "volume": p.volume,
                        "sitting": p.sitting,
                        "paragraph": p.paragraph,
                        "date": date,
                        "procedural": p.procedural,
                    },
                    "language": source["language"],
                    "speaker": p.speaker,
                    "text": body,
                })

    write_json(sip_dir / "submission.json", {
        "sourceId": sid, "url": source["url"], "retrieved": now(),
        "sittings": source["sittings"], "sha256": digests,
        "format": source["format"], "rights": source["rights"],
        "rightsVerified": source["rights_verified"],
    })

    aip_dir = AIP / sid
    write_json(aip_dir / "records.json", records)
    write_json(aip_dir / "dublin-core.json", dublin_core(
        title=source["title"], creator=source["creator"], publisher=source["publisher"],
        language=source["language"], type="Text", format=source["format"],
        identifier=sid, source=source["url"], rights=source["rights"],
        coverage=", ".join(source["sittings"]),
    ))
    return {"id": sid, "pages": len(records), "observedPages": len(records),
            "chunks": all_chunks, "reading": {"sittings": list(sittings.values())},
            "sha256": digests}


def ingest_constitution_source(source: dict, refetch: bool, premis: Premis) -> dict:
    sid = source["id"]
    sip_dir = SIP / sid
    dest = sip_dir / "article.html"

    downloaded = fetch(source["url"], dest, refetch)
    digest = sha256_file(dest)
    premis.event("ingestion" if downloaded else "validation", "success",
                 f"{'retrieved' if downloaded else 'already present'} {source['url']}",
                 objects=[f"{sid}/article.html"])
    premis.event("message digest calculation", "success", f"sha256 {digest}",
                 objects=[f"{sid}/article.html"])

    article = coi_parser.parse(dest.read_text(encoding="utf-8", errors="replace"))
    if article is None:
        premis.event("normalization", "failure", "article page did not parse", objects=[sid])
        raise SystemExit(f"{sid}: article page did not parse")

    premis.event("normalization", "success",
                 f"article {article.article} with {len(article.versions)} recorded versions",
                 objects=[sid])

    aip_dir = AIP / sid
    write_json(aip_dir / "article.json", article.to_json())
    write_json(aip_dir / "dublin-core.json", dublin_core(
        title=source["title"], creator=source["creator"], publisher=source["publisher"],
        language=source["language"], type="Text", format=source["format"],
        identifier=sid, source=source["url"], rights=source["rights"],
        coverage=f"Part {source['part']}",
        relation=[v.label for v in article.versions] or None,
    ))

    # The drafting history is an assertion the source makes. It is recorded
    # with its origin so step 7 can show a reader where it came from.
    write_json(aip_dir / "drafting-history.json", {
        "article": article.article,
        "debatedOn": article.debated_on,
        "versions": [
            {"ordinal": v.ordinal, "article": v.article, "document": v.document,
             "year": v.year, "label": v.label}
            for v in article.versions
        ],
        "assertedBy": source["url"],
    })

    chunks = []
    rec_id = f"{sid}-a{article.article}"
    for n, body in enumerate(split_text(article.text)):
        chunks.append({
            "chunkId": f"{rec_id}-c{n:02d}", "pageId": rec_id, "workId": sid,
            "corpus": source["corpus"],
            "locator": {"kind": "article", "article": article.article},
            "language": source["language"], "speaker": None, "text": body,
        })
    reading = {
        "pageId": rec_id, "workId": sid, "corpus": source["corpus"],
        "article": article.article, "heading": article.heading,
        "language": source["language"], "text": article.text,
    }
    return {"id": sid, "pages": 1, "observedPages": 1, "chunks": chunks,
            "reading": {"articles": [reading]}, "sha256": digest}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refetch", action="store_true", help="download even if present")
    args = ap.parse_args()

    manifest = json.loads((ROOT / "pipeline" / "sources.json").read_text(encoding="utf-8"))
    premis = Premis(AIP / "premis.jsonl")
    premis.event("ingestion start", "success", f"{len(manifest['sources'])} sources in manifest")

    summaries = []
    all_chunks = []
    reading: dict[str, list] = {"pages": [], "sittings": [], "articles": []}
    for source in manifest["sources"]:
        print(f"  {source['id']} ...", flush=True)
        if source["format"] == "application/pdf":
            summary = ingest_pdf_source(source, args.refetch, premis)
        elif source["corpus"] == "constitution":
            summary = ingest_constitution_source(source, args.refetch, premis)
        else:
            summary = ingest_cad_source(source, args.refetch, premis)
        all_chunks.extend(summary.pop("chunks"))
        for kind, items in summary.pop("reading").items():
            reading[kind].extend(items)
        summaries.append(summary)
        print(f"    {summary['pages']} records, {summary['observedPages']} observed")

    # DIP. Derived, rebuildable, never the thing being preserved.
    DIP.mkdir(parents=True, exist_ok=True)
    with (DIP / "chunks.jsonl").open("w", encoding="utf-8") as fh:
        for chunk in all_chunks:
            fh.write(json.dumps(chunk, ensure_ascii=False) + "\n")
    write_json(DIP / "works.json", [
        {k: v for k, v in s.items() if k != "sha256"}
        | {"title": src["title"], "corpus": src["corpus"],
           "volume": src.get("volume"), "part": src.get("part")}
        for s, src in zip(summaries, manifest["sources"])
    ])
    # The reading copy: pages with their structure, whole sittings, articles.
    for kind, items in reading.items():
        with (DIP / f"{kind}.jsonl").open("w", encoding="utf-8") as fh:
            for item in items:
                fh.write(json.dumps(item, ensure_ascii=False) + "\n")
    premis.event("dissemination", "success",
                 f"built {len(all_chunks)} retrieval chunks and a reading copy of "
                 f"{len(reading['pages'])} pages, {len(reading['sittings'])} sittings, "
                 f"{len(reading['articles'])} articles")

    # Fixity manifest over the submission packages.
    fixity = {}
    for path in sorted(SIP.rglob("*")):
        if path.is_file() and path.name != "submission.json":
            fixity[str(path.relative_to(SIP))] = sha256_file(path)
    write_json(DATA / "fixity.json", fixity)
    premis.event("fixity check", "success", f"{len(fixity)} objects digested")

    print(f"\nchunks: {len(all_chunks)}")
    print(f"fixity: {len(fixity)} objects")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
