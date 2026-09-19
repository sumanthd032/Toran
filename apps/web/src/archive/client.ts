'use client';

/**
 * The kiosk's view of the archive's reading copy.
 *
 * Every document arrives as JSON from the device's own origin and leaves this
 * module having passed the citation contract (`readPage`, `readSitting`,
 * `readArticle`, `readAbstract`). Nothing here fetches from the network: the
 * reading copy ships with the kiosk, so reading works with the network off.
 *
 * Responses are cached for the life of the page. A printed page is a few
 * kilobytes and a visitor turns back as often as forward.
 */

import {
  readAbstract,
  readArticle,
  readPage,
  readSitting,
  readTimeline,
  readTranslation,
  type Abstract,
  type Citation,
  type ReadingDocument,
  type ReadingPage,
  type Timeline,
  type Translation,
} from '@toran/contracts';

export interface ArchiveSection {
  readonly id: string;
  /** The section title as the running head prints it. */
  readonly head: string | null;
  readonly first: string;
  readonly last: string;
  readonly pages: number;
}

export interface ArchiveWork {
  readonly id: string;
  readonly title: string;
  readonly creator: string;
  readonly corpus: string;
  readonly volume: number | null;
  readonly part: string | null;
  readonly pages: readonly string[];
  readonly sections: readonly ArchiveSection[];
}

export interface ArchiveManifest {
  readonly works: readonly ArchiveWork[];
  readonly sittings: readonly { id: string; workId: string; date: string }[];
  readonly sittingOf: Readonly<Record<string, string>>;
  readonly articles: readonly {
    pageId: string;
    workId: string;
    article: string;
    heading: string;
  }[];
  /** Pages with a translation, by language. Step 9 fills this through Bhashini. */
  readonly translations: Readonly<Record<string, readonly string[]>>;
}

export interface OpenedDocument {
  readonly document: ReadingDocument;
  /** The page, paragraph or article the citation named, to scroll to. */
  readonly focus: string;
}

const ROOT = '/archive/';
const cache = new Map<string, Promise<unknown>>();

function load(path: string): Promise<unknown> {
  let pending = cache.get(path);
  if (pending === undefined) {
    pending = fetch(ROOT + path).then((response) => {
      if (!response.ok) throw new Error(`archive: ${path} ${response.status}`);
      return response.json() as Promise<unknown>;
    });
    // A failure is not cached, so a later attempt can succeed.
    pending.catch(() => cache.delete(path));
    cache.set(path, pending);
  }
  return pending;
}

export const manifest = (): Promise<ArchiveManifest> =>
  load('manifest.json') as Promise<ArchiveManifest>;

export async function openPage(pageId: string): Promise<ReadingPage> {
  return readPage(await load(`pages/${pageId}.json`));
}

/**
 * Whatever a citation points into: a printed page, a sitting, an article.
 * Only the id and the kind of locator are needed to find it, so a caller that
 * has only those (a dossier reference, a page turn) never has to invent the
 * rest of a citation.
 */
export async function openCitation(target: {
  readonly pageId: string;
  readonly locator: { readonly kind: Citation['locator']['kind'] };
}): Promise<OpenedDocument> {
  const { pageId, locator } = target;
  switch (locator.kind) {
    case 'page':
    case 'plate':
      return { document: await openPage(pageId), focus: pageId };
    case 'paragraph': {
      const sitting = (await manifest()).sittingOf[pageId];
      if (sitting === undefined) throw new Error(`archive: no sitting holds ${pageId}`);
      return {
        document: readSitting(await load(`sittings/${sitting}.json`)),
        focus: pageId,
      };
    }
    case 'article':
      return {
        document: readArticle(await load(`articles/${pageId}.json`)),
        focus: pageId,
      };
  }
}

export async function workOf(workId: string): Promise<ArchiveWork | undefined> {
  return (await manifest()).works.find((w) => w.id === workId);
}

export async function sectionOf(
  page: ReadingPage,
): Promise<{ work: ArchiveWork; section: ArchiveSection } | undefined> {
  const work = await workOf(page.workId);
  const section = work?.sections.find((s) => s.id === page.section);
  return work !== undefined && section !== undefined ? { work, section } : undefined;
}

let abstracts: Promise<Readonly<Record<string, unknown>>> | null = null;

/** A section's abstract, if it has one. Sittings and articles do not. */
export async function abstractOf(sectionId: string): Promise<Abstract | null> {
  abstracts ??= (
    load('abstracts.json') as Promise<{ sections: Record<string, unknown> }>
  ).then((a) => a.sections);
  const raw = (await abstracts)[sectionId];
  return raw === undefined ? null : readAbstract(sectionId, raw);
}

/** A page in the visitor's language, if the archive holds one. */
export async function translationOf(
  page: ReadingPage,
  language: string,
): Promise<Translation | null> {
  if (language === page.blocks[0]?.passage.language) return null;
  const available = (await manifest()).translations[language] ?? [];
  if (!available.includes(page.pageId)) return null;
  return readTranslation(
    page,
    await load(`translations/${language}/${page.pageId}.json`),
  );
}

/** What an archive id names, from the manifest: a printed page, a paragraph of a sitting, an article. */
export async function kindOf(pageId: string): Promise<Citation['locator']['kind']> {
  const m = await manifest();
  if (m.sittingOf[pageId] !== undefined) return 'paragraph';
  if (m.articles.some((a) => a.pageId === pageId)) return 'article';
  return 'page';
}

/** The Timeline Wall's events, read through the timeline contract. */
export async function timeline(): Promise<Timeline> {
  return readTimeline(await load('timeline.json'));
}

/** Where an archive file, such as a timeline photograph, is served from. */
export function archiveUrl(file: string): string {
  return ROOT + file;
}
