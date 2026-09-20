/**
 * The Manuscript Station: a scanned page, what a machine read from it, and
 * what a curator corrected. PROJECT.md 7.4, D-012.
 *
 * Three rules hold this together.
 *
 * A transcription is a claim about a page, so it carries that page's citation
 * like every other passage in Toran. `readTranscription` refuses one without.
 *
 * A machine reading is never edited. A correction is a separate record naming
 * the region it corrects, who made it and when, and both survive. What the
 * machine produced can always be read back, which is the whole reason the
 * PREMIS log exists.
 *
 * Confidence is not optional and it is not decoration. Every region carries
 * one, `heatOf` is the only way to turn it into something a view can render,
 * and it says plainly what the number means for the pipeline that produced
 * it: Surya reports its own probability, the vision model's is agreement
 * between independent readings, and a curator's correction is certain because
 * a person looked at it.
 */

import { CitationError, type Citation, type CitedPassage } from './citation.ts';
import { readChunk, readLocator, type RawChunk } from './ingest.ts';

export const PIPELINES = ['surya', 'vlm', 'curator'] as const;
export type Pipeline = (typeof PIPELINES)[number];

export const SCAN_SCRIPTS = ['Latin', 'Devanagari'] as const;
export type ScanScript = (typeof SCAN_SCRIPTS)[number];

/** Printed type or a hand. They are different problems and different models. */
export const HANDS = ['printed', 'handwritten'] as const;
export type Hand = (typeof HANDS)[number];

/** Where a page image came from, and what was done to it. */
export interface ScanProvenance {
  /** The master this image was made from. */
  readonly url: string;
  /** The repository's page for it, which a reader can open. */
  readonly page: string;
  /** The SHA-1 the repository publishes, which the master was checked against. */
  readonly sha1: string;
  /** What this image is: "page 23 rendered at 300 dpi". */
  readonly rendered: string;
}

export interface Scan {
  readonly id: string;
  readonly sourceId: string;
  readonly hand: Hand;
  readonly language: string;
  readonly script: ScanScript;
  readonly heading: string;
  /** The page as printed, where it is printed. Null for an unnumbered leaf. */
  readonly printedPage: string | null;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  /** The page's own citation. Everything read off it inherits this. */
  readonly citation: Citation;
  readonly title: string;
  readonly rights: string;
  readonly credit: string | null;
  readonly note: string | null;
  readonly provenance: ScanProvenance;
}

export interface Word {
  readonly text: string;
  readonly confidence: number;
  /** Four corners in the page's own pixels. */
  readonly polygon: readonly (readonly [number, number])[] | null;
}

export interface Region {
  readonly id: string;
  readonly order: number;
  readonly text: string;
  readonly confidence: number;
  readonly polygon: readonly (readonly [number, number])[] | null;
  /** Word by word, where the pipeline reports it. Empty where it does not. */
  readonly words: readonly Word[];
}

export interface Transcription {
  readonly pageId: string;
  readonly pipeline: Pipeline;
  /** The model and version, named, so a number can be attributed to it. */
  readonly model: string;
  readonly hand: Hand;
  readonly language: string;
  readonly ranAt: string;
  /** The digest of the image read. A different image is a different reading. */
  readonly imageSha256: string;
  /** What the confidence on each region means, in words, for this pipeline. */
  readonly confidenceIs: string;
  readonly regions: readonly Region[];
  /** The page's citation, carried so a region can never be shown without one. */
  readonly citation: Citation;
}

/** A curator's reading of one region, which never replaces the machine's. */
export interface Correction {
  readonly pageId: string;
  readonly regionId: string;
  /** The pipeline whose region this corrects. */
  readonly corrects: Pipeline;
  /** What the machine read, kept so the correction can be seen as a change. */
  readonly was: string;
  readonly text: string;
  readonly by: string;
  readonly at: string;
  readonly note: string | null;
}

export type Heat = 'certain' | 'high' | 'middling' | 'low';

