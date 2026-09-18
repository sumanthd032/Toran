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
 * The only way a citation is rendered. Takes the contract object, never
 * loose strings, so a citation cannot be fabricated at the view layer.
 */
export function Citation({
  citation,
  block = false,
  translatedFrom = null,
}: CitationProps) {
  const t = useT();

  const parts: string[] = [];
  if (citation.volume !== null) {
    parts.push(t('citation.volume', { volume: citation.volume }));
  }
  if (citation.part !== null) {
    parts.push(t('citation.part', { part: citation.part }));
  }
  parts.push(t('citation.page', { page: citation.page }));

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
    </cite>
  );
}
