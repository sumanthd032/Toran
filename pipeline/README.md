# pipeline

Corpus acquisition, parsing and OAIS packaging. Python, standard library only.

## Requirements

- Python 3.11 or newer, no packages to install
- `pdftotext` and `pdfimages` from poppler-utils, for PDF text and plate images
- ImageMagick (`magick`), for the web copies of photographs

```
sudo dnf install poppler-utils ImageMagick      # Fedora
sudo apt install poppler-utils imagemagick      # Debian, Ubuntu
```

The text pipeline has no dependencies. OCR does: Surya needs PyTorch, which
publishes no wheels for the Python this machine ships, so it runs in its own
Python 3.13 environment. Build it once:

```
uv python install 3.13
uv venv --python 3.13 pipeline/.venv
uv pip install --python pipeline/.venv --torch-backend=cpu surya-ocr==0.17.1 "transformers>=4.56.1,<5"
```

1.1 GB, gitignored, and nothing in it ships to a kiosk. The first OCR run
downloads a 1.34 GB model from models.datalab.to. See DECISIONS.md D-113 for
why the versions are pinned.

The handwriting pipeline needs no environment, only `GROQ_API_KEY` in
`.env.local`. A free key, no card, is at https://console.groq.com/keys.

## Run

```
python3 pipeline/ingest.py            # fetch, parse, package
python3 pipeline/ingest.py --refetch  # re-download even if present
python3 pipeline/photos.py            # photographs for the Timeline Wall
python3 pipeline/scans.py             # scanned pages for the Manuscript Station
python3 pipeline/verify.py            # check the result against the originals
```

OCR is separate from `ingest.py` because one half needs a 1.1 GB environment
and the other needs an API key, and neither should stand between a fresh
clone and a working archive:

```
pipeline/.venv/bin/python pipeline/ocr/printed.py      # Surya, printed pages
python3 pipeline/ocr/handwriting.py                    # a vision model, hands
python3 pipeline/ocr/accuracy.py                       # what each one is worth
```

Both are idempotent. `ingest.py` does not re-download a file it already has,
and re-running it produces the same digests.

## Modules

| Path | Does |
| --- | --- |
| `sources.json` | the ingest manifest. Nothing is ingested that is not listed here |
| `fetch/` | retrieval, reserved for step 8 when sources multiply |
| `parse/pdf_pages.py` | per page text, and the printed page number where it can be read |
| `parse/cad.py` | debate paragraphs, speakers and procedural records |
| `parse/statute.py` | sections of an Act of Parliament |
| `scans.py` | scanned page masters and the page images rendered from them |
| `ocr/printed.py` | Surya over printed pages, with a confidence per word |
| `ocr/handwriting.py` | a vision model over manuscript hands, several readings |
| `ocr/accuracy.py` | character and word error against the held-out set |
| `oais/packages.py` | SIP/AIP/DIP, fixity, PREMIS events, Dublin Core |
| `ingest.py` | orchestrates the three stages |
| `photos.json`, `photos.py` | photographs: Commons files checked against Commons' SHA-1, and plates taken from a volume |
| `verify.py` | checks citations resolve against the original files |

## Two things the parsers handle that are easy to miss

**The printed page number is not the file page number.** BAWS volume 1 has 520
PDF pages and its printed numbering runs with roman front matter, plates and at
least three discontinuities where the offset shifts. The parser reads the number
off the running head and only trusts it when it agrees with its neighbours, so
"APPENDIX 4" is not mistaken for page 4.

**Some volumes were printed with the typesetter's slug line still on the page**,
for example `D:\AMBEDKAR\VOL-07\VOL7-01  Mk S.K.-26-09-2013>DK>9-11-2013  32`.
It is production residue, not part of the work. It is removed from the text the
archive serves and skipped when looking for the running head. Without that,
volume 7 yields no page numbers at all, and the residue would turn up in search
results.