/**
 * How sure a reading is, as a view may show it. The only way to ask.
 *
 * The bands are wide on purpose. A model's confidence is not calibrated, so a
 * number to two decimal places would suggest a precision that is not there;
 * four bands say what a reader can act on, which is whether to check it.
 * `certain` is a curator's own words and nothing else earns it.
 */
export function heatOf(region: Region, pipeline: Pipeline): Heat {
  if (pipeline === 'curator') return 'certain';
  if (region.confidence >= 0.97) return 'high';
  if (region.confidence >= 0.85) return 'middling';
  return 'low';
}

/** What fraction of a reading a curator would need to look at. */
export function doubtful(transcription: Transcription): readonly Region[] {
  return transcription.regions.filter((r) => heatOf(r, transcription.pipeline) === 'low');
}

type Json = Record<string, unknown>;

function record(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CitationError(`${what} must be an object`);
  }
  return value as Json;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CitationError(`${what} must be a non-empty string`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
  if (!(options as readonly unknown[]).includes(value)) {
    throw new CitationError(
      `${what} ${String(value)} is not one of ${options.join(', ')}`,
    );
  }
  return value as T;
}

function number_(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CitationError(`${what} must be a number`);
  }
  return value;
}

function confidence(value: unknown, what: string): number {
  const n = number_(value, what);
  if (n < 0 || n > 1)
    throw new CitationError(`${what} must be between 0 and 1, got ${n}`);
  return n;
}

function polygon(
  value: unknown,
  what: string,
): readonly (readonly [number, number])[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length < 3) {
    throw new CitationError(`${what} must be at least three points, or null`);
  }
  return value.map((point) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new CitationError(`${what} has a point that is not an x and a y`);
    }
    return [number_(point[0], `${what} x`), number_(point[1], `${what} y`)] as const;
  });
}

/** The passage a scan's citation describes, built so the citation is checked. */
function citationOf(raw: Json, what: string): Citation {
  const passage: CitedPassage = readChunk({
    corpus: raw['corpus'],
    workId: raw['workId'],
    pageId: raw['pageId'],
    locator: readLocator(raw['locator']),
    language: raw['language'],
    speaker: null,
    // A citation needs a passage to hang on; the heading is the page's own
    // description of itself and is never shown as if it were the page's text.
    text: text(raw['heading'], `${what} heading`),
  } as RawChunk);
  return passage.citation;
}

export function readScan(raw: unknown): Scan {
  const s = record(raw, 'scan');
  const id = text(s['id'], 'scan id');
  return {
    id,
    sourceId: text(s['sourceId'], `${id} sourceId`),
    hand: oneOf(s['kind'], HANDS, `${id} kind`),
    language: text(s['language'], `${id} language`),
    script: oneOf(s['script'], SCAN_SCRIPTS, `${id} script`),
    heading: text(s['heading'], `${id} heading`),
    printedPage: typeof s['printedPage'] === 'string' ? s['printedPage'] : null,
    width: number_(s['width'], `${id} width`),
    height: number_(s['height'], `${id} height`),
    sha256: text(s['sha256'], `${id} sha256`),
    citation: citationOf(s, id),
    title: text(s['title'], `${id} title`),
    rights: text(s['rights'], `${id} rights`),
    credit: typeof s['credit'] === 'string' ? s['credit'] : null,
    note: typeof s['note'] === 'string' ? s['note'] : null,
    provenance: (() => {
      const p = record(s['master'], `${id} master`);
      return {
        url: text(p['url'], `${id} master url`),
        page: text(p['page'], `${id} master page`),
        sha1: text(p['sha1'], `${id} master sha1`),
        rendered: text(p['rendered'], `${id} master rendered`),
      };
    })(),
  };
}

export function readScans(raw: unknown): readonly Scan[] {
  if (!Array.isArray(raw)) throw new CitationError('scans must be a list');
  return raw.map(readScan);
}

