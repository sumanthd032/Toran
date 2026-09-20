"""
Ingest verification.

The claim a citation makes is that a reader can open the source at that
locator and find the text. This checks that claim against the original files
rather than against our own derived records, because checking derived data
against derived data proves nothing.
"""

from __future__ import annotations

import json
import random
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from oais.packages import DC_ELEMENTS, sha256_file
from parse import statute
from parse.pdf_pages import strip_slug_lines

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

failures = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global failures
    if not ok:
        failures += 1
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{('  ' + detail) if detail else ''}")


def normalise(s: str) -> str:
    """
    Letters and figures only. Stored text rejoins words the typesetter broke
    across lines, so "Untouch-" and "ables" in the PDF are "Untouchables" in
    the archive; without spacing and punctuation the two compare equal.
    """
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def pdf_page_text(pdf: Path, index: int, strip_slugs: bool = True) -> str:
    """
    Text of one page of the original.

    Slug lines are removed by default so the comparison is like for like:
    the archive stores the page without the typesetter's production residue,
    and that residue sits between lines of real text, so leaving it in would
    make contiguous stored text look absent from the source.
    """
    out = subprocess.run(
        ["pdftotext", "-layout", "-f", str(index), "-l", str(index), str(pdf), "-"],
        capture_output=True, text=True, check=True,
    )
    return strip_slug_lines(out.stdout) if strip_slugs else out.stdout


