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
  readAccuracy,
  readCorrection,
  readProvenance,
  readNarration,
  readUiNarration,
  readScans,
  readSection,
  readTranscription,
  readSitting,
  readTimeline,
  readTranslation,
  type Abstract,
  type Accuracy,
  type Citation,
  type Correction,
  type NarrationClip,
  type UiClip,
  type ReadingDocument,
  type ProvenanceGraph,
  type Scan,
  type Transcription,
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
  readonly actSections: readonly {
    pageId: string;
    workId: string;
    act: string;
    year: number;
    section: string;
    heading: string;
  }[];
  /** Pages with a translation, by language. Filled by npm run translate. */
  readonly translations: Readonly<Record<string, readonly string[]>>;
  /** Narration clips the device holds. Filled by npm run narrate. */
  readonly narration: readonly unknown[];
  /** Spoken interface labels for audio-first mode. npm run narrate -- --ui. */
  readonly spokenUi: readonly unknown[];
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
 * Whatever a citation points into: a printed page, a sitting, an article, a
 * section of an Act.
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
    case 'section':
      return {
        document: readSection(await load(`acts/${pageId}.json`)),
        focus: pageId,
      };
    case 'folio':
      // A manuscript leaf is a scan, not a reading copy. The Manuscript
      // Station opens it; the Reading Room has nothing to show for it.
      throw new Error(
        `archive: ${pageId} is a manuscript leaf, opened in the Manuscript Station`,
      );
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

/** What an archive id names, from the manifest: a printed page, a paragraph of a sitting, an article, a section of an Act. */
export async function kindOf(pageId: string): Promise<Citation['locator']['kind']> {
  const m = await manifest();
  if (m.sittingOf[pageId] !== undefined) return 'paragraph';
  if (m.articles.some((a) => a.pageId === pageId)) return 'article';
  if (m.actSections.some((a) => a.pageId === pageId)) return 'section';
  return 'page';
}

/** The Timeline Wall's events, read through the timeline contract. */
export async function timeline(): Promise<Timeline> {
  return readTimeline(await load('timeline.json'));
}

/** The Provenance Graph, read through the provenance contract. */
export async function provenance(): Promise<ProvenanceGraph> {
  return readProvenance(await load('graph.json'));
}

/** Every scanned page the Manuscript Station can open. */
export async function scans(): Promise<readonly Scan[]> {
  return readScans(await load('scans.json'));
}

/**
 * What the machines read from one page. A reading is checked against the
 * scan it claims to be of, so a transcription can never be shown beside a
 * different page or without that page's citation.
 */
export async function transcriptions(scan: Scan): Promise<readonly Transcription[]> {
  return Promise.all(
    scan.readBy.map(async (pipeline) =>
      readTranscription(await load(`ocr/${scan.id}.${pipeline}.json`), scan),
    ),
  );
}

/** Every curator correction the archive holds. */
export async function corrections(): Promise<readonly Correction[]> {
  const raw = await load('corrections.json');
  return Array.isArray(raw) ? raw.map(readCorrection) : [];
}

/**
 * What each OCR pipeline scored on the held-out set. Empty when nobody has
 * measured it, which the station says rather than hiding.
 */
export async function accuracy(): Promise<readonly Accuracy[]> {
  try {
    return readAccuracy(await load('accuracy.json'));
  } catch {
    return [];
  }
}

/**
 * Every narration clip on this device, read through the narration contract.
 *
 * The clips come from the manifest, which the kiosk already has, so the Audio
 * Booth learns what it can play in one fetch and can say plainly that a
 * passage is not narrated rather than asking for a file that is not there.
 */
export async function narration(): Promise<readonly NarrationClip[]> {
  return readNarration((await manifest()).narration ?? []);
}

/**
 * The spoken interface labels this device holds, for audio-first mode.
 * Empty until `npm run narrate -- --ui` has run, which the announcer handles
 * by falling back to its live region.
 */
export async function spokenInterface(): Promise<readonly UiClip[]> {
  return readUiNarration((await manifest()).spokenUi ?? []);
}

/** Where a narration clip is served from. */
export const narrationUrl = (file: string): string => `${ROOT}narration/${file}`;

/** Where an archive file, such as a timeline photograph, is served from. */
export function archiveUrl(file: string): string {
  return ROOT + file;
}
