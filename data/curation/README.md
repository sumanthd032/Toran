# curation

Decisions people have made about the archive. Unlike `sip/`, `aip/` and `dip/`,
nothing here can be rebuilt from the sources, so it is kept in the repository.

## edges.jsonl

One line per decision on a link in the Provenance Graph, appended by
`node tools/confirm-edges.mjs --by "Name"` and never edited:

```json
{"edge": "draft-11--becomes--art-17", "digest": "…", "decision": "confirmed",
 "by": "Name", "at": "2026-09-20T10:00:00.000Z", "note": null}
```

`digest` is the SHA-256 of the evidence the curator was shown. A decision only
counts while the link's evidence still hashes to it: if a passage is re-ingested
differently, the link goes back to awaiting a curator. The latest decision on
the same evidence wins, so a mistaken decision is corrected by a new line, not
by editing an old one.

## transcriptions.jsonl

The held-out set the OCR pipelines are scored against. One line per passage:

```json
{"pageId": "coi-calligraphic-p008", "passage": "article-17", "text": "…",
 "method": "archive", "source": "…", "by": "Name", "at": "2026-09-20",
 "note": null}
```

`method` says where the words came from, because that is what makes a score
worth anything:

- `archive`, the words are already in the archive from an independent source
  and nothing was read off the scan. The strongest kind.
- `repository`, the repository holding the scan publishes the transcription.
- `read`, a named person read the scan and wrote down what it says.

A score is only as good as its ground truth, so `pipeline/ocr/accuracy.py`
prints the method beside every number and never averages across methods
without saying so.