def main() -> int:
    print("Toran ingest verification\n")

    chunks = [json.loads(l) for l in (DATA / "dip" / "chunks.jsonl").read_text(encoding="utf-8").splitlines()]
    check("chunks present", len(chunks) > 0, f"{len(chunks)} chunks")

    # --- every chunk carries a resolvable locator ---
    bad = []
    for c in chunks:
        loc = c.get("locator", {})
        kind = loc.get("kind")
        if kind == "page":
            if not isinstance(loc.get("page"), int) or loc["page"] < 1:
                bad.append(c["chunkId"])
        elif kind == "paragraph":
            if not all(isinstance(loc.get(k), int) and loc[k] >= 1 for k in ("volume", "sitting", "paragraph")):
                bad.append(c["chunkId"])
        elif kind == "article":
            if not re.fullmatch(r"\d{1,3}[A-Z]?", str(loc.get("article", ""))):
                bad.append(c["chunkId"])
        elif kind == "plate":
            if loc.get("plate") not in ("frontispiece",):
                bad.append(c["chunkId"])
        elif kind == "section":
            if not (loc.get("act") and isinstance(loc.get("year"), int)
                    and re.fullmatch(r"title|\d{1,3}[A-Z]{0,2}", str(loc.get("section", "")))):
                bad.append(c["chunkId"])
        else:
            bad.append(c["chunkId"])
    check("every chunk has a resolvable locator", not bad, f"{len(bad)} bad")

    # --- no chunk is empty or absurdly long ---
    empty = [c["chunkId"] for c in chunks if len(c["text"].strip()) == 0]
    check("no empty chunks", not empty, f"{len(empty)} empty")

    # --- the real test: a sample resolves to its page in the source PDF ---
    random.seed(17)
    page_chunks = [c for c in chunks if c["locator"]["kind"] == "page"]
    sample = random.sample(page_chunks, min(25, len(page_chunks)))
    resolved = 0
    misses = []
    for c in sample:
        work = c["workId"]
        pdf = DATA / "sip" / work / "original.pdf"
        pages = json.loads((DATA / "aip" / work / "pages.json").read_text(encoding="utf-8"))
        rec = next((p for p in pages if p["pageId"] == c["pageId"]), None)
        if rec is None:
            misses.append(f"{c['chunkId']} no page record")
            continue
        actual = normalise(pdf_page_text(pdf, rec["pdfIndex"]))
        probe = normalise(c["text"])[:90]
        if probe and probe in actual:
            resolved += 1
        else:
            misses.append(f"{c['chunkId']} printed p{c['locator']['page']}")
    check("sampled chunks resolve to their source page", resolved == len(sample),
          f"{resolved}/{len(sample)}" + ("  " + "; ".join(misses[:3]) if misses else ""))

    # --- every chunk can be found again in the reading copy of its page ---
    # The reading view highlights a search hit on its page, which needs the
    # hit's text to be in the page's text exactly, not approximately.
    pages = {p["pageId"]: p for p in map(json.loads, (DATA / "dip" / "pages.jsonl").read_text(encoding="utf-8").splitlines())}
    paragraphs = {
        para["pageId"]: para["text"]
        for line in (DATA / "dip" / "sittings.jsonl").read_text(encoding="utf-8").splitlines()
        for para in json.loads(line)["paragraphs"]
    }
    articles = {a["pageId"]: a["text"] for a in map(json.loads, (DATA / "dip" / "articles.jsonl").read_text(encoding="utf-8").splitlines())}
    acts = [json.loads(l) for l in (DATA / "dip" / "acts.jsonl").read_text(encoding="utf-8").splitlines()]
    articles |= {a["pageId"]: a["text"] for a in acts}
    lost = []
    for c in chunks:
        page = pages.get(c["pageId"])
        if page is not None:
            body = " ".join(b["text"] for b in page["blocks"])
        else:
            body = paragraphs.get(c["pageId"]) or articles.get(c["pageId"])
        if body is None or re.sub(r"\s+", " ", c["text"]) not in re.sub(r"\s+", " ", body):
            lost.append(c["chunkId"])
    check("every chunk is found verbatim in its page's reading copy", not lost,
          f"{len(chunks) - len(lost)}/{len(chunks)}" + ("  " + "; ".join(lost[:3]) if lost else ""))

    # --- every section of an Act is in the Act as published ---
    # The published text with its footnote lines dropped, and nothing else
    # changed, must hold each section whole and in order. Compared on letters
    # and figures, as above.
    missing = []
    for work in sorted({a["workId"] for a in acts}):
        layout = statute.read_layout(DATA / "sip" / work / "original.pdf")
        whole = normalise(" ".join(statute.without_history(layout)))
        for a in (x for x in acts if x["workId"] == work):
            if normalise(a["text"]) not in whole:
                missing.append(a["pageId"])
    check("every section of an Act is found in the Act as published", not missing,
          f"{len(acts) - len(missing)}/{len(acts)}" + ("  " + "; ".join(missing[:3]) if missing else ""))

    # --- printed page number agrees with the running head on that page ---
    checked = 0
    agreed = 0
    for c in sample:
        work = c["workId"]
        pages = json.loads((DATA / "aip" / work / "pages.json").read_text(encoding="utf-8"))
        rec = next((p for p in pages if p["pageId"] == c["pageId"]), None)
        if rec is None or not rec["observed"]:
            continue
        checked += 1
        text = pdf_page_text(DATA / "sip" / work / "original.pdf", rec["pdfIndex"])
        head = next((l.strip() for l in text.split("\n") if l.strip()), "")
        if rec["printed"] in head:
            agreed += 1
    check("observed page numbers appear in the running head", checked == agreed,
          f"{agreed}/{checked} observed pages checked")

    # --- drafting history, which seeds the provenance graph in step 7 ---
    histories = sorted((DATA / "aip").glob("*/drafting-history.json"))
    linked = 0
    for f in histories:
        h = json.loads(f.read_text(encoding="utf-8"))
        versions = h.get("versions", [])
        has_draft = any(v.get("year") and v["year"] < 1950 for v in versions)
        has_final = any(v.get("year") == 1950 for v in versions)
        if has_draft and has_final and h.get("debatedOn") and h.get("assertedBy"):
            linked += 1
    check("drafting history links draft to ratified article", linked == len(histories),
          f"{linked}/{len(histories)} with a draft, a 1950 text, a debate date and a source")

    # --- fixity verifies on a second pass ---
    fixity = json.loads((DATA / "fixity.json").read_text(encoding="utf-8"))
    changed = [rel for rel, digest in fixity.items() if sha256_file(DATA / "sip" / rel) != digest]
    check("fixity verifies on re-read", not changed, f"{len(fixity)} objects, {len(changed)} changed")

    # --- Dublin Core records use only the fifteen elements ---
    dc_files = sorted((DATA / "aip").glob("*/dublin-core.json"))
    offenders = []
    for f in dc_files:
        record = json.loads(f.read_text(encoding="utf-8"))
        extra = set(record) - set(DC_ELEMENTS)
        if extra:
            offenders.append(f"{f.parent.name}: {sorted(extra)}")
        if not record.get("title") or not record.get("identifier"):
            offenders.append(f"{f.parent.name}: missing title or identifier")
    check("Dublin Core records validate", not offenders,
          f"{len(dc_files)} records" + ("  " + "; ".join(offenders) if offenders else ""))

    # --- PREMIS log is append-only JSONL with the required fields ---
    premis_path = DATA / "aip" / "premis.jsonl"
    events = [json.loads(l) for l in premis_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    required = {"eventType", "eventDateTime", "eventOutcome", "linkingAgentIdentifier"}
    malformed = [i for i, e in enumerate(events) if not required.issubset(e)]
    check("PREMIS events well formed", not malformed, f"{len(events)} events")

    # --- measured counts, not estimates ---
    works = json.loads((DATA / "dip" / "works.json").read_text(encoding="utf-8"))
    print("\n  measured:")
    total_pages = 0
    for w in works:
        total_pages += w["pages"]
        pct = w["observedPages"] / w["pages"] * 100 if w["pages"] else 0
        print(f"    {w['id']:10} {w['pages']:5} records  {w['observedPages']:5} observed ({pct:.0f}%)  {w['title'][:46]}")
    print(f"    {'total':10} {total_pages:5} records  {len(chunks):5} chunks")
    broken = sum(len(re.findall(r"\b[A-Za-z]{2,}- [a-z]{2,}\b", c["text"])) for c in chunks)
    print(f"    broken words left in chunk text: {broken}, from columns the layout interleaves")

    print(f"\n{'All checks passed.' if failures == 0 else f'{failures} check(s) FAILED.'}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
