'use client';

/**
 * Asking the archive a question, from a kiosk.
 *
 * Retrieval happens here, on the device, against the same index the Reading
 * Room searches. Only the generation goes to Toran Core, because only the
 * generation needs a key. That split is what keeps the search offline and
 * keeps the corpus off the server.
 *
 * Three ways this answers, in order. A prepared answer already on the device,
 * which is how the scripted demo path works with the network off. A live
 * answer from Core. A refusal that says which of those was missing, carrying
 * the passages search did find so a visitor still has somewhere to read.
 */

import {
  CORE_API,
  CORE_TIMEOUT_MS,
  questionKey,
  readReply,
  refusal,
  writeReply,
  type AssistantReply,
  type CitedPassage,
} from '@toran/contracts';
import type { CoreClient } from '@/fleet/core';
import { sharedSearch } from '@/search/shared';

/**
 * How many passages go to the model. Must match RETRIEVE in
 * apps/core/src/assistant/ask.ts, which trims to it anyway; the kiosk sends
 * this many so the numbering the model sees is the numbering it is judged on.
 */
export const RETRIEVE = 6;

/** Where the prepared answers live on the device. */
const CACHE_URL = '/archive/assistant.json';

/** The engine name a cached answer carries when nothing else named one. */
export const CACHED_ENGINE = 'prepared before the exhibition opened';

let cache: Map<string, AssistantReply> | null = null;
let cacheTried = false;

/**
 * The prepared answers, read once.
 *
 * A miss is a miss. The key is the question normalised for spacing and case
 * and nothing more, because a cache that answers a question close to the one
 * asked is a cache that answers the wrong question with a real citation
 * attached, which is worse than saying it cannot.
 */
export async function preparedAnswers(): Promise<Map<string, AssistantReply>> {
  if (cache !== null) return cache;
  const found = new Map<string, AssistantReply>();
  if (cacheTried) return found;
  cacheTried = true;
  try {
    const response = await fetch(CACHE_URL, { cache: 'force-cache' });
    if (response.ok) {
      const rows = (await response.json()) as unknown[];
      for (const row of rows) {
        try {
          const reply = readReply(row);
          found.set(questionKey(reply.question), reply);
        } catch {
          // A prepared answer that lost a citation is not shown. The build
          // wrote it; the device still refuses it.
        }
      }
    }
  } catch {
    // No cache file. Every question then needs Core.
  }
  cache = found;
  return found;
}

export interface Asked {
  readonly reply: AssistantReply;
  /** What the device's own search found, shown beside the answer either way. */
  readonly retrieved: readonly CitedPassage[];
  readonly ms: number;
}

export interface AskOptions {
  readonly core: CoreClient;
  /** Injected so a test can drive retrieval without a worker. */
  readonly retrieve?: (question: string) => Promise<readonly CitedPassage[]>;
}

async function retrieveOnDevice(question: string): Promise<readonly CitedPassage[]> {
  const client = sharedSearch();
  // The worker refuses a search that arrives before the model has loaded, and
  // the desk is the one room where a visitor can ask before the engine is up:
  // a prepared question answers off the cache in milliseconds without it. So
  // this waits rather than assuming, and `engineReady` is what the field uses
  // to say so instead of appearing to hang.
  await client.ready;
  const response = await client.search(question, RETRIEVE);
  return response.hits.map((hit) => hit.passage);
}

/** Resolves when the device's search engine can answer. Starts it if need be. */
export const engineReady = (): Promise<unknown> => sharedSearch().ready;

