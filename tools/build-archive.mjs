/**
 * Publishes the reading copy of the archive for the kiosks.
 *
 * Reads the DIP (data/dip/pages.jsonl, sittings.jsonl, articles.jsonl and
 * works.json) and writes apps/web/public/archive/: a manifest, and one small
 * file per printed page, per sitting and per article, so opening a page on a
 * kiosk fetches a few kilobytes rather than a volume.
 *
 * Sections are worked out here, once. A recto page prints its section's title
 * in the running head; a chapter opens on a page whose first block is a
 * heading. The abstracts builder reads the sections from the manifest.
 *
 * Run: npm run build:archive  (after npm run ingest)
 */
import fs from 'node:fs';
import path from 'node:path';

const DIP = 'data/dip';
const OUT = 'apps/web/public/archive';

const lines = (file) =>
  fs
    .readFileSync(path.join(DIP, file), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));

const works = JSON.parse(fs.readFileSync(path.join(DIP, 'works.json'), 'utf8'));
const pages = lines('pages.jsonl');
const sittings = lines('sittings.jsonl');
const articles = lines('articles.jsonl');

// A heading that opens a chapter, as opposed to a section numeral ("IV") or
// a signature. Chapter titles are words.
const opensChapter = (page) => {
  const first = page.blocks[0];
  if (first === undefined || first.kind !== 'heading' || first.align === 'right') return false;
  const text = first.text.replace(/[^A-Za-z ]/g, '').trim();
  return text.length >= 8 && !/^[IVXLCDM ]+$/.test(text);
};

/**
 * Each page takes the title its section prints. A recto has its own. Any
 * other page takes the title of the recto before it, unless a chapter opens
 * between the two, in which case it takes the title of the recto after it.
 * A sub-heading at the top of a page therefore cannot split a work: the rectos
 * on either side of it print the same title.
 */
function sectionsOf(workPages) {
  const n = workPages.length;
  const before = new Array(n).fill(null);
  const after = new Array(n).fill(null);
  const openedSince = new Array(n).fill(false);
  let last = null;
  let opened = false;
  for (let i = 0; i < n; i++) {
    const page = workPages[i];
    if (opensChapter(page)) opened = true;
    before[i] = last;
    openedSince[i] = opened;
    if (page.head !== null) {
      last = page.head;
      opened = false;
    }
  }
  let next = null;
  for (let i = n - 1; i >= 0; i--) {
    if (workPages[i].head !== null) next = workPages[i].head;
    after[i] = next;
  }
  const titles = workPages.map((page, i) => {
    if (page.head !== null) return page.head;
    if (before[i] !== null && !openedSince[i]) return before[i];
    return after[i];
  });
  const sections = [];
  titles.forEach((title, i) => {
    const current = sections[sections.length - 1];
    if (current !== undefined && current.head === title) current.pages.push(workPages[i]);
    else sections.push({ head: title, pages: [workPages[i]] });
  });
  return sections;
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const dir of ['pages', 'sittings', 'articles']) fs.mkdirSync(path.join(OUT, dir), { recursive: true });
const write = (rel, value) => fs.writeFileSync(path.join(OUT, rel), JSON.stringify(value));

const manifest = { works: [], sittings: [], sittingOf: {}, articles: [] };

for (const work of works) {
  const workPages = pages.filter((p) => p.workId === work.id);
  const entry = {
    id: work.id,
    title: work.title,
    corpus: work.corpus,
    volume: work.volume ?? null,
    part: work.part ?? null,
    pages: workPages.map((p) => p.pageId),
    sections: [],
  };
  if (workPages.length > 0) {
    sectionsOf(workPages).forEach((section, i) => {
      const id = `${work.id}-s${String(i + 1).padStart(2, '0')}`;
      entry.sections.push({
        id,
        head: section.head,
        first: section.pages[0].pageId,
        last: section.pages[section.pages.length - 1].pageId,
        pages: section.pages.length,
      });
      for (const page of section.pages) page.section = id;
    });
    workPages.forEach((page, i) => {
      write(`pages/${page.pageId}.json`, {
        ...page,
        section: page.section,
        prev: workPages[i - 1]?.pageId ?? null,
        next: workPages[i + 1]?.pageId ?? null,
      });
    });
  }
  manifest.works.push(entry);
}

for (const sitting of sittings) {
  write(`sittings/${sitting.id}.json`, sitting);
  manifest.sittings.push({
    id: sitting.id,
    workId: sitting.workId,
    date: sitting.date,
    volume: sitting.volume,
    sitting: sitting.sitting,
    paragraphs: sitting.paragraphs.length,
  });
  for (const p of sitting.paragraphs) manifest.sittingOf[p.pageId] = sitting.id;
}

for (const article of articles) {
  write(`articles/${article.pageId}.json`, article);
  manifest.articles.push({
    pageId: article.pageId,
    workId: article.workId,
    article: article.article,
    heading: article.heading,
  });
}

write('manifest.json', manifest);

const sections = manifest.works.reduce((n, w) => n + w.sections.length, 0);
const titled = manifest.works.reduce((n, w) => n + w.sections.filter((s) => s.head !== null).length, 0);
console.log(
  `archive: ${pages.length} pages in ${sections} sections (${titled} titled), ` +
    `${sittings.length} sittings, ${articles.length} articles`,
);
for (const w of manifest.works) {
  if (w.sections.length === 0) continue;
  console.log(`  ${w.id}`);
  for (const s of w.sections) console.log(`    ${s.id}  ${String(s.pages).padStart(3)} pp  ${s.head ?? '(untitled)'}`);
}
