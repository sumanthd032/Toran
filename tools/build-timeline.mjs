/**
 * Builds the Timeline Wall's events from the archive. PROJECT.md 7.3.
 *
 * Chosen by hand, like the ambient passages, and checked against the reading
 * copy. Each event names its date and the words that support it: a page by its
 * printed number (or a plate), a debate paragraph, or an article, and the
 * first and last words of the excerpt. The script finds those words verbatim,
 * lifts exactly the text between them, and keeps the source's own locator as
 * the citation. Nothing is paraphrased and nothing is typed in from memory.
 *
 * The run fails, and writes nothing, if an excerpt is not found, does not
 * start and end on a sentence, leaves a quotation mark open, or if nothing on
 * the cited page or in the cited record states the event's year. An event's
 * date is only ever as good as the page it is cited to.
 *
 * Event titles are not here: they are interface text, in the i18n catalogues
 * under timeline.event.<id>, so every language names an event its own way
 * while the passage stays in the language it was printed in.
 *
 * Output: apps/web/public/archive/timeline.json, and the photographs from
 * data/dip/photos/ beside it. Run after build-archive.mjs, which clears the
 * directory.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIP = 'data/dip';
const OUT = 'apps/web/public/archive';

const jsonl = (file) =>
  fs
    .readFileSync(path.join(DIP, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

const pages = jsonl('pages.jsonl');
const sittings = jsonl('sittings.jsonl');
const articles = jsonl('articles.jsonl');
const photos = new Map(
  JSON.parse(fs.readFileSync(path.join(DIP, 'photos.json'), 'utf8')).map((p) => [p.id, p]),
);

const flat = (s) => s.replace(/\s+/g, ' ').trim();

export const THREADS = ['learning', 'rights', 'constitution', 'dhamma'];

// Dates are ISO, to the precision the source gives: a day, a month or a year.
const EVENTS = [
  {
    id: 'born',
    date: '1891-04-14',
    threads: [],
    photo: 'frontispiece-v17-1',
    passage: { work: 'baws-v17-1', plate: 'frontispiece', from: 'Babasaheb Dr. B.R. Ambedkar', to: '6th December 1956)', lines: true },
  },
  {
    id: 'baroda',
    date: '1913-06-04',
    threads: ['learning'],
    photo: 'columbia',
    passage: { work: 'baws-v17-1', page: 212, from: 'On June 4,1913, he signed', to: 'after completion of his studies.' },
  },
  {
    id: 'castes',
    date: '1916-05-09',
    threads: ['learning'],
    photo: 'lse',
    // A title page, set as lines rather than sentences.
    passage: { work: 'baws-v1', page: 3, from: 'Paper read before', to: 'on 9th May 1916', lines: true },
  },
  {
    id: 'mahad',
    date: '1927-03',
    threads: ['rights'],
    photo: 'mahad-flyer',
    passage: { work: 'baws-v17-1', page: 9, from: 'A Conference of the Depressed Classes', to: 'great enthusiasm prevailed.' },
  },
  {
    id: 'manusmriti',
    date: '1927-12-25',
    threads: ['rights'],
    photo: null,
    // Ambedkar's own account, given in 1938 and printed on the page that dates the bonfire.
    passage: { work: 'baws-v17-1', page: 25, from: 'While speaking of bonfire of Manusmriti', to: 'performed the deed.”' },
  },
  {
    id: 'kalaram',
    date: '1930-03-03',
    threads: ['rights'],
    photo: null,
    passage: { work: 'baws-v17-1', page: 183, from: 'This historic struggle thus commenced', to: 'closed and barricaded.' },
  },
  {
    id: 'round-table',
    date: '1930-09-06',
    threads: ['constitution'],
    photo: 'round-table',
    passage: { work: 'baws-v17-1', page: 72, from: 'Dr. Ambedkar received the invitation', to: 'on September 6, 1930.' },
  },
  {
    id: 'poona-pact',
    date: '1932-09-24',
    threads: ['rights', 'constitution'],
    photo: 'yerwada',
    passage: { work: 'baws-v17-1', page: 165, from: 'Amidst an atmosphere of joviality', to: 'as the Poona Pact.' },
  },
  {
    id: 'yeola',
    date: '1935',
    threads: ['rights', 'dhamma'],
    photo: 'yeola',
    passage: { work: 'baws-v17-1', page: 205, from: 'This Satyagraha movement went on for full six years', to: 'to go out of the Hindu fold.' },
  },
  {
    id: 'annihilation',
    date: '1936-05',
    threads: ['learning'],
    photo: 'rajgriha-1934',
    passage: { work: 'baws-v1', page: 28, from: 'The Conference was to meet in Easter', to: 'has now cancelled the Conference.' },
  },
  {
    id: 'shudras',
    date: '1946',
    threads: ['learning'],
    photo: 'rajgriha-1946',
    passage: { work: 'baws-v7', page: 239, from: 'This book is a sequel to my treatise', to: 'which was published in 1946.' },
  },
  {
    id: 'article-11',
    date: '1948-11-29',
    threads: ['constitution', 'rights'],
    photo: 'drafting-committee',
    // The Assembly's record of the vote, then the article as the Constitution now numbers it.
    passage: { paragraph: 'cad-v7-62-185-plus-98712', from: 'Article 11 was added', to: 'to the Constitution.' },
    also: { article: 'coi-art17-a17', from: '“Untouchability” is abolished', to: 'accordance with law.' },
  },
  {
    id: 'nagpur',
    date: '1956-10-14',
    threads: ['dhamma'],
    photo: 'deekshabhoomi',
    // Said at Delhi airport on 13 November 1956, a month after Nagpur.
    passage: { work: 'baws-v17-1', page: 449, from: 'I am going to administer', to: 'converted to Buddhism.' },
  },
  {
    id: 'died',
    date: '1956-12-06',
    threads: [],
    photo: 'kathmandu',
    passage: { work: 'baws-v17-1', plate: 'frontispiece', from: 'Babasaheb Dr. B.R. Ambedkar', to: '6th December 1956)', lines: true },
  },
];

const OPEN = /[“‘]/g;
const CLOSE = /[”’]/g;

/** The excerpt between two phrases, across the blocks of one record. */
function lift(texts, from, to) {
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

function problems(found, lines) {
  const out = [];
  if (lines) return out;
  if (found.before !== '' && !/[.!?:;”"’)]\s*$/.test(found.before) && !/[“"‘(]\s*$/.test(found.before)) {
    out.push('does not start a sentence');
  }
  if (!/[.!?]["”’)]?$/.test(found.text)) out.push('does not end a sentence');
  if (found.after !== '' && !/^["”’)]?\s|^["”’)]?\d|^$/.test(found.after)) out.push('stops mid word');
  return out;
}

function resolve(spec) {
  if (spec.paragraph !== undefined) {
    for (const s of sittings) {
      const p = s.paragraphs.find((x) => x.pageId === spec.paragraph);
      if (p === undefined) continue;
      const found = lift([flat(p.text)], spec.from, spec.to);
      return found && {
        found,
        record: {
          corpus: s.corpus,
          workId: s.workId,
          pageId: p.pageId,
          locator: { kind: 'paragraph', volume: s.volume, sitting: s.sitting, paragraph: p.paragraph, date: s.date, procedural: p.procedural },
          language: s.language,
          speaker: p.speaker ?? null,
        },
        // A debate paragraph is dated by its sitting.
        context: s.date,
        where: `${s.volume}.${s.sitting}.${p.paragraph}${p.procedural ? '+' : ''}`,
      };
    }
    return null;
  }
  if (spec.article !== undefined) {
    const a = articles.find((x) => x.pageId === spec.article);
    if (a === undefined) return null;
    const found = lift([flat(a.text)], spec.from, spec.to);
    return found && {
      found,
      record: {
        corpus: a.corpus,
        workId: a.workId,
        pageId: a.pageId,
        locator: { kind: 'article', article: a.article },
        language: a.language,
        speaker: null,
      },
      context: '',
      where: `art ${a.article}`,
    };
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
    throw new Error(`${spec.work} ${spec.plate ?? `p${spec.page}`}: ${matches.length} pages hold "${spec.from}", need exactly one`);
  }
  if (matches.length === 0) return null;
  const page = matches[0];
  const texts = page.blocks.map((b) => flat(b.text));
  const found = lift(texts, spec.from, spec.to);
  const l = page.locator;
  return found && {
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
    where: l.kind === 'plate' ? `vol ${l.volume} ${l.plate}` : `vol ${l.volume}${l.part ? `.${l.part}` : ''} p${l.page}`,
  };
}

const failures = [];
const events = [];
console.log('timeline events, curated and checked against the reading copy');
for (const event of EVENTS) {
  const year = event.date.slice(0, 4);
  const passages = [];
  for (const spec of [event.passage, event.also].filter(Boolean)) {
    const hit = resolve(spec);
    if (hit === null) {
      failures.push(`${event.id}: "${spec.from}" ... "${spec.to}" not found`);
      continue;
    }
    const bad = problems(hit.found, spec.lines === true);
    const opened = (hit.found.text.match(OPEN) ?? []).length;
    const closed = (hit.found.text.match(CLOSE) ?? []).length;
    if (opened !== closed) bad.push(`leaves ${opened > closed ? 'a quotation open' : 'a quotation closed that it never opened'}`);
    if (bad.length > 0) failures.push(`${event.id}: ${hit.where} ${bad.join(', ')}`);
    // Only the first passage has to date the event; the second is its sequel.
    if (passages.length === 0) {
      const inText = hit.found.text.includes(year);
      const onPage = hit.context.includes(year);
      if (!inText && !onPage) failures.push(`${event.id}: nothing at ${hit.where} states ${year}`);
      console.log(`  ${event.id.padEnd(13)} ${event.date.padEnd(11)} ${hit.where.padEnd(14)} year ${inText ? 'in the excerpt' : 'in the cited record'}  (${hit.found.text.length} chars)`);
    } else {
      console.log(`  ${''.padEnd(13)} ${''.padEnd(11)} ${hit.where.padEnd(14)} and  (${hit.found.text.length} chars)`);
    }
    passages.push({ ...hit.record, text: hit.found.text });
  }
  for (const t of event.threads) if (!THREADS.includes(t)) failures.push(`${event.id}: unknown thread ${t}`);
  let photo = null;
  if (event.photo !== null) {
    const p = photos.get(event.photo);
    if (p === undefined) {
      failures.push(`${event.id}: photograph ${event.photo} is not in data/dip/photos.json; run pipeline/photos.py`);
    } else if (p.kind === 'plate') {
      const page = pages.find((x) => x.pageId === p.pageId);
      photo = { ...p, file: `photos/${p.file}`, corpus: page.corpus, locator: page.locator };
    } else {
      photo = { ...p, file: `photos/${p.file}` };
    }
  }
  events.push({ id: event.id, date: event.date, threads: event.threads, passages, photo });
}

if (failures.length > 0) {
  for (const f of failures) console.error(`  FAIL ${f}`);
  console.error(`  ${failures.length} problems; nothing written`);
  process.exit(1);
}

fs.mkdirSync(path.join(OUT, 'photos'), { recursive: true });
for (const p of photos.values()) {
  fs.copyFileSync(path.join(DIP, 'photos', p.file), path.join(OUT, 'photos', p.file));
}
fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ range: [1891, 1956], threads: THREADS, events }));
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(1);
console.log(`  ${events.length} events, ${photos.size} photographs, timeline.json ${kb(path.join(OUT, 'timeline.json'))} KB`);
