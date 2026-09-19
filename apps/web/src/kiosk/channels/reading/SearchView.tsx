'use client';

/**
 * The Reading Room's start: suggestions, or the results of a search.
 *
 * Results are cards at thumb height, each with its source and its wear. The
 * search field itself is in the reach zone with the room's other controls,
 * because the bottom third is where a standing visitor's hand already is.
 */

import type { Citation as CitationData } from '@toran/contracts';
import { Button, Card, Citation } from '@/design/primitives';
import { useT } from '@/i18n';
import type { SearchHit, SearchResponse } from '@/search/types';
import type { Patina } from '../../visitor/patina';
import styles from './reading.module.css';

/**
 * Visitors at a kiosk rarely type, so a standing visitor reaches a real page
 * in one tap. Each is a search this corpus answers well.
 */
export const SUGGESTED = [
  'Annihilation of Caste',
  'Mahad',
  'Article 17',
  'Kalaram temple',
] as const;

export function SearchView({
  ready,
  query,
  response,
  patina,
  onSearch,
  onOpen,
}: {
  ready: boolean;
  query: string;
  response: SearchResponse | null;
  patina: Patina;
  onSearch: (query: string) => void;
  onOpen: (citation: CitationData, hit: SearchHit) => void;
}) {
  const t = useT();

  if (!ready) return <p className={styles.quiet}>{t('kiosk.loading')}</p>;

  if (query === '') {
    return (
      <div className={styles.suggest}>
        <p className={styles.quiet}>{t('kiosk.suggest')}</p>
        <div className={styles.suggestRow}>
          {SUGGESTED.map((s) => (
            <Button key={s} variant="secondary" onClick={() => onSearch(s)}>
              {s}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  if (response === null) return <p className={styles.quiet}>{t('reading.searching')}</p>;

  if (response.hits.length === 0) {
    return <p className={styles.quiet}>{t('reading.none', { query })}</p>;
  }

  return (
    <div className={styles.results} data-testid="kiosk-results">
      {response.hits.map((hit) => (
        <Card
          key={hit.chunkId}
          interactive
          patina={patina.level(hit.passage.citation.pageId)}
          className={styles.hit}
          onClick={() => onOpen(hit.passage.citation, hit)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen(hit.passage.citation, hit);
            }
          }}
          data-testid="reading-hit"
        >
          {hit.passage.speaker !== null && (
            <span className={styles.speaker}>{hit.passage.speaker}</span>
          )}
          <p className={styles.hitText}>{hit.passage.text}</p>
          <Citation citation={hit.passage.citation} block />
        </Card>
      ))}
    </div>
  );
}
