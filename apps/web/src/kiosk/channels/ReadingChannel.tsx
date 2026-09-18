'use client';

/**
 * The Reading Room, as far as step 5 takes it: on-device search over the
 * archive, with every result cited. Step 6 builds the full reading surface,
 * the dual pane and the dossier.
 *
 * Suggested searches sit beside the field because visitors at a kiosk rarely
 * type, and a standing visitor should reach a real page in one tap.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Citation, Field } from '@/design/primitives';
import { useT } from '@/i18n';
import type { SearchClient } from '@/search/client';
import { sharedSearch } from '@/search/shared';
import type { SearchResponse } from '@/search/types';
import styles from '../kiosk.module.css';

const SUGGESTED = ['Annihilation of Caste', 'Article 17', 'Mahad'] as const;

export interface ReadingControls {
  home: () => void;
}

export interface ReadingChannelProps {
  onReady?: (controls: ReadingControls) => void;
  /**
   * False while the kiosk is still arriving in the Twin. Loading the model
   * then competes with the camera flight for every frame; it waits until the
   * application is fully open and the hall has stopped drawing.
   */
  live: boolean;
}

export function ReadingChannel({ onReady, live }: ReadingChannelProps) {
  const t = useT();
  const client = useRef<SearchClient | null>(null);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);

  useEffect(() => {
    if (!live) return;
    const c = sharedSearch();
    client.current = c;
    let current = true;
    c.ready.then(() => current && setReady(true)).catch(() => current && setReady(false));
    // Shared for the life of the page, so it is not disposed with this kiosk.
    return () => {
      current = false;
    };
  }, [live]);

  const run = useCallback(async (q: string) => {
    const c = client.current;
    if (c === null || q.trim() === '') return;
    setQuery(q);
    setResponse(await c.search(q, 6));
  }, []);

  useEffect(() => {
    onReady?.({
      home: () => {
        setQuery('');
        setResponse(null);
      },
    });
  }, [onReady]);

  return (
    <div className={styles.reading}>
      <div className={styles.results} data-testid="kiosk-results">
        {!ready && <p className={styles.quiet}>{t('kiosk.loading')}</p>}
        {ready && response === null && (
          <div className={styles.suggest}>
            <span className={styles.quiet}>{t('kiosk.suggest')}</span>
            <div className={styles.suggestRow}>
              {SUGGESTED.map((s) => (
                <Button key={s} variant="secondary" onClick={() => void run(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}
        {response?.hits.map((hit) => (
          <Card key={hit.chunkId} className={styles.hit}>
            {hit.passage.speaker !== null && (
              <span className={styles.speaker}>{hit.passage.speaker}</span>
            )}
            <p className={`${styles.hitText} selectable`}>{hit.passage.text}</p>
            <Citation citation={hit.passage.citation} block />
          </Card>
        ))}
      </div>
      <form
        className={styles.searchBar}
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
      >
        <div className={styles.searchField}>
          <Field
            label={t('field.search.label')}
            placeholder={t('field.search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!ready}
          />
        </div>
        <Button type="submit" variant="primary" disabled={!ready}>
          {t('action.search')}
        </Button>
      </form>
    </div>
  );
}
