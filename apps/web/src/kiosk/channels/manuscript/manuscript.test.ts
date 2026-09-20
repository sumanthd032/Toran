/**
 * The Manuscript Station's model, and the manuscript contract under it.
 * Run with `npm test`.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  applyCorrections,
  doubtful,
  heatOf,
  readScan,
  readTranscription,
  type Scan,
} from '@toran/contracts';
import { boxOf, preferred, readingOf, regionAt } from './model.ts';

const RAW_SCAN = {
  id: 'coi-calligraphic-p008',
  sourceId: 'coi-calligraphic',
  corpus: 'manuscript',
  workId: 'coi-calligraphic',
  pageId: 'coi-calligraphic-p008',
  locator: {
    kind: 'folio',
    manuscript: 'The Constitution of India, calligraphed',
    folio: '8',
    printed: 'Articles 17 to 19 of the Constitution of India',
  },
  kind: 'handwritten',
  language: 'en',
  script: 'Latin',
  heading: 'Part III, Articles 17 to 19',
  printedPage: '8',
  width: 2600,
  height: 3250,
  sha256: 'c'.repeat(64),
  title: 'The Constitution of India, calligraphed',
  rights: 'Public domain, as the repository records it.',
  credit: 'World Digital Library',
  note: null,
  master: {
    url: 'https://archive.org/download/x/2672.pdf',
    page: 'https://archive.org/details/x',
    sha1: 'a'.repeat(40),
    rendered: 'page 23 rendered at 300 dpi',
  },
};

const scan: Scan = readScan(RAW_SCAN);

const region = (
  id: string,
  order: number,
  text: string,
  confidence: number,
  box: number[] | null,
) => ({
  id,
  order,
  text,
  confidence,
  polygon:
    box === null
      ? null
      : [
          [box[0], box[1]],
          [box[2], box[1]],
          [box[2], box[3]],
          [box[0], box[3]],
        ],
  words: [],
});

const RAW_READING = {
  pageId: 'coi-calligraphic-p008',
  pipeline: 'vlm',
  model: 'groq meta-llama/llama-4-scout-17b-16e-instruct',
  kind: 'handwritten',
  language: 'en',
  ranAt: '2026-09-20T12:00:00Z',
  imageSha256: 'c'.repeat(64),
  confidenceIs: 'agreement between independent readings',
  regions: [
    region('l000', 0, '“Untouchability” is abolished', 0.99, [100, 100, 900, 200]),
    region(
      'l001',
      1,
      'and its practise in any form is forbidden',
      0.62,
      [100, 220, 1200, 320],
    ),
    region('l002', 2, 'No title shall be conferred by the State', 0.9, null),
  ],
};

test('a transcription carries the page it is of, and is refused without it', () => {
  const reading = readTranscription(RAW_READING, scan);
  assert.equal(reading.citation.pageId, scan.citation.pageId);
  assert.equal(reading.citation.locator.kind, 'folio');

  const wrongPage = { ...RAW_READING, pageId: 'riddles-manuscript-p001' };
  assert.throws(() => readTranscription(wrongPage, scan));
  // Read from a different image than the archive holds.
  const wrongImage = { ...RAW_READING, imageSha256: 'd'.repeat(64) };
  assert.throws(() => readTranscription(wrongImage, scan));
  // A region with no confidence is not a reading anyone can judge.
  const noConfidence = {
    ...RAW_READING,
    regions: [{ ...RAW_READING.regions[0]!, confidence: undefined }],
  };
  assert.throws(() => readTranscription(noConfidence, scan));
  const overOne = {
    ...RAW_READING,
    regions: [{ ...RAW_READING.regions[0]!, confidence: 1.4 }],
  };
  assert.throws(() => readTranscription(overOne, scan));
});

test('heat comes from the confidence and the pipeline, and nothing else', () => {
  const reading = readTranscription(RAW_READING, scan);
  assert.equal(heatOf(reading.regions[0]!, 'vlm'), 'high');
  assert.equal(heatOf(reading.regions[1]!, 'vlm'), 'low');
  assert.equal(heatOf(reading.regions[2]!, 'vlm'), 'middling');
  // A curator's own words are certain whatever number is on them.
  assert.equal(heatOf(reading.regions[1]!, 'curator'), 'certain');
  assert.equal(heatOf.length, 2);
  assert.equal(doubtful(reading).length, 1);
});

test('a correction is a change, and the machine reading survives it', () => {
  const reading = readTranscription(RAW_READING, scan);
  const corrections = [
    {
      pageId: 'coi-calligraphic-p008',
      regionId: 'l001',
      corrects: 'vlm' as const,
      was: 'and its practise in any form is forbidden',
      text: 'and its practice in any form is forbidden',
      by: 'A Curator',
      at: '2026-09-20T13:00:00Z',
      note: null,
    },
  ];
  const applied = applyCorrections(reading, corrections);
  assert.equal(applied[1]!.text, 'and its practice in any form is forbidden');
  assert.equal(applied[1]!.correction?.was, 'and its practise in any form is forbidden');
  assert.equal(applied[1]!.confidence, 1);
  // The machine's own record is untouched.
  assert.equal(reading.regions[1]!.text, 'and its practise in any form is forbidden');
  // A correction aimed at another pipeline's reading does not apply here.
  const elsewhere = applyCorrections(reading, [
    { ...corrections[0]!, corrects: 'surya' as const },
  ]);
  assert.equal(elsewhere[1]!.correction, null);
  // The latest decision on a region wins.
  const later = applyCorrections(reading, [
    corrections[0]!,
    {
      ...corrections[0]!,
      text: 'and its practice in any form is prohibited',
      at: '2026-09-21T09:00:00Z',
    },
  ]);
  assert.equal(later[1]!.text, 'and its practice in any form is prohibited');
});

test('the station counts what a curator changed and what the machine doubted', () => {
  const reading = readingOf(readTranscription(RAW_READING, scan), [
    {
      pageId: 'coi-calligraphic-p008',
      regionId: 'l001',
      corrects: 'vlm',
      was: 'and its practise in any form is forbidden',
      text: 'and its practice in any form is forbidden',
      by: 'A Curator',
      at: '2026-09-20T13:00:00Z',
      note: null,
    },
  ]);
  assert.equal(reading.corrected, 1);
  // The one it doubted is the one that was corrected, so nothing is left doubtful.
  assert.equal(reading.doubtful, 0);
});

test('a printed page goes to the printed model and a hand to the handwriting model', () => {
  const hand = readingOf(readTranscription(RAW_READING, scan), []);
  const printed = readingOf(
    readTranscription({ ...RAW_READING, pipeline: 'surya', kind: 'printed' }, scan),
    [],
  );
  assert.equal(preferred([hand, printed], scan), 'vlm');
  assert.equal(preferred([hand, printed], { ...scan, hand: 'printed' }), 'surya');
  // Only one reading, and it is not the intended one: show what there is.
  assert.equal(preferred([printed], scan), 'surya');
  assert.equal(preferred([], scan), null);
});

test('a press on the page finds the smallest region under it, or nothing', () => {
  const regions = applyCorrections(readTranscription(RAW_READING, scan), []);
  assert.equal(regionAt(regions, 500, 150)?.id, 'l000');
  assert.equal(regionAt(regions, 500, 260)?.id, 'l001');
  // Blank paper answers nothing rather than guessing the nearest line.
  assert.equal(regionAt(regions, 2400, 3000), null);
  // A reading with no boxes cannot answer at all.
  assert.equal(regionAt([regions[2]!], 500, 150), null);
});

test('a box is in viewport units, where the page is one unit wide', () => {
  const regions = applyCorrections(readTranscription(RAW_READING, scan), []);
  const box = boxOf(regions[0]!, scan)!;
  assert.equal(box.x, 100 / 2600);
  assert.equal(box.width, 800 / 2600);
  // Both axes divide by the width, which is how OpenSeadragon measures.
  assert.equal(box.y, 100 / 2600);
  assert.equal(boxOf(regions[2]!, scan), null);
});

const BUILT = new URL('../../../../public/archive', import.meta.url);

test('the built scans read, and every reading carries its page', (t) => {
  const index = new URL('scans.json', `${BUILT}/`);
  if (!existsSync(index)) {
    t.skip('archive not built; run npm run build:data');
    return;
  }
  const scans = JSON.parse(readFileSync(index, 'utf8')).map(readScan);
  assert.ok(scans.length > 0);
  for (const s of scans) {
    assert.ok(s.citation.pageId === s.id);
    assert.ok(s.provenance.sha1.length === 40);
  }
  const ocr = new URL('ocr/', `${BUILT}/`);
  if (!existsSync(ocr)) return;
  let read = 0;
  for (const file of readdirSync(ocr)) {
    const match = /^(.+)\.(surya|vlm)\.json$/.exec(file);
    if (match === null) continue;
    const page = scans.find((s: Scan) => s.id === match[1]);
    assert.ok(page !== undefined, `${file} has no scan`);
    const reading = readTranscription(
      JSON.parse(readFileSync(new URL(file, ocr), 'utf8')),
      page,
    );
    assert.ok(reading.regions.length > 0, `${file} read nothing`);
    for (const r of reading.regions) assert.ok(r.confidence >= 0 && r.confidence <= 1);
    read++;
  }
  assert.ok(read > 0, 'no page has been read by any pipeline');
});
