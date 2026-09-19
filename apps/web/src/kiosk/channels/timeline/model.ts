/**
 * The Timeline Wall without React: which cards are open, where a year sits on
 * the axis, what comes next in a thread, and how a date is written.
 */

import {
  compareDates,
  type HistoricalDate,
  type ThreadId,
  type Timeline,
  type TimelineEvent,
} from '@toran/contracts';

/**
 * Four people at once, the threshold M-Dimensions names (CLAUDE.md 10). The
 * wall is 2.8 m across and holds four; a smaller screen holds as many as fit
 * at a readable width, which on a tablet is two.
 */
export const MAX_CARDS = 4;

export function cardsThatFit(
  stage: { width: number; height: number },
  minCard: { width: number; height: number },
  gap: number,
): number {
  // Too short to share: a tablet held landscape shows one event at a time.
  if (minCard.width <= 0 || stage.height < minCard.height) return 1;
  return Math.min(
    MAX_CARDS,
    Math.max(1, Math.floor((stage.width + gap) / (minCard.width + gap))),
  );
}
/** How long the story holds each event when nobody is touching the wall. */
export const STORY_HOLD_MS = 14_000;
/** After the last touch, how long the wall waits before the story resumes. */
export const STORY_RESUME_MS = 20_000;
/** A card nobody has touched for this long closes, so the next family finds the wall clear. */
export const CARD_IDLE_MS = 90_000;
/** The axis shows this many years across its width, when the panel is wide enough. */
export const YEARS_IN_VIEW = 24;
/** Movement that turns a touch into a drag, in CSS pixels. */
export const DRAG_SLOP = 10;

export interface OpenCard {
  /** Stable for the life of the card, so stepping along a thread keeps its place. */
  readonly key: number;
  readonly eventId: string;
  /** Last touch on this card, from performance.now(). */
  readonly touched: number;
}

export function eventsInYear(timeline: Timeline, year: number): TimelineEvent[] {
  return timeline.events.filter((e) => e.date.year === year);
}

export function yearsWithEvents(timeline: Timeline): Map<number, number> {
  const years = new Map<number, number>();
  for (const e of timeline.events)
    years.set(e.date.year, (years.get(e.date.year) ?? 0) + 1);
  return years;
}

export function nextInThread(
  timeline: Timeline,
  event: TimelineEvent,
  thread: ThreadId,
): TimelineEvent | null {
  const after = timeline.events.slice(timeline.events.indexOf(event) + 1);
  return after.find((e) => e.threads.includes(thread)) ?? null;
}

function byDate(timeline: Timeline) {
  const at = new Map(timeline.events.map((e) => [e.id, e.date] as const));
  return (a: OpenCard, b: OpenCard) =>
    compareDates(at.get(a.eventId)!, at.get(b.eventId)!) || a.key - b.key;
}

/**
 * Opens a year: one card for each of its events that is not open already, set
 * among the others in date order so an early year opens to the left, the way
 * the axis runs. Past four, the card touched longest ago gives way, never one
 * opened by this touch.
 */
export function openYear(
  cards: readonly OpenCard[],
  timeline: Timeline,
  year: number,
  now: number,
  nextKey: () => number,
  max: number = MAX_CARDS,
): OpenCard[] {
  return openEvents(cards, timeline, eventsInYear(timeline, year), now, nextKey, max);
}

export function openEvents(
  cards: readonly OpenCard[],
  timeline: Timeline,
  events: readonly TimelineEvent[],
  now: number,
  nextKey: () => number,
  max: number = MAX_CARDS,
): OpenCard[] {
  const fresh = events
    .filter((e) => !cards.some((c) => c.eventId === e.id))
    .map((e) => ({ key: nextKey(), eventId: e.id, touched: now }));
  const kept = cards.map((c) =>
    events.some((e) => e.id === c.eventId) ? { ...c, touched: now } : c,
  );
  const all = [...kept, ...fresh];
  while (all.length > max) {
    let oldest = -1;
    all.forEach((c, i) => {
      if (fresh.includes(c)) return;
      if (oldest === -1 || c.touched < all[oldest]!.touched) oldest = i;
    });
    // More events in one year than cards: keep the first of them.
    all.splice(oldest === -1 ? all.length - 1 : oldest, 1);
  }
  return all.sort(byDate(timeline));
}

/**
 * Moves one card along a thread. It keeps its place on the wall, because the
 * person reading it is standing in front of it. If the next event is open in
 * another card already, this card closes and that one is the answer.
 */
export function stepCard(
  cards: readonly OpenCard[],
  key: number,
  eventId: string,
  now: number,
): OpenCard[] {
  const other = cards.find((c) => c.eventId === eventId && c.key !== key);
  if (other !== undefined) {
    return cards
      .filter((c) => c.key !== key)
      .map((c) => (c === other ? { ...c, touched: now } : c));
  }
  return cards.map((c) => (c.key === key ? { ...c, eventId, touched: now } : c));
}

/** The cards touched most recently, still in date order, when fewer fit. */
export function keepRecent(cards: readonly OpenCard[], n: number): OpenCard[] {
  if (cards.length <= n) return cards as OpenCard[];
  const recent = [...cards].sort((a, b) => b.touched - a.touched).slice(0, n);
  return cards.filter((c) => recent.includes(c));
}

export function touchCard(
  cards: readonly OpenCard[],
  key: number,
  now: number,
): OpenCard[] {
  return cards.map((c) => (c.key === key ? { ...c, touched: now } : c));
}

export function closeIdle(cards: readonly OpenCard[], now: number): OpenCard[] {
  const open = cards.filter((c) => now - c.touched < CARD_IDLE_MS);
  return open.length === cards.length ? (cards as OpenCard[]) : open;
}

/** The year cell a visitor sees: its left edge, in track pixels. */
export function yearLeft(year: number, first: number, yearWidth: number): number {
  return (year - first) * yearWidth;
}

export function clampOffset(
  offset: number,
  trackWidth: number,
  viewWidth: number,
): number {
  return Math.min(Math.max(0, trackWidth - viewWidth), Math.max(0, offset));
}

/** The offset that puts a year in the middle of the view. */
export function centreOn(
  year: number,
  first: number,
  yearWidth: number,
  trackWidth: number,
  viewWidth: number,
): number {
  const mid = yearLeft(year, first, yearWidth) + yearWidth / 2;
  return clampOffset(mid - viewWidth / 2, trackWidth, viewWidth);
}

/** Indian English writes the day first. */
function locale(lang: string): string {
  return lang === 'en' ? 'en-IN' : lang;
}

/** A date written in the visitor's language, to the precision the source gives. */
export function formatDate(date: HistoricalDate, lang: string): string {
  const at = new Date(Date.UTC(date.year, (date.month ?? 1) - 1, date.day ?? 1));
  const parts: Intl.DateTimeFormatOptions =
    date.day !== null
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : date.month !== null
        ? { month: 'long', year: 'numeric' }
        : { year: 'numeric' };
  return new Intl.DateTimeFormat(locale(lang), { ...parts, timeZone: 'UTC' }).format(at);
}

export function formatYear(year: number, lang: string): string {
  return new Intl.NumberFormat(locale(lang), { useGrouping: false }).format(year);
}
