# pipeline

Corpus acquisition, parsing and OAIS packaging. Python, standard library only.

## Requirements

- Python 3.11 or newer, no packages to install
- `pdftotext` from poppler-utils, which does the PDF text extraction

```
sudo dnf install poppler-utils      # Fedora
sudo apt install poppler-utils      # Debian, Ubuntu
```

There is no `requirements.txt` because there are no dependencies. Step 8 adds
Surya for OCR and will bring one.

## Run

```
python3 pipeline/ingest.py            # fetch, parse, package
python3 pipeline/ingest.py --refetch  # re-download even if present
python3 pipeline/verify.py            # check the result against the originals
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
| `oais/packages.py` | SIP/AIP/DIP, fixity, PREMIS events, Dublin Core |
| `ingest.py` | orchestrates the three stages |
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
