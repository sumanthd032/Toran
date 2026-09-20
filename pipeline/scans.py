"""
Scanned pages for the Manuscript Station. SIP to AIP to DIP, as ingest.py does
for text and photos.py does for photographs.

Run:  python3 pipeline/scans.py [--refetch]

Reads pipeline/manuscripts.json. A master is fetched from Wikimedia Commons or
from the Internet Archive and is kept only if its bytes hash to the SHA-1 that
repository publishes, so what arrived is provably what they hold. Pages are
then rendered from the master at a stated resolution and written to the DIP.

The render is a derivative and says so. The master in the SIP is the thing
being preserved, and every render can be made again from it.

What a repository records about a scan (its date, its rights, where it came
from) is copied as recorded and labelled as such downstream, exactly as
photos.py does. None of it is independently confirmed here.

Requires poppler (pdftoppm) and ImageMagick (magick).
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from oais.packages import Premis, dublin_core, now, sha256_file, write_fixity, write_json

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SIP, AIP, DIP = DATA / "sip", DATA / "aip", DATA / "dip"
COMMONS = "https://commons.wikimedia.org/w/api.php"
IA_META = "https://archive.org/metadata"
IA_FILE = "https://archive.org/download"
UA = "toran-pipeline/0.1 (SIH26096 research project)"
PUBLIC_DOMAIN = re.compile(r"^(public domain|pd\b|edictgov)", re.I)


def get(url: str) -> bytes:
    """Fetch politely. Both repositories answer a quick run of downloads with 429."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=600) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code not in (429, 503) or attempt == 5:
                raise
            wait = error.headers.get("Retry-After")
            time.sleep(int(wait) if wait and wait.isdigit() else 5 * 2**attempt)
    raise AssertionError("unreachable")


def plain(value: str | None) -> str | None:
    """Repository metadata is HTML. Keep the words, drop the markup."""
    if not value:
        return None
    text = re.sub(r"<[^>]+>", " ", value)
    text = re.sub(r"date QS:\S+", " ", html.unescape(text))
    return re.sub(r"\s+", " ", text).strip() or None


def commons_file(title: str) -> dict:
    query = urllib.parse.urlencode({
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "prop": "imageinfo",
        "iiprop": "url|sha1|size|mime|extmetadata",
        "titles": f"File:{title}",
    })
    page = json.loads(get(f"{COMMONS}?{query}"))["query"]["pages"][0]
    if page.get("missing") or not page.get("imageinfo"):
        raise SystemExit(f"not on Commons: {title}")
    info = page["imageinfo"][0]
    meta = {k: v.get("value") for k, v in info.get("extmetadata", {}).items()}
    licence = plain(meta.get("LicenseShortName")) or ""
    if not PUBLIC_DOMAIN.search(licence) and meta.get("License") != "pd":
        raise SystemExit(f"{title}: Commons records the licence as '{licence}', not public domain")
    return {
        "url": info["url"],
        "page": info["descriptionurl"],
        "sha1": info["sha1"],
        "mime": info["mime"],
        "rights": licence,
        "recorded": {
            "creator": plain(meta.get("Artist")),
            "date": plain(meta.get("DateTimeOriginal")),
            "description": plain(meta.get("ImageDescription")),
            "credit": plain(meta.get("Credit")),
        },
    }


def archive_file(item: str, name: str) -> dict:
    meta = json.loads(get(f"{IA_META}/{item}"))
    entry = next((f for f in meta.get("files", []) if f["name"] == name), None)
    if entry is None:
        raise SystemExit(f"{item}: no file named {name}")
    if "sha1" not in entry:
        raise SystemExit(f"{item}/{name}: the Internet Archive publishes no SHA-1 for it")
    m = meta.get("metadata", {})
    return {
        "url": f"{IA_FILE}/{item}/{urllib.parse.quote(name)}",
        "page": f"https://archive.org/details/{item}",
        "sha1": entry["sha1"],
        "mime": "application/pdf" if name.endswith(".pdf") else entry.get("format", ""),
        "rights": plain(m.get("rights")) or plain(m.get("licenseurl")) or "",
        "recorded": {
            "creator": plain(m.get("creator")),
            "date": plain(str(m.get("date") or m.get("year") or "")),
            "description": plain(m.get("description")),
            "credit": plain(m.get("collection") and f"Internet Archive, {m['collection']}"),
        },
    }


