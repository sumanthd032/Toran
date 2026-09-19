/**
 * Patina: passages and years wear with use, the way a well read book falls
 * open at the page everyone turns to. DECISIONS.md D-024.
 *
 * Aggregate and anonymous by construction. The store holds a count against a
 * key and nothing else: no times, no sessions, no order. A key counts once per
 * visitor session however often it is opened, so one person cannot wear a
 * page out, and what is shown is a level of wear, never the count, so a
 * visitor cannot read off what the person before them opened.
 *
 * Counts are per device until Toran Core pools them across the fleet in
 * step 10.
 */

import type { KeyValue } from './store.ts';

export type PatinaLevel = 0 | 1 | 2 | 3 | 4;

/** Opens needed for each level of wear. The first level needs a few visitors. */
export const PATINA_THRESHOLDS = [3, 8, 20, 50] as const;

const KEY = 'toran.patina';

export function levelOf(count: number): PatinaLevel {
  let level = 0;
  for (const threshold of PATINA_THRESHOLDS) if (count >= threshold) level++;
  return level as PatinaLevel;
}

export class Patina {
  private readonly kv: KeyValue;
  private counts: Record<string, number>;
  /** Keys this visitor session has already worn. Memory only; never stored. */
  private seen = new Set<string>();

  constructor(kv: KeyValue) {
    this.kv = kv;
    this.counts = {};
    try {
      const raw = kv.getItem(KEY);
      const parsed: unknown = raw === null ? {} : JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'number' && Number.isInteger(v) && v > 0) this.counts[k] = v;
        }
      }
    } catch {
      this.counts = {};
    }
  }

  /** A visitor opened something. Counts once per visitor session. */
  wear(key: string): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.counts[key] = (this.counts[key] ?? 0) + 1;
    try {
      this.kv.setItem(KEY, JSON.stringify(this.counts));
    } catch {
      // Wear is a courtesy. A full or blocked store must not break reading.
    }
  }

  level(key: string): PatinaLevel {
    return levelOf(this.counts[key] ?? 0);
  }

  /** The visitor left. Their session's keys are forgotten; the counts stay. */
  endSession(): void {
    this.seen = new Set();
  }
}
