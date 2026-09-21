/**
 * A visitor's dossier: the passages they chose to keep. PS clause R20,
 * "search, study, listen to, and compile".
 *
 * An item is stored as the raw record it came from and read back through the
 * citation contract, so a dossier cannot hold, or later show, a passage that
 * has lost its source. It holds nothing about the visitor: no times, no order
 * of reading, only what they kept.
 */

import { readChunk } from './ingest.ts';
import type { CitedPassage } from './citation.ts';

/** Enough for a five minute visit, and small enough to fit in one QR code. */
export const DOSSIER_LIMIT = 16;

export interface DossierItem {
  /**
   * Where the passage is. A block of a printed page is "<pageId>~<block>"; a
   * paragraph of a sitting or an article is its own id.
   */
  readonly ref: string;
  readonly passage: CitedPassage;
}

/** The stored form: a raw chunk plus the ref. */
export interface StoredItem {
  readonly ref: string;
  readonly corpus: string;
  readonly workId: string;
  readonly pageId: string;
  readonly locator: unknown;
  readonly language: string;
  readonly speaker: string | null;
  readonly text: string;
}

const REF = /^[a-z0-9][a-z0-9._-]{0,127}(?:~\d{1,3})?$/i;

export function refFor(passage: CitedPassage, block: number | null): string {
  const id = passage.citation.pageId;
  return block === null ? id : `${id}~${block}`;
}

export function parseRef(ref: string): { pageId: string; block: number | null } | null {
  if (!REF.test(ref)) return null;
  const [pageId, block] = ref.split('~');
  return { pageId: pageId!, block: block === undefined ? null : Number(block) };
}

export function store(item: DossierItem): StoredItem {
  const { passage } = item;
  return {
    ref: item.ref,
    corpus: passage.citation.corpus,
    workId: passage.citation.workId,
    pageId: passage.citation.pageId,
    locator: passage.citation.locator,
    language: passage.language,
    speaker: passage.speaker,
    text: passage.text,
  };
}

/** Read stored items back through the contract. An item that fails is dropped, and counted. */
export function restore(raw: unknown): { items: DossierItem[]; refused: number } {
  const items: DossierItem[] = [];
  let refused = 0;
  if (!Array.isArray(raw)) return { items, refused };
  for (const entry of raw) {
    try {
      const e = entry as Partial<StoredItem>;
      if (typeof e.ref !== 'string' || parseRef(e.ref) === null)
        throw new Error('bad ref');
      items.push({ ref: e.ref, passage: readChunk(e) });
    } catch {
      refused++;
    }
  }
  return { items, refused };
}

/** Add, keeping the first save of a passage and the limit. */
export function add(
  items: readonly DossierItem[],
  item: DossierItem,
): readonly DossierItem[] {
  if (items.some((i) => i.ref === item.ref)) return items;
  if (items.length >= DOSSIER_LIMIT) return items;
  return [...items, item];
}

export function remove(
  items: readonly DossierItem[],
  ref: string,
): readonly DossierItem[] {
  return items.filter((i) => i.ref !== ref);
}

/** A dossier kept without a card, carried onto a card when one is tapped. */
export function merge(
  onCard: readonly DossierItem[],
  local: readonly DossierItem[],
): readonly DossierItem[] {
  return local.reduce<readonly DossierItem[]>((acc, item) => add(acc, item), onCard);
}