export async function askArchive(question: string, options: AskOptions): Promise<Asked> {
  const started = performance.now();
  const trimmed = question.trim();
  const done = (reply: AssistantReply, retrieved: readonly CitedPassage[]): Asked => ({
    reply,
    retrieved,
    ms: Math.round(performance.now() - started),
  });

  // The prepared answer first. It is on the device, it is instant, and it is
  // the one that works in a hall with no network, which is the hall this is
  // built for.
  const prepared = (await preparedAnswers()).get(questionKey(trimmed));
  if (prepared !== undefined) {
    const retrieved = prepared.kind === 'answer' ? supportOf(prepared) : prepared.nearest;
    return done(prepared, retrieved);
  }

  const retrieve = options.retrieve ?? retrieveOnDevice;
  let retrieved: readonly CitedPassage[] = [];
  try {
    retrieved = await retrieve(trimmed);
  } catch {
    retrieved = [];
  }
  if (retrieved.length === 0) {
    return done(
      refusal({ question: trimmed, because: 'nothing-retrieved', engine: CACHED_ENGINE }),
      [],
    );
  }

  const { core } = options;
  if (core.base === null || !(await core.serves('assistant'))) {
    // No server, and no prepared answer for this question. The kiosk says
    // which it was, and the passages search found are still on screen.
    return done(
      refusal({
        question: trimmed,
        because: 'unavailable',
        nearest: retrieved,
        engine: CACHED_ENGINE,
      }),
      retrieved,
    );
  }

  const live = await askCore(core, trimmed, retrieved);
  return done(
    live ??
      refusal({
        question: trimmed,
        because: 'unavailable',
        nearest: retrieved,
        engine: CACHED_ENGINE,
      }),
    retrieved,
  );
}

/**
 * The one call to Core.
 *
 * The reply is read back through the contract, so the gate runs again on this
 * side. A Core that somehow returned an uncited claim would be refused here
 * rather than rendered, which is why the gate lives in the shared package.
 */
async function askCore(
  core: CoreClient,
  question: string,
  retrieved: readonly CitedPassage[],
): Promise<AssistantReply | null> {
  if (core.base === null) return null;
  try {
    const response = await fetch(`${core.base}${CORE_API}/assistant/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question,
        passages: retrieved.map(chunkOf),
      }),
      // A question is the one interaction allowed to take longer than a touch,
      // because a visitor asked for it and the screen says it is thinking.
      signal: AbortSignal.timeout(CORE_TIMEOUT_MS * 6),
      cache: 'no-store',
    });
    if (response.status === 429) {
      return refusal({
        question,
        because: 'rate-limited',
        nearest: retrieved,
        engine: CACHED_ENGINE,
      });
    }
    if (!response.ok) return null;
    return readReply(await response.json());
  } catch {
    return null;
  }
}

/** The raw form Core reads back through the citation contract. */
export function chunkOf(passage: CitedPassage): Record<string, unknown> {
  return {
    corpus: passage.citation.corpus,
    workId: passage.citation.workId,
    pageId: passage.citation.pageId,
    locator: passage.citation.locator,
    language: passage.language,
    speaker: passage.speaker,
    text: passage.text,
  };
}

/**
 * What identifies a passage across two copies of itself.
 *
 * A reply read back from Core or off the cache builds a fresh CitedPassage for
 * every segment, so two segments citing the same page hold two objects with
 * equal contents. Numbering them by object identity gave the second one no
 * number at all. The page and the opening of the text are what make a passage
 * the same passage.
 */
const identity = (passage: CitedPassage): string =>
  `${passage.citation.pageId}:${passage.text.slice(0, 60)}`;

/** Every passage an answer rests on, once each, in the order it was cited. */
export function supportOf(reply: AssistantReply): readonly CitedPassage[] {
  if (reply.kind === 'refusal') return reply.nearest;
  const seen = new Map<string, CitedPassage>();
  for (const segment of reply.segments) {
    for (const passage of segment.support) {
      const key = identity(passage);
      if (!seen.has(key)) seen.set(key, passage);
    }
  }
  return [...seen.values()];
}

/** The number a passage carries in the answer, so a claim points at a source on screen. */
export function numberOf(
  support: readonly CitedPassage[],
  passage: CitedPassage,
): number {
  const key = identity(passage);
  return support.findIndex((p) => identity(p) === key) + 1;
}

export { writeReply };
