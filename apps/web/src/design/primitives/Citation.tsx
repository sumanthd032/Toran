'use client';

import type { Citation as CitationData } from '@toran/contracts';
import { useT, type MessageKey } from '@/i18n';
import styles from './Citation.module.css';

const CORPUS_KEY = {
  baws: 'citation.corpus.baws',
  cad: 'citation.corpus.cad',
  constitution: 'citation.corpus.constitution',
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
export function Citation({
  citation,
  block = false,
  translatedFrom = null,
}: CitationProps) {
  const t = useT();
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
      parts.push(t('citation.article', { article: l.article }));
      break;
    }
  }

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
      <span className={styles.corpus}>{t(CORPUS_KEY[citation.corpus])}</span>
      <span className={styles.locator}>{parts.join(', ')}</span>
      {inferred && (
        <span className={styles.inferred} title={t('citation.inferred.explain')}>
          {t('citation.inferred')}
        </span>
      )}
    </cite>
  );
}
