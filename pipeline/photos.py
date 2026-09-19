"""
Photographs for the Timeline Wall. SIP to AIP to DIP, as ingest.py does for text.

Run:  python3 pipeline/photos.py [--refetch]

Reads pipeline/photos.json. A Commons file is fetched only if Commons records
it as public domain, and it is kept only if its bytes hash to the SHA-1 that
Commons publishes for it, so what arrived is provably what Commons holds. A
plate is rendered from a volume already in the SIP and keeps that volume's
citation.

What Commons records about a photograph (its date, its author, where it came
from) is copied as recorded and labelled as such downstream. Much of it is
thin: several files give their source as "Via Internet". It is shown, not
improved on.

Requires ImageMagick (magick) and poppler (pdfimages) for the web copies.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import subprocess
import sys
import tempfile
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
API = "https://commons.wikimedia.org/w/api.php"
UA = "toran-pipeline/0.1 (SIH26096 research project)"

# The long edge of a web copy. The wall is 2.8 m across and a photograph takes
# at most a third of it, so 1600 px is more than the panel can show.
LONG_EDGE = 1600
PUBLIC_DOMAIN = re.compile(r"^(public domain|pd\b)", re.I)


def get(url: str) -> bytes:
    """Fetch politely. Commons answers a quick run of downloads with 429."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code not in (429, 503) or attempt == 5:
                raise
            wait = error.headers.get("Retry-After")
            time.sleep(int(wait) if wait and wait.isdigit() else 5 * 2**attempt)
    raise AssertionError("unreachable")


def plain(value: str | None) -> str | None:
    """Commons metadata is HTML. Keep the words, drop the markup."""
    if not value:
        return None
    text = re.sub(r"<[^>]+>", " ", value)
    text = re.sub(r"date QS:\S+", " ", html.unescape(text))
    text = re.sub(r"\s+", " ", text).strip()
    # A template can print the same attribution twice, once per language.
    half = len(text) // 2
    if len(text) % 2 == 1 and text[:half] == text[half + 1:]:
        text = text[:half]
    return text or None