/**
 * A machine's reading of a page, refused unless it carries the page's
 * citation and a confidence on every region.
 */
export function readTranscription(raw: unknown, scan: Scan): Transcription {
  const t = record(raw, 'transcription');
  const pageId = text(t['pageId'], 'transcription pageId');
  if (pageId !== scan.id) {
    throw new CitationError(`transcription of ${pageId} given the scan ${scan.id}`);
  }
  const imageSha256 = text(t['imageSha256'], `${pageId} imageSha256`);
  if (imageSha256 !== scan.sha256) {
    throw new CitationError(
      `${pageId}: read from a different image than the archive holds`,
    );
  }
  const pipeline = oneOf(t['pipeline'], PIPELINES, `${pageId} pipeline`);
  const regions = Array.isArray(t['regions']) ? t['regions'] : [];
  return {
    pageId,
    pipeline,
    model: text(t['model'], `${pageId} model`),
    hand: oneOf(t['kind'], HANDS, `${pageId} kind`),
    language: text(t['language'], `${pageId} language`),
    ranAt: text(t['ranAt'], `${pageId} ranAt`),
    imageSha256,
    confidenceIs:
      typeof t['confidenceIs'] === 'string'
        ? t['confidenceIs']
        : "the model's own probability for what it produced, which is not calibrated",
    regions: regions.map((rawRegion, i): Region => {
      const r = record(rawRegion, `${pageId} region ${i}`);
      const words = Array.isArray(r['words']) ? r['words'] : [];
      return {
        id: text(r['id'], `${pageId} region ${i} id`),
        order: number_(r['order'], `${pageId} region ${i} order`),
        text: text(r['text'], `${pageId} region ${i} text`),
        confidence: confidence(r['confidence'], `${pageId} region ${i} confidence`),
        polygon: polygon(r['polygon'], `${pageId} region ${i} polygon`),
        words: words.map((rawWord, w): Word => {
          const word = record(rawWord, `${pageId} region ${i} word ${w}`);
          return {
            text: text(word['text'], `${pageId} region ${i} word ${w} text`),
            confidence: confidence(word['confidence'], `${pageId} word ${w} confidence`),
            polygon: polygon(word['polygon'], `${pageId} word ${w} polygon`),
          };
        }),
      };
    }),
    citation: scan.citation,
  };
}

export function readCorrection(raw: unknown): Correction {
  const c = record(raw, 'correction');
  const pageId = text(c['pageId'], 'correction pageId');
  return {
    pageId,
    regionId: text(c['regionId'], `${pageId} regionId`),
    corrects: oneOf(c['corrects'], PIPELINES, `${pageId} corrects`),
    was: typeof c['was'] === 'string' ? c['was'] : '',
    text: text(c['text'], `${pageId} correction text`),
    by: text(c['by'], `${pageId} correction by`),
    at: text(c['at'], `${pageId} correction at`),
    note: typeof c['note'] === 'string' && c['note'].trim() !== '' ? c['note'] : null,
  };
}

/**
 * The reading a curator sees, with corrections applied over the machine's
 * regions. The machine's words are kept on every region that was changed, so
 * a view can show what was there before and nothing is quietly rewritten.
 */
export interface CorrectedRegion extends Region {
  readonly correction: Correction | null;
}

export function applyCorrections(
  transcription: Transcription,
  corrections: readonly Correction[],
): readonly CorrectedRegion[] {
  const latest = new Map<string, Correction>();
  for (const c of corrections) {
    if (c.pageId !== transcription.pageId || c.corrects !== transcription.pipeline)
      continue;
    const held = latest.get(c.regionId);
    if (held === undefined || c.at >= held.at) latest.set(c.regionId, c);
  }
  return transcription.regions.map((region) => {
    const correction = latest.get(region.id) ?? null;
    return correction === null
      ? { ...region, correction: null }
      : { ...region, text: correction.text, confidence: 1, correction };
  });
}
