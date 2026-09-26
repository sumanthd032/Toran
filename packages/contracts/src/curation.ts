/**
 * The wire between the Curator Console and Toran Core. R14.
 *
 * Four kinds of decision a curator makes about the archive, and one rule they
 * share: a decision is a new record, never an edit. A confirmed link, a
 * corrected OCR line, a changed title and a verified licence are each appended
 * to a file under data/curation, each writes a PREMIS event, and what the
 * machine or the source produced first is kept beside it. ARCHITECTURE.md
 * section 3.
 *
 * Every shape here is read through a function below at both ends, for the same
 * reason as core.ts: a console that trusts a malformed queue shows a curator
 * something the archive does not hold, and a Core that trusts a malformed
 * decision writes one down permanently.
 */

import type { RawChunk } from './ingest.ts';
import { readChunks } from './ingest.ts';
import type { CitedPassage } from './citation.ts';
import { WireError } from './core.ts';

/** Who decided, and why. Required on every write: an archive records its agents. */
export interface CuratorNote {
  readonly by: string;
  readonly note: string | null;
}

export const EDGE_DECISIONS = ['confirmed', 'rejected'] as const;
export type EdgeDecision = (typeof EDGE_DECISIONS)[number];

export interface EdgeConfirmation {
  readonly decision: EdgeDecision;
  readonly by: string;
  readonly at: string;
  readonly note: string | null;
}

export interface EdgeEnd {
  readonly id: string;
  readonly title: string;
  readonly date: string;
}

/** One Provenance Graph link, with the evidence a curator is asked to judge. */
export interface EdgeReview {
  readonly id: string;
  readonly from: EdgeEnd;
  readonly to: EdgeEnd;
  readonly assertion: string;
  readonly method: string;
  readonly score: number | null;
  readonly assertedBy: string | null;
  /** SHA-256 of the evidence. A decision holds for this evidence and no other. */
  readonly digest: string;
  readonly evidence: readonly CitedPassage[];
  readonly confirmation: EdgeConfirmation | null;
}

export interface EdgeDecisionInput extends CuratorNote {
  readonly edge: string;
  readonly digest: string;
  readonly decision: EdgeDecision;
}

/** An axis-aligned box in scan pixels: x, y, width, height. */
export type RegionBox = readonly [number, number, number, number];

export interface OcrCorrection {
  readonly text: string;
  readonly by: string;
  readonly at: string;
  readonly note: string | null;
}

export interface OcrRegion {
  readonly id: string;
  readonly text: string;
  readonly confidence: number;
  readonly box: RegionBox | null;
  /** The latest correction, if any. The machine's text above is never replaced. */
  readonly correction: OcrCorrection | null;
}

export interface OcrReading {
  readonly pipeline: string;
  readonly model: string;
  /** What this model's confidence number means. They are not comparable. */
  readonly confidenceIs: string;
  readonly regions: readonly OcrRegion[];
}

export interface OcrPage {
  readonly pageId: string;
  readonly heading: string;
  /** The page as a citation would print it, with a volume or leaf where one exists. */
  readonly cite: string;
  readonly width: number;
  readonly height: number;
  readonly readings: readonly OcrReading[];
}

export interface OcrCorrectionInput extends CuratorNote {
  readonly pageId: string;
  readonly regionId: string;
  readonly pipeline: string;
  readonly text: string;
}

/**
 * The Dublin Core fields a curator may change.
 *
 * The rest describe the file (format, identifier, source) and are measured,
 * not judged, so they are not open to editing.
 */
export const EDITABLE_FIELDS = ['title', 'creator', 'publisher', 'rights'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export interface MetadataEdit {
  readonly field: EditableField;
  readonly was: string;
  readonly value: string;
  readonly by: string;
  readonly at: string;
  readonly note: string | null;
}

export interface WorkRecord {
  readonly id: string;
  /** What the record says now: the source's value, or the latest edit of it. */
  readonly fields: Readonly<Record<EditableField, string>>;
  /** What arrived with the submission, which no edit replaces. */
  readonly submitted: Readonly<Record<EditableField, string>>;
  readonly edits: readonly MetadataEdit[];
}

export interface MetadataEditInput extends CuratorNote {
  readonly workId: string;
  readonly field: EditableField;
  readonly value: string;
}

/** How far a submission has come through OAIS. */
export const INGEST_STAGES = ['listed', 'submitted', 'archived'] as const;
export type IngestStage = (typeof INGEST_STAGES)[number];

export const FIXITY_STATES = ['unchecked', 'intact', 'changed', 'missing'] as const;
export type FixityState = (typeof FIXITY_STATES)[number];

export interface RightsDecision {
  readonly by: string;
  readonly at: string;
  readonly note: string | null;
}

export interface IngestItem {
  readonly id: string;
  readonly title: string;
  readonly format: string;
  readonly stage: IngestStage;
  readonly bytes: number | null;
  readonly retrieved: string | null;
  readonly rights: string;
  /** What the source itself says about its rights, verbatim. */
  readonly rightsRecorded: string;
  /** A curator who checked the rights and said so. Null until one has. */
  readonly rightsDecision: RightsDecision | null;
  readonly fixity: FixityState;
  readonly fixityCheckedAt: string | null;
}

export interface FixityResult {
  readonly id: string;
  readonly fixity: FixityState;
  readonly checkedAt: string;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WireError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WireError(`${what} must be a non-empty string`);
  }
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new WireError(`${what} must be a string`);
  return value;
}

