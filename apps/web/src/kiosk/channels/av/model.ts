'use client';

/**
 * Searching inside a recording.
 *
 * Two searches, because they answer two different questions and a visitor
 * needs both. A literal find runs over the cues already on the device and is
 * instant, which is what somebody wants when they half remember a phrase they
 * just heard. A semantic search runs against the device's own index, where
 * every cue sits beside the books and the debates in one vector space, and it
 * is what lets an English question land on a Hindi sentence in a film.
 *
 * The second is the one that matters for the claim in PROJECT.md 7.6, and it
 * is also the one that needs a 118 MB model to load. So the literal find
 * answers immediately and the semantic results join it when the engine is
 * ready, rather than a visitor watching a disabled field.
 */

import type { CitedPassage, Recording, TranscriptCue } from '@toran/contracts';

export interface Match {
  readonly recording: Recording;
  readonly cue: TranscriptCue;
  /** How it was found. The screen says which, because they mean different things. */
  readonly how: 'literal' | 'meaning';
  /** Character offsets of the query in the cue, for a literal match only. */
  readonly spans: readonly [start: number, end: number][];
}

/** Enough to fill the panel without making a visitor scroll a result list. */
export const MATCH_LIMIT = 12;

const fold = (text: string): string =>
  text
    .toLowerCase()
    // Devanagari combining marks vary between what a keyboard produces and
    // what a speech model writes, so a find that ignores them finds more.
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Every cue containing the query, in the order they are spoken.
 *
 * Deliberately a substring match rather than a token match: a visitor typing
 * into this field is quoting something they heard, and "the four-fold" should
 * find "the four-fold division" without a tokeniser deciding what a word is in
 * two scripts at once.
 */
export function findLiteral(
  recordings: readonly Recording[],
  query: string,
): readonly Match[] {
  const needle = fold(query.trim());
  if (needle.length < 2) return [];
  const matches: Match[] = [];
  for (const recording of recordings) {
    for (const cue of recording.cues) {
      const hay = fold(cue.passage.text);
      const at = hay.indexOf(needle);
      if (at === -1) continue;
      matches.push({
        recording,
        cue,
        how: 'literal',
        // Folding preserves length for everything but combining marks, so the
        // offset holds for the scripts this archive is in. A span that does
        // not line up would highlight the wrong words, so it is dropped rather
        // than guessed.
        spans: hay.length === cue.passage.text.length ? [[at, at + needle.length]] : [],
      });
      if (matches.length >= MATCH_LIMIT) return matches;
    }
  }
  return matches;
}

/**
 * How many hits to ask the index for before keeping the film ones.
 *
 * Most of the index is print, so a search for a phrase spoken in a documentary
 * competes with four thousand printed chunks. Over-fetching is cheaper than
 * teaching the worker about corpora, and it keeps one ranking rather than two.
 */
export const OVERFETCH = MATCH_LIMIT * 6;

/**
 * The cues among a set of search hits, whatever language either was in.
 *
 * Pure, so it is tested in Node without a worker: the component does the
 * searching and hands the results here. A hit that is not a cue is dropped,
 * which is what makes this the film half of a search that also spans the books.
 */
export function cuesAmong(
  recordings: readonly Recording[],
  passages: readonly CitedPassage[],
): readonly Match[] {
  const byRecording = new Map(recordings.map((r) => [r.id, r]));
  const matches: Match[] = [];
  for (const passage of passages) {
    const locator = passage.citation.locator;
    if (locator.kind !== 'timecode') continue;
    const recording = byRecording.get(locator.recording);
    if (recording === undefined) continue;
    const cue = recording.cues.find(
      (c) => c.from === locator.from && c.to === locator.to,
    );
    if (cue === undefined) continue;
    matches.push({ recording, cue, how: 'meaning', spans: [] });
    if (matches.length >= MATCH_LIMIT) break;
  }
  return matches;
}

/** Literal first, then anything the index found that the text did not. */
export function merge(
  literal: readonly Match[],
  meaning: readonly Match[],
): readonly Match[] {
  const seen = new Set(literal.map((m) => m.cue.id));
  return [...literal, ...meaning.filter((m) => !seen.has(m.cue.id))].slice(
    0,
    MATCH_LIMIT,
  );
}

/**
 * The cues around one, for the panel that opens beside a result.
 *
 * A line of transcript on its own is a fragment. Two either side is enough to
 * see what was being said without turning the result list into a reading view.
 */
export function context(
  recording: Recording,
  cue: TranscriptCue,
  either = 2,
): readonly TranscriptCue[] {
  const at = recording.cues.indexOf(cue);
  if (at === -1) return [cue];
  return recording.cues.slice(Math.max(0, at - either), at + either + 1);
}