def render_pdf_page(pdf: Path, page: int, dpi: int, dest: Path) -> tuple[int, int]:
    """One page of a PDF as a lossless image, at a stated resolution."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    stem = dest.with_suffix("")
    subprocess.run(
        ["pdftoppm", "-png", "-r", str(dpi), "-f", str(page), "-l", str(page),
         "-singlefile", str(pdf), str(stem)],
        check=True,
    )
    return measure(dest)


def copy_image(source: Path, dest: Path) -> tuple[int, int]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["magick", f"{source}[0]", "-auto-orient", "-colorspace", "sRGB", "-strip", str(dest)],
        check=True,
    )
    return measure(dest)


def measure(path: Path) -> tuple[int, int]:
    size = subprocess.run(
        ["magick", "identify", "-format", "%w %h", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    return int(size[0]), int(size[1])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refetch", action="store_true")
    args = parser.parse_args()

    manifest = json.loads((ROOT / "pipeline" / "manuscripts.json").read_text(encoding="utf-8"))
    premis = Premis(AIP / "premis.jsonl")
    served: list[dict] = []

    for source in manifest["sources"]:
        sid = source["id"]
        if source["kind"] == "commons":
            info = commons_file(source["file"])
        elif source["kind"] == "archive.org":
            info = archive_file(source["item"], source["file"])
        else:
            raise SystemExit(f"{sid}: unknown source kind {source['kind']}")

        sip_dir = SIP / "manuscripts" / sid
        suffix = Path(urllib.parse.urlparse(info["url"]).path).suffix.lower()
        master = sip_dir / f"original{suffix}"
        downloaded = False
        if args.refetch or not master.exists():
            sip_dir.mkdir(parents=True, exist_ok=True)
            master.write_bytes(get(info["url"]))
            downloaded = True
            time.sleep(2)
        sha1 = hashlib.sha1(master.read_bytes()).hexdigest()
        if sha1 != info["sha1"]:
            raise SystemExit(f"{sid}: SHA-1 {sha1} is not the {info['sha1']} the repository publishes")
        rel = str(master.relative_to(SIP))
        premis.event(
            "ingestion" if downloaded else "validation", "success",
            f"{'retrieved' if downloaded else 'already present'} {info['url']}", objects=[rel],
        )
        premis.event("fixity check", "success", f"sha1 {sha1} matches the repository", objects=[rel])

        write_json(sip_dir / "submission.json", {
            "sourceId": f"manuscripts/{sid}",
            "url": info["url"],
            "page": info["page"],
            "retrieved": now(),
            "sha1": sha1,
            "sha256": sha256_file(master),
            "bytes": master.stat().st_size,
            "format": info["mime"],
            "rights": source.get("rights") or info["rights"],
            "rightsVerified": "as recorded by the repository, not independently confirmed",
            "recorded": info["recorded"],
        })
        write_json(AIP / "manuscripts" / sid / "dublin-core.json", dublin_core(
            title=source["title"],
            creator=source.get("creator") or info["recorded"]["creator"],
            date=source.get("date") or info["recorded"]["date"],
            description=source.get("note") or info["recorded"]["description"],
            type="StillImage",
            format=info["mime"],
            identifier=info["page"],
            source=source.get("credit") or info["recorded"]["credit"],
            rights=source.get("rights") or info["rights"],
        ))

        dpi = source.get("dpi", 300)
        for page in source["pages"]:
            dest = DIP / "scans" / f"{page['id']}.png"
            if suffix == ".pdf":
                width, height = render_pdf_page(master, page["pdfPage"], dpi, dest)
                how = f"page {page['pdfPage']} rendered at {dpi} dpi"
            else:
                width, height = copy_image(master, dest)
                how = "the master image, unscaled"
            premis.event("creation", "success", f"{page['id']}: {how}, {width}x{height} PNG",
                         objects=[rel])
            served.append({
                "id": page["id"],
                "sourceId": sid,
                # The page's own citation. Every word a machine reads off this
                # page inherits it, so a transcription cannot be shown uncited.
                "corpus": page["corpus"],
                "workId": page["workId"],
                "pageId": page["id"],
                "locator": page["locator"],
                "kind": page["kind"],
                "language": page["language"],
                "script": page["script"],
                "printedPage": page["printedPage"],
                "heading": page["heading"],
                "cites": page["cites"],
                "file": f"{page['id']}.png",
                "width": width,
                "height": height,
                "sha256": sha256_file(dest),
                "master": {
                    "url": info["url"],
                    "page": info["page"],
                    "sha1": sha1,
                    "rendered": how,
                },
                "title": source["title"],
                "rights": source.get("rights") or info["rights"],
                "credit": source.get("credit") or info["recorded"]["credit"],
                "note": source.get("note"),
            })
            print(f"  {page['id']:<28} {width}x{height}  {page['kind']:<11} {page['script']}")

    write_json(DIP / "scans.json", served)
    fixity = write_fixity(SIP, DATA / "fixity.json")
    premis.event("fixity check", "success", f"{len(fixity)} objects digested")
    printed = sum(1 for s in served if s["kind"] == "printed")
    print(f"scans: {len(served)} pages, {printed} printed, {len(served) - printed} handwritten; "
          f"fixity: {len(fixity)} objects")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
