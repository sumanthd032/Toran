/**
 * The Timeline Wall's events, as the archive serves them. PROJECT.md 7.3.
 *
 * An event is a date to the precision its source gives, the threads it
 * belongs to, one or two cited passages, and possibly a photograph. The
 * passages come through readChunk like every other passage, so an event
 * cannot be shown without its source. A photograph carries either what
 * Wikimedia Commons records about it, labelled as recorded, or, for a plate
 * printed in a volume, a citation to that volume.
 */

import {
  citation,
  CitationError,
  isCorpus,
  type Citation,
  type CitedPassage,
} from './citation.ts';
import { readChunk, readLocator, type RawChunk } from './ingest.ts';

export const THREADS = ['learning', 'rights', 'constitution', 'dhamma'] as const;
export type ThreadId = (typeof THREADS)[number];

/** A date as precise as its source, and no more. */
export interface HistoricalDate {
  readonly year: number;
  /** 1 to 12, or null when the source gives only the year. */
  readonly month: number | null;
  readonly day: number | null;
}

export interface CommonsPhoto {
  readonly kind: 'commons';
  /** Relative to the archive root. */
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly creator: string | null;
  /** The date Commons records for the photograph, as it records it. */
  readonly recorded: string | null;
  /** Where Commons says the file came from. Often only "Via Internet". */
  readonly credit: string | null;
  readonly licence: string;
  /** The Commons file page. */
  readonly page: string;
  readonly sha1: string;
}

export interface PlatePhoto {
  readonly kind: 'plate';
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly citation: Citation;
}

export type TimelinePhoto = CommonsPhoto | PlatePhoto;

export interface TimelineEvent {
  readonly id: string;
  readonly date: HistoricalDate;
  readonly threads: readonly ThreadId[];
  readonly passages: readonly [CitedPassage, ...CitedPassage[]];
  readonly photo: TimelinePhoto | null;
}

export interface Timeline {
  readonly range: readonly [number, number];
  /** In date order. */
  readonly events: readonly TimelineEvent[];
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

function optional(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function size(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new CitationError(`${what} must be a positive integer`);
  }
  return value;
}

const DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const FILE = /^photos\/[a-z0-9-]+\.jpg$/;
const EVENT_ID = /^[a-z0-9-]+$/;

export function readDate(raw: unknown): HistoricalDate {
  const m = DATE.exec(text(raw, 'date'));
  if (m === null) throw new CitationError(`date ${String(raw)} is not ISO`);
  const year = Number(m[1]);
  const month = m[2] === undefined ? null : Number(m[2]);
  const day = m[3] === undefined ? null : Number(m[3]);
  if (month !== null && (month < 1 || month > 12)) {
    throw new CitationError(`date ${String(raw)} has no month ${month}`);
  }
  if (day !== null) {
    const last = new Date(Date.UTC(year, month!, 0)).getUTCDate();
    if (day < 1 || day > last)
      throw new CitationError(`date ${String(raw)} has no day ${day}`);
  }
  return { year, month, day };
}

/** Orders dates, a year before any day in it, so a vague date sorts first. */
export function compareDates(a: HistoricalDate, b: HistoricalDate): number {
  return (
    a.year - b.year || (a.month ?? 0) - (b.month ?? 0) || (a.day ?? 0) - (b.day ?? 0)
  );
}

function readPhoto(raw: unknown): TimelinePhoto | null {
  if (raw === null) return null;
  const p = record(raw, 'photo');
  const file = text(p['file'], 'photo file');
  if (!FILE.test(file))
    throw new CitationError(`photo file ${file} is not an archive photograph`);
  const width = size(p['width'], 'photo width');
  const height = size(p['height'], 'photo height');
  if (p['kind'] === 'plate') {
    const corpus = p['corpus'];
    if (!isCorpus(corpus))
      throw new CitationError(`plate corpus ${String(corpus)} is unknown`);
    const locator = readLocator(p['locator']);
    if (locator.kind !== 'plate')
      throw new CitationError('a plate must be cited to a plate');
    return {
      kind: 'plate',
      file,
      width,
      height,
      citation: citation({
        corpus,
        workId: text(p['workId'], 'plate workId'),
        pageId: text(p['pageId'], 'plate pageId'),
        locator,
      }),
    };
  }
  if (p['kind'] !== 'commons')
    throw new CitationError(`photo kind ${String(p['kind'])} is unknown`);
  const licence = text(p['licence'], 'photo licence');
  // The pipeline only fetches public domain files; this refuses anything else
  // that reaches the wall by another route.
  if (!/^(public domain|pd\b)/i.test(licence)) {
    throw new CitationError(`photo licence ${licence} is not public domain`);
  }
  const page = text(p['page'], 'photo page');
  if (!page.startsWith('https://commons.wikimedia.org/wiki/File:')) {
    throw new CitationError(`photo page ${page} is not a Commons file page`);
  }
  const sha1 = text(p['sha1'], 'photo sha1');
  if (!/^[0-9a-f]{40}$/.test(sha1)) throw new CitationError('photo sha1 is not a SHA-1');
  return {
    kind: 'commons',
    file,
    width,
    height,
    title: text(p['title'], 'photo title'),
    creator: optional(p['creator']),
    recorded: optional(p['date']),
    credit: optional(p['credit']),
    licence,
    page,
    sha1,
  };
}

export function readTimeline(raw: unknown): Timeline {
  const t = record(raw, 'timeline');
  const range = t['range'];
  if (
    !Array.isArray(range) ||
    range.length !== 2 ||
    !range.every((y) => Number.isInteger(y)) ||
    range[0] >= range[1]
  ) {
    throw new CitationError('timeline range must be two years, first before last');
  }
  const [first, last] = range as [number, number];
  if (!Array.isArray(t['events']))
    throw new CitationError('timeline events must be a list');
  const seen = new Set<string>();
  const events = t['events'].map((rawEvent, i): TimelineEvent => {
    const e = record(rawEvent, `event ${i}`);
    const id = text(e['id'], `event ${i} id`);
    if (!EVENT_ID.test(id) || seen.has(id)) {
      throw new CitationError(`event id ${id} is malformed or repeated`);
    }
    seen.add(id);
    const date = readDate(e['date']);
    if (date.year < first || date.year > last) {
      throw new CitationError(`event ${id} falls outside ${first} to ${last}`);
    }
    const threads = Array.isArray(e['threads']) ? e['threads'] : [];
    for (const thread of threads) {
      if (!(THREADS as readonly unknown[]).includes(thread)) {
        throw new CitationError(`event ${id}: unknown thread ${String(thread)}`);
      }
    }
    const rawPassages = Array.isArray(e['passages']) ? e['passages'] : [];
    if (rawPassages.length === 0) throw new CitationError(`event ${id} has no passage`);
    const passages = rawPassages.map((p) => readChunk(p as RawChunk));
    return {
      id,
      date,
      threads: threads as ThreadId[],
      passages: passages as [CitedPassage, ...CitedPassage[]],
      photo: readPhoto(e['photo'] ?? null),
    };
  });
  for (let i = 1; i < events.length; i++) {
    if (compareDates(events[i - 1]!.date, events[i]!.date) > 0) {
      throw new CitationError(`event ${events[i]!.id} is out of date order`);
    }
  }
  return { range: [first, last], events };
}
