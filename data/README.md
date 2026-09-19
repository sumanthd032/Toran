# data

OAIS packages (ISO 14721). Three package types, three directories.

Nothing in here is edited by hand. It is produced by `python3 pipeline/ingest.py`
and checked by `python3 pipeline/verify.py`.

## Layout

```
data/
├─ sip/                     SUBMISSION. What arrived.
│  ├─ <source-id>/
│  │  ├─ original.pdf       the bytes as retrieved, never modified
│  │  ├─ <date>.html        for sources fetched per sitting
│  │  └─ submission.json    url, retrieval time, sha256, rights
│  └─ photos/<id>/
│     ├─ original.<ext>     a Commons file, kept only if its SHA-1 matches Commons
│     └─ submission.json    file page, licence and what Commons records about it
├─ aip/                     ARCHIVAL. What is kept. The authority.
│  ├─ premis.jsonl          append-only preservation event log
│  ├─ <source-id>/
│  │  ├─ dublin-core.json   descriptive metadata, 15 elements only
│  │  ├─ pages.json         per page: printed number, observed or inferred
│  │  ├─ records.json       per paragraph, for debate sources
│  │  └─ pages/*.txt        normalised page text
│  └─ photos/<id>/
│     └─ dublin-core.json   a photograph's record, as Commons gives it
├─ dip/                     DISSEMINATION. What is served. Rebuildable.
│  ├─ works.json            catalogue
│  ├─ chunks.jsonl          retrieval units, one JSON object per line
│  ├─ pages.jsonl           the reading copy: pages with their printed structure
│  ├─ sittings.jsonl        the reading copy: whole debate sittings
│  ├─ articles.jsonl        the reading copy: Articles of the Constitution
│  ├─ photos.json           photographs with their provenance
│  └─ photos/<id>.jpg       web copies, at most 1600 px
└─ fixity.json              sha256 of every submitted object
```

**The AIP is the authority.** If the DIP and the AIP disagree, the DIP is wrong
and is rebuilt. The DIP can be deleted at any time without losing anything.

## What a record promises

Every chunk in `dip/chunks.jsonl` carries a locator, and the locator is a
promise that a reader can open the source and find that text there. That
promise is tested: `pipeline/verify.py` samples chunks, opens the original PDF
at the page the locator names, and confirms the text is present.

Three locator shapes, because the corpora do not share a citable unit.

| Corpus | Locator | Example |
| --- | --- | --- |
| BAWS, printed volumes | page | volume 1, page 47 |
| Constituent Assembly Debates | paragraph | 7.62.186, 29 November 1948 |
| Constitution | article | Article 17 |

Forcing all three into a page number would mean inventing page numbers that do
not exist. An archive does not do that.

## Observed and inferred page numbers

BAWS volumes carry the printed page number in the running head. It is read off
the page where possible and inferred from the surrounding sequence where the
head is absent, which happens on chapter openings, plates and appendix pages.

`observed: false` means the number was inferred. The interface shows this, and
a citation to an inferred page is marked as such rather than presented with the
authority of a reading. Current rates are reported by `pipeline/verify.py`.

## Procedural records

The debates number every paragraph of speech but not the procedural lines
between them: "The amendment was adopted", "Article 11 was added to the
Constitution". Those lines carry the outcome of a debate and are the most
consequential sentences in the corpus, so they are kept and located by the
paragraph they follow, marked `procedural: true` and cited as `7.62.185+`.

## Rights

`pipeline/sources.json` records the rights position for every source as stated
by its publisher, and `rights_verified` is `false` on all of them. That flag
means nobody on this project has confirmed the position with the rights holder.
It is recorded honestly rather than assumed, and it should be resolved before
any public deployment.

Photographs are listed in `pipeline/photos.json` and fetched by
`python3 pipeline/photos.py`. Only files Wikimedia Commons records as public
domain are fetched, and the date, author and source shown with each are what
Commons records, labelled as such on screen. Several give their source only as
"Via Internet"; none has been confirmed beyond Commons.
