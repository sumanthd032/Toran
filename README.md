# Toran

Digital heritage archive and institutional twin for the Dr. Ambedkar International Centre.

A navigable reconstruction of the Centre in which every screen in the hall is a live
application, backed by an archive that links Dr. Ambedkar's writings to the Constituent
Assembly Debates to the ratified Articles of the Constitution, with page-level citations
on every link.

Built for Smart India Hackathon 2026, problem statement SIH26096, Ministry of Social
Justice and Empowerment.

## What it does

- Semantic and keyword search across the writings and the Assembly debates, running on the
  device with no network required
- A provenance graph tracing each Article back through debate to its source text
- Deep zoom into scanned manuscripts with OCR transcription and visible confidence
- Narration and translation across the 22 scheduled languages
- An interactive timeline and the photographic collection
- A research assistant that cites every claim and declines when the corpus does not support
  an answer
- Curation tools for ingest, metadata, OCR correction and kiosk fleet management

## Standards

Archival packaging follows OAIS (ISO 14721). Description uses Dublin Core, preservation
events use PREMIS, and scanned material is published as IIIF Presentation manifests so it
can be read in any IIIF viewer.

## Status

In development.

## Stack

Next.js and TypeScript, React Three Fiber for the twin, on-device embeddings via
transformers.js, Bhashini for Indic language services, static export to Chromium kiosk mode
on Raspberry Pi.
