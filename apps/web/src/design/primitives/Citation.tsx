'use client';

import { timecode, type Citation as CitationData } from '@toran/contracts';
import { useT, type MessageKey } from '@/i18n';
import styles from './Citation.module.css';

const CORPUS_KEY = {
  baws: 'citation.corpus.baws',
  cad: 'citation.corpus.cad',
  constitution: 'citation.corpus.constitution',
  statute: 'citation.corpus.statute',
  manuscript: 'citation.corpus.manuscript',
  media: 'citation.corpus.media',
  photograph: 'citation.corpus.photograph',
} as const satisfies Record<CitationData['corpus'], MessageKey>;

export interface CitationProps {
  citation: CitationData;
  /** Block form sits under a passage. Inline form sits within a line. */
  block?: boolean;
  /** Set when the passage shown is a translation rather than source text. */
  translatedFrom?: string | null;
}

/**
 * The only way a citation is rendered. Takes the contract object, never loose
 * strings, so a citation cannot be fabricated at the view layer.
 *
 * An inferred page number says so. The alternative is presenting a guess with
 * the same authority as a reading, which is how an archive loses its value.
 */
/**
 * A citation's words: the corpus, and the locator's parts in order. The only
 * place a citation is turned into text, so the Citation element and anything
 * else that has to print one, such as a screen drawn in the Twin's hall, say
 * exactly the same thing. D-168.
 */
export function citationParts(
  citation: CitationData,
  t: ReturnType<typeof useT>,
): { corpus: string; parts: string[]; inferred: boolean } {
  const l = citation.locator;
  const parts: string[] = [];
  let inferred = false;

  switch (l.kind) {
    case 'page': {
      if (l.volume !== null) parts.push(t('citation.volume', { volume: l.volume }));
      if (l.part !== null) parts.push(t('citation.part', { part: l.part }));
      parts.push(t('citation.page', { page: l.page }));
      inferred = !l.observed;
      break;
    }
    case 'paragraph': {
      parts.push(t('citation.volume', { volume: l.volume }));
      parts.push(t('citation.sitting', { sitting: l.sitting }));
      parts.push(t('citation.paragraph', { paragraph: l.paragraph }));
      parts.push(l.date);
      break;
    }
    case 'article': {
      const v = l.version;
      if (v === null) {
        parts.push(t('citation.article', { article: l.article }));
      } else if (v.draft) {
        // The draft the Assembly debated, and the article it became.
        parts.push(t('citation.article.draft', { article: v.article, year: v.year }));
        parts.push(t('citation.article.now', { article: l.article }));
      } else {
        parts.push(t('citation.article', { article: l.article }));
        parts.push(t('citation.article.text', { year: v.year }));
      }
      break;
    }
    case 'section': {
      parts.push(t('citation.act', { act: l.act, year: l.year }));
      parts.push(
        l.section === 'title'
          ? t('citation.section.title')
          : t('citation.section', { section: l.section }),
      );
      break;
    }
    case 'folio': {
      parts.push(
        l.folio === null
          ? t('citation.folio.unnumbered', { manuscript: l.manuscript })
          : t('citation.folio', { manuscript: l.manuscript, folio: l.folio }),
      );
      // Where the same words are in print, so a reader can go and check.
      if (l.printed !== null)
        parts.push(t('citation.folio.printed', { printed: l.printed }));
      break;
    }
    case 'plate': {
      if (l.volume !== null) parts.push(t('citation.volume', { volume: l.volume }));
      if (l.part !== null) parts.push(t('citation.part', { part: l.part }));
      parts.push(t(`citation.plate.${l.plate}`));
      break;
    }
    case 'timecode': {
      // The recording and the second it is said at. A film has no page, and
      // the timecode is what a viewer can actually go to.
      parts.push(t('citation.recording', { recording: l.recording }));
      parts.push(t('citation.at', { at: timecode(l.from) }));
      break;
    }
  }

  return { corpus: t(CORPUS_KEY[citation.corpus]), parts, inferred };
}

export function Citation({
  citation,
  block = false,
  translatedFrom = null,
}: CitationProps) {
  const t = useT();
  const { corpus, parts, inferred } = citationParts(citation, t);

  return (
    <cite
      className={[
        styles.citation,
        block ? styles.block : '',
        translatedFrom !== null ? styles.translated : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.corpus}>{corpus}</span>
      <span className={styles.locator}>{parts.join(', ')}</span>
      {/* Said on the page, not in a tooltip: a group at a kiosk sees no hover. */}
      {inferred && <span className={styles.inferred}>{t('citation.inferred')}</span>}
    </cite>
  );
}