def commons_info(titles: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for i in range(0, len(titles), 20):
        batch = titles[i : i + 20]
        query = urllib.parse.urlencode({
            "action": "query",
            "format": "json",
            "formatversion": "2",
            "prop": "imageinfo",
            "iiprop": "url|sha1|size|mime|extmetadata",
            "titles": "|".join(f"File:{t}" for t in batch),
        })
        reply = json.loads(get(f"{API}?{query}"))
        names = {n["to"]: n["from"] for n in reply["query"].get("normalized", [])}
        for page in reply["query"]["pages"]:
            asked = names.get(page["title"], page["title"]).removeprefix("File:")
            if page.get("missing") or not page.get("imageinfo"):
                raise SystemExit(f"not on Commons: {asked}")
            out[asked] = page["imageinfo"][0]
    return out


def web_copy(source: str, dest: Path) -> tuple[int, int]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "magick", f"{source}[0]", "-auto-orient", "-colorspace", "sRGB",
        "-resize", f"{LONG_EDGE}x{LONG_EDGE}>",
        "-strip", "-quality", "82", "-interlace", "JPEG", str(dest),
    ]
    subprocess.run(args, check=True)
    size = subprocess.run(
        ["magick", "identify", "-format", "%w %h", str(dest)],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    return int(size[0]), int(size[1])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refetch", action="store_true")
    args = parser.parse_args()

    manifest = json.loads((ROOT / "pipeline" / "photos.json").read_text(encoding="utf-8"))
    premis = Premis(AIP / "premis.jsonl")
    served = []

    info = commons_info([p["title"] for p in manifest["commons"]])
    for photo in manifest["commons"]:
        pid, title = photo["id"], photo["title"]
        ii = info[title]
        meta = {k: v.get("value") for k, v in ii.get("extmetadata", {}).items()}
        licence = plain(meta.get("LicenseShortName")) or ""
        if not PUBLIC_DOMAIN.search(licence) and meta.get("License") != "pd":
            raise SystemExit(f"{pid}: Commons records the licence as '{licence}', not public domain")

        sip_dir = SIP / "photos" / pid
        original = sip_dir / f"original{Path(urllib.parse.urlparse(ii['url']).path).suffix.lower()}"
        downloaded = False
        if args.refetch or not original.exists():
            sip_dir.mkdir(parents=True, exist_ok=True)
            original.write_bytes(get(ii["url"]))
            downloaded = True
            time.sleep(2)
        sha1 = hashlib.sha1(original.read_bytes()).hexdigest()
        if sha1 != ii["sha1"]:
            raise SystemExit(f"{pid}: SHA-1 {sha1} is not the {ii['sha1']} Commons publishes")
        rel = str(original.relative_to(SIP))
        premis.event(
            "ingestion" if downloaded else "validation", "success",
            f"{'retrieved' if downloaded else 'already present'} {ii['url']}", objects=[rel],
        )
        premis.event("fixity check", "success", f"sha1 {sha1} matches Commons", objects=[rel])

        recorded = {
            "creator": plain(meta.get("Artist")),
            "date": plain(meta.get("DateTimeOriginal")),
            "description": plain(meta.get("ImageDescription")),
            "credit": plain(meta.get("Credit")),
        }
        write_json(sip_dir / "submission.json", {
            "sourceId": f"photos/{pid}",
            "url": ii["url"],
            "page": ii["descriptionurl"],
            "retrieved": now(),
            "sha1": sha1,
            "sha256": sha256_file(original),
            "bytes": original.stat().st_size,
            "format": ii["mime"],
            "rights": licence,
            "rightsVerified": "as recorded on Wikimedia Commons, not independently confirmed",
            "recorded": recorded,
        })
        write_json(AIP / "photos" / pid / "dublin-core.json", dublin_core(
            title=Path(title).stem,
            creator=recorded["creator"],
            date=recorded["date"],
            description=recorded["description"],
            type="StillImage",
            format=ii["mime"],
            identifier=ii["descriptionurl"],
            source=recorded["credit"],
            rights=licence,
        ))

        width, height = web_copy(str(original), DIP / "photos" / f"{pid}.jpg")
        premis.event("creation", "success", f"access copy {width}x{height} JPEG", objects=[rel])
        served.append({
            "id": pid,
            "kind": "commons",
            "file": f"{pid}.jpg",
            "width": width,
            "height": height,
            "title": Path(title).stem,
            "creator": recorded["creator"],
            "date": recorded["date"],
            "credit": recorded["credit"],
            "licence": licence,
            "page": ii["descriptionurl"],
            "sha1": sha1,
        })
        print(f"  {pid:<20} {width}x{height}  {licence}")

    pages = {}
    with (DIP / "pages.jsonl").open(encoding="utf-8") as fh:
        for line in fh:
            page = json.loads(line)
            pages[page["pageId"]] = page
    for plate in manifest["plates"]:
        page_id = f"{plate['source']}-p{plate['pdf_index']:04d}"
        page = pages.get(page_id)
        if page is None or page["locator"]["kind"] != "plate":
            raise SystemExit(f"{plate['id']}: {page_id} is not a plate in the reading copy; run ingest.py")
        pdf = SIP / plate["source"] / "original.pdf"
        n = str(plate["pdf_index"])
        # The photograph is embedded in the page as one image. Taking it out
        # as stored keeps the typesetter's slug line and the caption, both
        # printed as text around it, out of the picture.
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["pdfimages", "-all", "-f", n, "-l", n, str(pdf), f"{tmp}/plate"], check=True)
            images = sorted(Path(tmp).iterdir())
            if len(images) != 1:
                raise SystemExit(f"{plate['id']}: expected one image on {page_id}, found {len(images)}")
            width, height = web_copy(str(images[0]), DIP / "photos" / f"{plate['id']}.jpg")
        premis.event("creation", "success", f"access copy of the image on {page_id}, {width}x{height} JPEG",
                     objects=[f"{plate['source']}/original.pdf"])
        served.append({
            "id": plate["id"],
            "kind": "plate",
            "file": f"{plate['id']}.jpg",
            "width": width,
            "height": height,
            "workId": page["workId"],
            "pageId": page_id,
        })
        print(f"  {plate['id']:<20} {width}x{height}  plate, {page_id}")

    write_json(DIP / "photos.json", served)
    fixity = write_fixity(SIP, DATA / "fixity.json")
    premis.event("fixity check", "success", f"{len(fixity)} objects digested")
    print(f"photos: {len(served)}, fixity: {len(fixity)} objects")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
