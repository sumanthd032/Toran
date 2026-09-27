# Toran

A digital twin of the archive hall at the Dr. Ambedkar National Memorial, 26, Alipur
Road, New Delhi, and the archive behind it. Dr. Ambedkar's writings, the Constituent
Assembly Debates and the Constitution are linked to each other, and every passage is cited
to its volume and page.

**Live:** https://toran-hall.duckdns.org

Built for Smart India Hackathon 2026, problem statement SIH26096, Ministry of Social
Justice and Empowerment.

## What you see

The Twin opens with a camera flight through the Toran gateway into the hall. Thirteen
devices stand in the nave, and each one is a kiosk with one job. Open a device and it runs on
its own screen, at its own resolution, with the hall still around it. A first visit is
offered a guided tour.

The devices run eight applications:

| Device | What it does |
| --- | --- |
| Welcome totem | Choose a language and text size, and take a Sutra card that carries them, and your kept passages, to every other device |
| Reading Room | Search the writings and the debates on the device, with no network, and read each result on the page it was printed on |
| Provenance Graph | Trace an Article back through the draft the Assembly debated to the writing that argued for it; a solid link was confirmed by a named curator, a dashed one was not |
| Timeline Wall | A life year by year, in documents and photographs, with threads joining the events |
| Manuscript Station | Deep zoom into scanned pages, with the OCR reading beside them and how sure the machine was, line by line |
| Audio Booth | Passages read aloud in the visitor's language, with the source of what is read |
| AV Archive | Films with transcripts searchable to the second a phrase is spoken |
| Research Assistant | Answers from the archive alone, citing every sentence, and declines when the archive does not support an answer |

The thirteenth device, the Curator Console, is the staff desk: the ingest queue, Dublin Core
editing, OCR correction, provenance link review and the fleet.

The hall is alive without any kiosks in it. Toran Core runs a simulated visitor at each
device, and every screen that shows one says it is simulated. When a visitor stays with one
work, the displays near them drift toward it (the Honeypot Fleet). The **Hall** button
opens a panel that controls all of this: where the visitor at an open kiosk stands, a card
tap, language, graphics, motion, and whether the simulated visitors are shown.

## Run it on your own machine

You need Node 22.18 or later (`.node-version` pins it; [fnm](https://github.com/Schniz/fnm)
reads that file) and npm.

```sh
npm install
npm run build:hall     # the static export, set to find Core at its own origin
npm start              # Toran Core serving the Twin and its API
```

Then open http://127.0.0.1:8787/. That is the same program the live site runs.

The archive itself (`data/` and `apps/web/public/archive/`) is built from sources that are
not in the repository. On a fresh checkout, build it first:

```sh
npm run build:data     # downloads the sources, parses, runs OCR, builds the indexes
npm run build:iiif     # the manuscript tiles; needs ImageMagick
```

`build:data` takes a while, needs a network, and its OCR steps need Python 3.13 with Surya
in `pipeline/.venv` (`pipeline/README.md` has the three commands that set it up). Some steps call Groq or
Bhashini, and those need the keys below.

For development, `npm run dev` serves the web app with hot reload and `npm run core` starts
Core. Point the dev server at it with `?core=http://127.0.0.1:8787` in the address.

### Keys and settings

Copy `.env.example` to `.env.local`, which is gitignored. Every value is optional; each one
turns something on.

| Variable | Turns on |
| --- | --- |
| `TORAN_CURATOR_KEY` | Changing the fleet and the archive from the Curator Console and the Twin (16 characters or more) |
| `GROQ_API_KEY` | New questions to the Research Assistant; without it, it answers its prepared questions |
| `BHASHINI_USER_ID`, `BHASHINI_ULCA_API_KEY` | Spoken search, and building translations and narration |
| `TORAN_SIMULATE_HALL` | The simulated visitors, on unless set to `0` |

A key never reaches the browser. Core holds them, and the kiosks ask Core.

## How it is built

```
apps/web          Next.js 15, static export: the Twin (React Three Fiber) and every kiosk
apps/core         Toran Core: node:http and node:sqlite, no framework, no other dependency
packages/
  contracts       the shapes both sides read, including the citation rule
  narrate         the Bhashini client, translation and narration builds
  indexer         embeddings and BM25 for the on-device search
pipeline          Python: ingest (OAIS SIP, AIP, DIP), OCR, media
tools             the builds and the checks
hardware          the Raspberry Pi daemon for the sensor and card reader (shelved for now)
deploy            the Docker image, a systemd unit, Caddy, and the AWS notes
```

Search, reading, the graph, the manuscripts and the cached translations run on the device
against static files, with no network call. What needs a server goes through Core: card
continuity between devices, the fleet, curation, the Research Assistant and spoken search.
Core also serves the built Twin, so one program on one port is the whole hall.

## Standards

Archival packaging follows OAIS (ISO 14721). Description uses Dublin Core, preservation
events use PREMIS, and scanned pages are published as IIIF Presentation manifests, so they
open in any IIIF viewer.

Three rules are enforced in code rather than by convention:

- A passage cannot be displayed without a citation that resolves to a volume and page, and
  the Research Assistant's answers are checked for this before they are shown.
- A provenance link a curator has not confirmed is always drawn as unconfirmed.
- A Sutra card is an anonymous token. Core's session store has no column for which device a
  card touched or when, so it cannot keep a visitor's route through the hall.

## Checking it

```sh
npm test               # unit tests: contracts, kiosk logic, Core, curation, the daemon
npm run typecheck
npm run lint
npm run verify:hall    # the Twin as deployed; HALL_URL=... checks a live site
```

There is a `verify:*` check for each part (`verify:core`, `verify:curator`,
`verify:honeypot`, `verify:speech` and more). The newer ones run in Chrome or, without it,
Firefox. Several older ones expect Chrome at `/usr/bin/google-chrome`.

## Deploying

`deploy/README.md` has the Docker image, the systemd unit, the Caddy configuration and the
steps for AWS, and records how the live site is set up.

## What is not done, or not measured

- The hardware (the HC-SR04 proximity sensor, the PN532 card reader and the Pi build) is
  written and tested without a Pi, and has never run on one.
- Narration audio is not generated yet, and live spoken search is unmeasured. Bhashini's
  text-to-speech and speech recognition answered with errors throughout testing, while its
  translation worked.
- The interface is offered in six languages: English, Hindi, Marathi, Bengali, Tamil and
  Telugu. Bengali, Tamil and Telugu are machine translated and marked so.
- Frame time on the target tablet has not been measured; figures so far are from a desktop.

## Sources and rights

The archive holds 8 works and 1,335 pages. Each source is listed with where it came from
and on what terms in `pipeline/sources.json`, and the films, photographs and scans in the
other manifests in `pipeline/`.
Rights are recorded as each source states them. The Writings and Speeches are Government of
India publications, the debates are the public record as transcribed by the Centre for Law
and Policy Research, and the two films are Doordarshan productions released under CC BY 3.0. Where a curator has
checked a rights statement against its source, the Curator Console records who and when.

No licence has been chosen for this repository's own code yet.
