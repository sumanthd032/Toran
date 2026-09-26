/**
 * Publishes the reading copy of the archive for the kiosks.
 *
 * Reads the DIP (data/dip/pages.jsonl, sittings.jsonl, articles.jsonl,
 * acts.jsonl and works.json) and writes apps/web/public/archive/: a manifest,
 * and one small file per printed page, per sitting, per article and per
 * section of an Act, so opening a page on a kiosk fetches a few kilobytes
 * rather than a volume.
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
const acts = lines('acts.jsonl');

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

// Only what this build writes is cleared. The graph, the timeline, the scans,
// the abstracts and the prepared answers share this directory and come from
// other builds, one of them from Groq, so clearing the whole directory here
// deleted them. The Curator Console republishes through this build after a
// metadata edit, so it has to leave the rest alone.
const OWNED = ['pages', 'sittings', 'articles', 'acts', 'translations', 'narration', 'manifest.json'];
for (const owned of OWNED) fs.rmSync(path.join(OUT, owned), { recursive: true, force: true });
for (const dir of ['pages', 'sittings', 'articles', 'acts']) fs.mkdirSync(path.join(OUT, dir), { recursive: true });
const write = (rel, value) => fs.writeFileSync(path.join(OUT, rel), JSON.stringify(value));

const manifest = { works: [], sittings: [], sittingOf: {}, articles: [], actSections: [], translations: {}, narration: [], spokenUi: [] };

for (const work of works) {
  const workPages = pages.filter((p) => p.workId === work.id);
  const entry = {
    id: work.id,
    title: work.title,
    // Named on screen: volume 17 is an edited compilation, and a reader
    // should not take every page of it for Ambedkar's own words.
    creator: work.creator,
    corpus: work.corpus,
    volume: work.volume ?? null,
    part: work.part ?? null,
    pages: workPages.map((p) => p.pageId),
    sections: [],
  };
  if (workPages.length > 0) {
    // A plate is not part of the text around it. The frontispiece stands
    // before the first chapter and has no section, and so no abstract.
    for (const page of workPages) page.section = null;
    sectionsOf(workPages.filter((p) => p.locator.kind !== 'plate')).forEach((section, i) => {
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

for (const section of acts) {
  write(`acts/${section.pageId}.json`, section);
  manifest.actSections.push({
    pageId: section.pageId,
    workId: section.workId,
    act: section.act,
    year: section.year,
    section: section.section,
    heading: section.heading,
  });
}

// Translations, where any exist: data/dip/translations/<language>/<pageId>.json.
// The manifest lists them, so a kiosk never asks for one that is not there.
const TRANSLATIONS = path.join(DIP, 'translations');
if (fs.existsSync(TRANSLATIONS)) {
  for (const language of fs.readdirSync(TRANSLATIONS)) {
    fs.mkdirSync(path.join(OUT, 'translations', language), { recursive: true });
    manifest.translations[language] = [];
    for (const file of fs.readdirSync(path.join(TRANSLATIONS, language))) {
      fs.copyFileSync(path.join(TRANSLATIONS, language, file), path.join(OUT, 'translations', language, file));
      manifest.translations[language].push(file.replace(/\.json$/, ''));
    }
  }
}

// Narration, where any exists: data/dip/narration/<language>/<id>.<voice>.wav,
// with an index that carries each clip's citation. The manifest repeats the
// index so a kiosk learns what it can play in one fetch, and the Audio Booth
// can say plainly that a passage is not cached rather than failing silently.
const NARRATION = path.join(DIP, 'narration');
const narrationIndex = path.join(NARRATION, 'index.json');
if (fs.existsSync(narrationIndex)) {
  const { clips } = JSON.parse(fs.readFileSync(narrationIndex, 'utf8'));
  for (const c of clips) {
    const from = path.join(NARRATION, c.file);
    if (!fs.existsSync(from)) continue;
    const to = path.join(OUT, 'narration', c.file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    manifest.narration.push({
      id: c.id, language: c.language, voice: c.voice, file: c.file,
      source: c.source, text: c.text, citation: c.citation,
    });
  }
}

// Spoken interface labels, for audio-first mode. Separate from narration
// because a label cites nothing; see the narration contract.
const uiIndex = path.join(NARRATION, 'ui.json');
if (fs.existsSync(uiIndex)) {
  const { clips } = JSON.parse(fs.readFileSync(uiIndex, 'utf8'));
  for (const c of clips) {
    const from = path.join(NARRATION, c.file);
    if (!fs.existsSync(from)) continue;
    const to = path.join(OUT, 'narration', c.file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    manifest.spokenUi.push({
      key: c.key, language: c.language, voice: c.voice,
      file: c.file, source: c.source, text: c.text,
    });
  }
}

write('manifest.json', manifest);

const sections = manifest.works.reduce((n, w) => n + w.sections.length, 0);
const titled = manifest.works.reduce((n, w) => n + w.sections.filter((s) => s.head !== null).length, 0);
console.log(
  `archive: ${pages.length} pages in ${sections} sections (${titled} titled), ` +
    `${sittings.length} sittings, ${articles.length} articles, ${acts.length} sections of Acts, ` +
    `${Object.values(manifest.translations).flat().length} translated pages, ` +
    `${manifest.narration.length} narration clips, ` +
    `${manifest.spokenUi.length} spoken labels`,
);
for (const w of manifest.works) {
  if (w.sections.length === 0) continue;
  console.log(`  ${w.id}`);
  for (const s of w.sections) console.log(`    ${s.id}  ${String(s.pages).padStart(3)} pp  ${s.head ?? '(untitled)'}`);
}