function optionalStr(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WireError(`${what} must be a finite number`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new WireError(`${what} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function list(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new WireError(`${what} must be a list`);
  return value;
}

/**
 * A curator's name. Recorded against every decision, so it has to be a name:
 * something a person would sign, not a paragraph and not markup.
 */
export function readCuratorName(value: unknown): string {
  const name = str(value, 'by').trim();
  if (name.length > 80 || /[<>\n\r]/.test(name)) {
    throw new WireError('by must be a name of at most 80 characters');
  }
  return name;
}

function readNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const note = text(value, 'note').trim();
  if (note.length > 1000) throw new WireError('a note must be under 1000 characters');
  return note === '' ? null : note;
}

function readEnd(raw: unknown, what: string): EdgeEnd {
  const e = record(raw, what);
  return {
    id: str(e['id'], `${what} id`),
    title: str(e['title'], `${what} title`),
    date: text(e['date'] ?? '', `${what} date`),
  };
}

function readConfirmation(raw: unknown): EdgeConfirmation | null {
  if (raw === null || raw === undefined) return null;
  const c = record(raw, 'confirmation');
  return {
    decision: oneOf(c['decision'], EDGE_DECISIONS, 'decision'),
    by: str(c['by'], 'by'),
    at: str(c['at'], 'at'),
    note: optionalStr(c['note']),
  };
}

/**
 * A link and its evidence. Evidence that cannot produce a citation is dropped,
 * and a link left with no evidence at all is refused: a curator cannot be
 * asked to confirm something nobody can show them the source for.
 */
export function readEdgeReview(raw: unknown): EdgeReview {
  const e = record(raw, 'edge');
  const { passages } = readChunks(list(e['evidence'], 'evidence') as RawChunk[]);
  if (passages.length === 0)
    throw new WireError('an edge with no cited evidence cannot be reviewed');
  const score = e['score'];
  return {
    id: str(e['id'], 'id'),
    from: readEnd(e['from'], 'from'),
    to: readEnd(e['to'], 'to'),
    assertion: str(e['assertion'], 'assertion'),
    method: str(e['method'], 'method'),
    score: typeof score === 'number' && Number.isFinite(score) ? score : null,
    assertedBy: optionalStr(e['assertedBy']),
    digest: str(e['digest'], 'digest'),
    evidence: passages,
    confirmation: readConfirmation(e['confirmation']),
  };
}

export function readEdgeReviews(raw: unknown): readonly EdgeReview[] {
  return list(raw, 'edges').flatMap((e) => {
    try {
      return [readEdgeReview(e)];
    } catch {
      return [];
    }
  });
}

export function readEdgeDecisionInput(raw: unknown): EdgeDecisionInput {
  const d = record(raw, 'decision');
  return {
    edge: str(d['edge'], 'edge'),
    digest: str(d['digest'], 'digest'),
    decision: oneOf(d['decision'], EDGE_DECISIONS, 'decision'),
    by: readCuratorName(d['by']),
    note: readNote(d['note']),
  };
}

function readBox(raw: unknown): RegionBox | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [x, y, w, h] = raw.map((v) =>
    typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN,
  );
  if ([x, y, w, h].some((v) => Number.isNaN(v))) return null;
  return [x!, y!, w!, h!];
}

function readRegion(raw: unknown): OcrRegion {
  const r = record(raw, 'region');
  const c = r['correction'];
  let correction: OcrCorrection | null = null;
  if (c !== null && c !== undefined) {
    const cr = record(c, 'correction');
    correction = {
      text: str(cr['text'], 'correction text'),
      by: str(cr['by'], 'by'),
      at: str(cr['at'], 'at'),
      note: optionalStr(cr['note']),
    };
  }
  return {
    id: str(r['id'], 'region id'),
    text: text(r['text'], 'region text'),
    confidence: num(r['confidence'], 'confidence'),
    box: readBox(r['box']),
    correction,
  };
}

export function readOcrPage(raw: unknown): OcrPage {
  const p = record(raw, 'ocr page');
  return {
    pageId: str(p['pageId'], 'pageId'),
    heading: text(p['heading'] ?? '', 'heading'),
    cite: str(p['cite'], 'cite'),
    width: num(p['width'], 'width'),
    height: num(p['height'], 'height'),
    readings: list(p['readings'], 'readings').map((raw) => {
      const r = record(raw, 'reading');
      return {
        pipeline: str(r['pipeline'], 'pipeline'),
        model: str(r['model'], 'model'),
        confidenceIs: str(r['confidenceIs'], 'confidenceIs'),
        regions: list(r['regions'], 'regions').map(readRegion),
      };
    }),
  };
}

export function readOcrPages(raw: unknown): readonly OcrPage[] {
  return list(raw, 'pages').map(readOcrPage);
}

export function readOcrCorrectionInput(raw: unknown): OcrCorrectionInput {
  const c = record(raw, 'correction');
  const corrected = str(c['text'], 'text').trim();
  if (corrected.length > 2000)
    throw new WireError('a line of a page is under 2000 characters');
  return {
    pageId: str(c['pageId'], 'pageId'),
    regionId: str(c['regionId'], 'regionId'),
    pipeline: str(c['pipeline'], 'pipeline'),
    text: corrected,
    by: readCuratorName(c['by']),
    note: readNote(c['note']),
  };
}

function readFields(raw: unknown, what: string): Record<EditableField, string> {
  const f = record(raw, what);
  const out = {} as Record<EditableField, string>;
  for (const field of EDITABLE_FIELDS)
    out[field] = text(f[field] ?? '', `${what} ${field}`);
  return out;
}

export function readWorkRecord(raw: unknown): WorkRecord {
  const w = record(raw, 'work');
  return {
    id: str(w['id'], 'id'),
    fields: readFields(w['fields'], 'fields'),
    submitted: readFields(w['submitted'], 'submitted'),
    edits: list(w['edits'], 'edits').map((raw) => {
      const e = record(raw, 'edit');
      return {
        field: oneOf(e['field'], EDITABLE_FIELDS, 'field'),
        was: text(e['was'], 'was'),
        value: str(e['value'], 'value'),
        by: str(e['by'], 'by'),
        at: str(e['at'], 'at'),
        note: optionalStr(e['note']),
      };
    }),
  };
}

export function readWorkRecords(raw: unknown): readonly WorkRecord[] {
  return list(raw, 'works').map(readWorkRecord);
}

export function readMetadataEditInput(raw: unknown): MetadataEditInput {
  const m = record(raw, 'edit');
  const value = str(m['value'], 'value').trim();
  if (value.length > 600)
    throw new WireError('a metadata value must be under 600 characters');
  return {
    workId: str(m['workId'], 'workId'),
    field: oneOf(m['field'], EDITABLE_FIELDS, 'field'),
    value,
    by: readCuratorName(m['by']),
    note: readNote(m['note']),
  };
}

export function readIngestItem(raw: unknown): IngestItem {
  const i = record(raw, 'ingest item');
  const d = i['rightsDecision'];
  let rightsDecision: RightsDecision | null = null;
  if (d !== null && d !== undefined) {
    const r = record(d, 'rights decision');
    rightsDecision = {
      by: str(r['by'], 'by'),
      at: str(r['at'], 'at'),
      note: optionalStr(r['note']),
    };
  }
  const bytes = i['bytes'];
  return {
    id: str(i['id'], 'id'),
    title: str(i['title'], 'title'),
    format: text(i['format'] ?? '', 'format'),
    stage: oneOf(i['stage'], INGEST_STAGES, 'stage'),
    bytes: typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : null,
    retrieved: optionalStr(i['retrieved']),
    rights: text(i['rights'] ?? '', 'rights'),
    rightsRecorded: text(i['rightsRecorded'] ?? '', 'rightsRecorded'),
    rightsDecision,
    fixity: oneOf(i['fixity'], FIXITY_STATES, 'fixity'),
    fixityCheckedAt: optionalStr(i['fixityCheckedAt']),
  };
}

export function readIngestItems(raw: unknown): readonly IngestItem[] {
  return list(raw, 'items').map(readIngestItem);
}

export function readFixityResult(raw: unknown): FixityResult {
  const f = record(raw, 'fixity');
  return {
    id: str(f['id'], 'id'),
    fixity: oneOf(f['fixity'], FIXITY_STATES, 'fixity'),
    checkedAt: str(f['checkedAt'], 'checkedAt'),
  };
}

export function readRightsInput(raw: unknown): CuratorNote & { readonly id: string } {
  const r = record(raw, 'rights');
  return {
    id: str(r['id'], 'id'),
    by: readCuratorName(r['by']),
    note: readNote(r['note']),
  };
}

/**
 * Whether an item still needs a curator. The queue is everything that has not
 * reached the AIP intact with its rights checked by a person.
 */
export function needsCurator(item: IngestItem): boolean {
  return (
    item.stage !== 'archived' ||
    item.fixity === 'changed' ||
    item.fixity === 'missing' ||
    item.rightsDecision === null
  );
}
