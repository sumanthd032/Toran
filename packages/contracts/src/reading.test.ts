/**
 * The whole reading copy, read through the citation contract.
 *
 * Runs against the published archive, so it proves the contract holds for
 * the data the kiosks actually load, not for a fixture shaped to pass. On a
 * fresh clone without the data it skips and says how to build it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { CitationError } from './citation.ts';
import {
  readAbstract,
  readArticle,
  readPage,
  readSitting,
  readTranslation,
} from './reading.ts';

const ARCHIVE = new URL('../../../apps/web/public/archive/', import.meta.url);
const built = fs.existsSync(new URL('manifest.json', ARCHIVE));
const skip = built ? false : 'reading copy not built: run npm run build:data';

const load = (rel: string): unknown =>
  JSON.parse(fs.readFileSync(new URL(rel, ARCHIVE), 'utf8'));

interface Manifest {
  works: { id: string; pages: string[] }[];
  sittings: { id: string }[];
  articles: { pageId: string }[];
}

test('every printed page reads into the contract', { skip }, () => {
  const manifest = load('manifest.json') as Manifest;
  const refused: string[] = [];
  let read = 0;
  for (const work of manifest.works) {
    for (const pageId of work.pages) {
      try {
        const page = readPage(load(`pages/${pageId}.json`));
        assert.equal(page.pageId, pageId);
        read++;
      } catch (error) {
        refused.push(`${pageId}: ${(error as Error).message}`);
      }
    }
  }
  assert.deepEqual(refused, []);
  assert.ok(read > 1000, `${read} pages read`);
});

test('every sitting and article reads into the contract', { skip }, () => {
  const manifest = load('manifest.json') as Manifest;
  for (const s of manifest.sittings) {
    const sitting = readSitting(load(`sittings/${s.id}.json`));
    assert.ok(sitting.paragraphs.length > 0);
    for (const p of sitting.paragraphs)
      assert.equal(p.passage.citation.locator.kind, 'paragraph');
  }
  for (const a of manifest.articles) {
    assert.equal(
      readArticle(load(`articles/${a.pageId}.json`)).passage.citation.locator.kind,
      'article',
    );
  }
});

test('every abstract sentence is verbatim on the page it cites', { skip }, () => {
  const raw = load('abstracts.json') as { sections: Record<string, unknown> };
  const missing: string[] = [];
  for (const [id, entry] of Object.entries(raw.sections)) {
    const abstract = readAbstract(id, entry);
    for (const sentence of abstract.sentences) {
      const page = readPage(load(`pages/${sentence.citation.pageId}.json`));
      const body = page.blocks.map((b) => b.passage.text).join(' ');
      if (!body.includes(sentence.text))
        missing.push(`${id}: ${sentence.text.slice(0, 60)}`);
    }
  }
  assert.deepEqual(missing, []);
});

const PAGE = {
  pageId: 'baws-v1-p0079',
  workId: 'baws-v1',
  corpus: 'baws',
  locator: { kind: 'page', volume: 1, part: null, page: 47, observed: true },
  language: 'en',
  head: 'ANNIHILATION OF CASTE',
  section: 'baws-v1-s02',
  prev: null,
  next: null,
  blocks: [{ kind: 'paragraph', text: 'Caste is a notion, it is a state of the mind.' }],
};

test('a page without a locator is refused, not shown', () => {
  assert.throws(() => readPage({ ...PAGE, locator: undefined }), CitationError);
});

test('a block of an unknown kind is refused', () => {
  assert.throws(
    () => readPage({ ...PAGE, blocks: [{ kind: 'marginalia', text: 'x' }] }),
    CitationError,
  );
});

test('an abstract that does not say who chose it is refused', () => {
  const sentence = {
    text: 'Caste is a notion.',
    pageId: PAGE.pageId,
    locator: PAGE.locator,
  };
  assert.throws(
    () =>
      readAbstract('s', {
        workId: 'baws-v1',
        corpus: 'baws',
        language: 'en',
        sentences: [sentence],
      }),
    CitationError,
  );
});

test('a translation is cited to the page it translates, and says so', () => {
  const page = readPage(PAGE);
  const t = readTranslation(page, {
    language: 'mr',
    source: 'test fixture',
    blocks: [{ text: 'जात ही एक कल्पना आहे.' }],
  });
  assert.equal(t.blocks[0]?.translatedFrom, 'en');
  assert.equal(t.blocks[0]?.citation.pageId, PAGE.pageId);
  assert.throws(
    () => readTranslation(page, { language: 'mr', source: 'x', blocks: [] }),
    CitationError,
  );
});
