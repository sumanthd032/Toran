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
