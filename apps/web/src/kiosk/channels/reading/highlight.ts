/**
 * Where a search hit falls on its page, and what to mark there.
 *
 * A chunk is cut from the page's text with its blocks joined by single spaces
 * (pipeline/parse/blocks.py), so a hit can start in one paragraph and end in
 * the next. Marking the whole chunk would paint most of a page, so only the
 * query's own words inside it are marked, and the paragraphs the chunk runs
 * through carry a quiet rule in the margin. A table's printed spacing does not
 * survive the join, so a table is flagged whole but never marked inside.
 */

export interface HitRange {
  readonly block: number;
  readonly start: number;
  readonly end: number;
}

export interface HitMarks {
  /** Blocks the hit runs through. */
  readonly blocks: ReadonlySet<number>;
  /** The query's words inside the hit, by block. */
  readonly marks: readonly HitRange[];
}

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

export function hitMarks(
  blocks: readonly { text: string; table: boolean }[],
  hit: string,
  spans: readonly (readonly [number, number])[],
): HitMarks {
  const texts = blocks.map((b) => flat(b.text));
  const needle = flat(hit);
  const at = needle === '' ? -1 : texts.join(' ').indexOf(needle);
  if (at < 0) return { blocks: new Set(), marks: [] };
  const end = at + needle.length;
  const touched = new Set<number>();
  const marks: HitRange[] = [];
  let offset = 0;
  texts.forEach((text, block) => {
    const from = offset;
    const to = offset + text.length;
    if (Math.max(at, from) < Math.min(end, to)) {
      touched.add(block);
      if (!blocks[block]!.table) {
        for (const [s, e] of spans) {
          const a = Math.max(at + s, from);
          const b = Math.min(at + e, to);
          if (a < b) marks.push({ block, start: a - from, end: b - from });
        }
      }
    }
    offset = to + 1;
  });
  return {
    blocks: touched,
    marks: marks.sort((x, y) => x.block - y.block || x.start - y.start),
  };
}
