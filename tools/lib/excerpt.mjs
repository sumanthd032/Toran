/**
 * Verbatim excerpts from the reading copy, for the builders that curate: the
 * Timeline Wall's events and the Provenance Graph's evidence.
 *
 * A curator names where a passage is and its first and last words. `resolve`
 * finds those words in the record, lifts exactly the text between them, and
 * returns it with the record's own locator, as a chunk that readChunk accepts.
 * `problems` says whether the excerpt reads as whole sentences and keeps its
 * quotation marks paired. Nothing is paraphrased; a phrase that is not found
 * is a failure for a person to fix, never a guess.
 *
 * Where a passage can be: { work, page } or { work, plate } for a printed
 * volume, { paragraph } for a debate record, { article } or { article,
 * version } for the Constitution and its drafting history, { act, section }
 * for an Act.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIP = 'data/dip';

const jsonl = (file) =>
  fs
    .readFileSync(path.join(DIP, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

export const pages = jsonl('pages.jsonl');
export const sittings = jsonl('sittings.jsonl');
export const articles = jsonl('articles.jsonl');
export const acts = jsonl('acts.jsonl');

export const flat = (s) => s.replace(/\s+/g, ' ').trim();

const OPEN = /[“‘]/g;
const CLOSE = /[”’]/g;

/** The excerpt between two phrases, across the blocks of one record. */
export function lift(texts, from, to) {
  for (let i = 0; i < texts.length; i++) {
    const start = texts[i].indexOf(from);
    if (start === -1) continue;
    let joined = texts[i].slice(start);
    for (let j = i; j < texts.length; j++) {
      if (j > i) joined += ` ${texts[j]}`;
      const end = joined.indexOf(to);
      if (end !== -1) {
        const before = texts[i].slice(0, start);
        const after = joined.slice(end + to.length);
        return { text: joined.slice(0, end + to.length), before, after };
      }
    }
  }
  return null;
}

/** Why an excerpt does not read as a whole, if it does not. Lines are exempt from sentence shape. */
export function problems(found, lines) {
  const out = [];
  if (!lines) {
    if (found.before !== '' && !/[.!?:;”"’)]\s*$/.test(found.before) && !/[“"‘(]\s*$/.test(found.before)) {
      out.push('does not start a sentence');
    }
    if (!/[.!?]["”’)]?$/.test(found.text)) out.push('does not end a sentence');
    if (found.after !== '' && !/^["”’)]?\s|^["”’)]?\d|^$/.test(found.after)) out.push('stops mid word');
  }
  const opened = (found.text.match(OPEN) ?? []).length;
  const closed = (found.text.match(CLOSE) ?? []).length;
  if (opened !== closed) {
    out.push(`leaves ${opened > closed ? 'a quotation open' : 'a quotation closed that it never opened'}`);
  }
  return out;
}

/**
 * A located, verbatim excerpt: `record` is a chunk without its text,
 * `found.text` the excerpt, `context` the whole record's text (for checking a
 * date against the page), `where` a short label for build logs.
 */
export function resolve(spec) {
  if (spec.paragraph !== undefined) {
    for (const s of sittings) {
      const p = s.paragraphs.find((x) => x.pageId === spec.paragraph);
      if (p === undefined) continue;
      const found = lift([flat(p.text)], spec.from, spec.to);
      return (
        found && {
          found,
          record: {
            corpus: s.corpus,
            workId: s.workId,
            pageId: p.pageId,
            locator: {
              kind: 'paragraph',
              volume: s.volume,
              sitting: s.sitting,
              paragraph: p.paragraph,
              date: s.date,
              procedural: p.procedural,
            },
            language: s.language,
            speaker: p.speaker ?? null,
          },
          // A debate paragraph is dated by its sitting.
          context: s.date,
          where: `${s.volume}.${s.sitting}.${p.paragraph}${p.procedural ? '+' : ''}`,
        }
      );
    }
    return null;
  }
  if (spec.article !== undefined) {
    const a = articles.find((x) => x.pageId === spec.article);
    if (a === undefined) return null;
    const version =
      spec.version === undefined ? null : a.versions.find((v) => v.ordinal === spec.version);
    if (spec.version !== undefined && version === undefined) return null;
    const found = lift([flat(version === null ? a.text : version.text)], spec.from, spec.to);
    return (
      found && {
        found,
        record: {
          corpus: a.corpus,
          workId: a.workId,
          pageId: a.pageId,
          locator:
            version === null
              ? { kind: 'article', article: a.article }
              : {
                  kind: 'article',
                  article: a.article,
                  version: {
                    ordinal: version.ordinal,
                    article: version.article,
                    year: version.year,
                    draft: version.draft,
                  },
                },
          language: a.language,
          speaker: null,
        },
        context: version === null ? '' : String(version.year),
        where: version === null ? `art ${a.article}` : `art ${a.article} v${version.ordinal}`,
      }
    );
  }
  if (spec.act !== undefined) {
    const s = acts.find((x) => x.workId === spec.act && x.section === spec.section);
    if (s === undefined) return null;
    const found = lift([flat(s.text)], spec.from, spec.to);
    return (
      found && {
        found,
        record: {
          corpus: s.corpus,
          workId: s.workId,
          pageId: s.pageId,
          locator: { kind: 'section', act: s.act, year: s.year, section: s.section },
          language: s.language,
          speaker: null,
        },
        context: String(s.year),
        where: `${s.workId} s. ${s.section}`,
      }
    );
  }
  // A printed number can repeat: volume 17 numbers an inserted blank leaf 25
  // as well as the page after it. The excerpt has to settle which one.
  const matches = pages.filter(
    (p) =>
      p.workId === spec.work &&
      (spec.plate !== undefined
        ? p.locator.kind === 'plate' && p.locator.plate === spec.plate
        : p.locator.kind === 'page' && p.locator.page === spec.page) &&
      p.blocks.some((b) => flat(b.text).includes(spec.from)),
  );
  if (matches.length > 1) {
    throw new Error(
      `${spec.work} ${spec.plate ?? `p${spec.page}`}: ${matches.length} pages hold "${spec.from}", need exactly one`,
    );
  }
  if (matches.length === 0) return null;
  const page = matches[0];
  const texts = page.blocks.map((b) => flat(b.text));
  const found = lift(texts, spec.from, spec.to);
  const l = page.locator;
  return (
    found && {
      found,
      record: {
        corpus: page.corpus,
        workId: page.workId,
        pageId: page.pageId,
        locator: l,
        language: page.language,
        speaker: null,
      },
      context: texts.join(' '),
      where:
        l.kind === 'plate'
          ? `vol ${l.volume} ${l.plate}`
          : `vol ${l.volume}${l.part ? `.${l.part}` : ''} p${l.page}`,
    }
  );
}
