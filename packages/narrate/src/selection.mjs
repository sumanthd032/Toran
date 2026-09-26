/**
 * Which passages the archive pays to translate and narrate.
 *
 * Not all 1,335 pages. Bhashini's free tier is shared, the kiosk ships every
 * cached file to the device, and a page nobody opens is a page nobody needs in
 * six languages. The selection is therefore derived rather than listed by
 * hand: whatever the curated surfaces already cite is what a visitor can
 * actually reach without searching, so that is what gets translated first.
 *
 * Three sources, all of them already built and already citable: the passages
 * the Timeline Wall shows, the evidence behind every Provenance Graph link,
 * and the passages a kiosk turns through in its ambient state. `--all` widens
 * it to every page in the archive, for an institution that wants the whole
 * corpus and has its own ULCA quota.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './credentials.mjs';

const ARCHIVE = path.join(ROOT, 'apps/web/public/archive');
const KIOSK = path.join(ROOT, 'apps/web/public/kiosk');

const readJson = (file) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;

/** Only a printed page has blocks to translate. A sitting or an Article is cited differently. */
const translatable = (passage) =>
  typeof passage?.pageId === 'string' &&
  (passage.locator?.kind === 'page' || passage.locator?.kind === 'plate');

function fromTimeline(into) {
  const timeline = readJson(path.join(ARCHIVE, 'timeline.json'));
  for (const event of timeline?.events ?? []) {
    for (const passage of event.passages ?? []) {
      if (translatable(passage)) into.set(passage.pageId, 'timeline');
    }
  }
}

function fromGraph(into) {
  const graph = readJson(path.join(ARCHIVE, 'graph.json'));
  for (const edge of graph?.edges ?? []) {
    for (const passage of edge.evidence ?? []) {
      if (translatable(passage)) into.set(passage.pageId, 'provenance');
    }
  }
}

function fromAmbient(into) {
  const ambient = readJson(path.join(KIOSK, 'ambient.json'));
  for (const passage of ambient ?? []) {
    if (translatable(passage)) into.set(passage.pageId, 'ambient');
  }
}

/**
 * Page ids to translate, with the surface that asked for each. Ordered, so two
 * runs against an unchanged archive translate the same pages in the same order
 * and a partial run resumes predictably.
 */
export function selectedPages({ all = false } = {}) {
  if (all) {
    const manifest = readJson(path.join(ARCHIVE, 'manifest.json'));
    const pages = (manifest?.works ?? []).flatMap((w) => w.pages ?? []);
    return pages.map((pageId) => ({ pageId, because: 'all' }));
  }
  const found = new Map();
  fromTimeline(found);
  fromGraph(found);
  fromAmbient(found);
  return [...found]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pageId, because]) => ({ pageId, because }));
}

/**
 * Short passages worth narrating: the ones a visitor meets without searching.
 * Narration is audio, and audio is large, so this stays smaller than the page
 * selection and carries the citation each clip belongs to.
 */
export function selectedPassages() {
  const out = [];
  const seen = new Set();
  const add = (id, passage, because) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, because, text: passage.text, citation: {
      corpus: passage.corpus, workId: passage.workId, pageId: passage.pageId,
      locator: passage.locator, language: passage.language, speaker: passage.speaker ?? null,
    } });
  };
  const ambient = readJson(path.join(KIOSK, 'ambient.json')) ?? [];
  ambient.forEach((p, i) => add(p.chunkId ?? `ambient-${i}`, p, 'ambient'));
  const timeline = readJson(path.join(ARCHIVE, 'timeline.json'));
  for (const event of timeline?.events ?? []) {
    (event.passages ?? []).forEach((p, i) => add(`${event.id}-${i}`, p, 'timeline'));
  }
  return out;
}

/**
 * The block of `page` a passage reproduces whole, or -1 when the passage is an
 * excerpt or its page is unknown. Matched on the printed text, so a re-ordered
 * page cannot shift a clip onto the wrong block.
 */
export function blockOf(passage, page) {
  if (page === undefined) return -1;
  return page.blocks.findIndex((b) => b.text.trim() === passage.text.trim());
}

/**
 * Where an excerpt's own translation is cached. Kept out of translations/,
 * which the archive build ships to the kiosk file by file as page translations.
 * These feed narration only.
 */
export function passageTranslation(language, passageId) {
  return path.join(ROOT, 'data/dip/passage-translations', language, `${passageId}.json`);
}

/**
 * An excerpt's cached translation, or null when there is none of the excerpt
 * as it reads now. An empty or half-written file counts as none, so an
 * interrupted run is redone rather than stopping the next one.
 */
export function cachedPassageTranslation(language, passage) {
  const file = passageTranslation(language, passage.id);
  if (!fs.existsSync(file)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    return cached.english === passage.text ? cached : null;
  } catch {
    return null;
  }
}
