'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Citation, Field, Rule } from '@/design/primitives';
import { createSearchClient, type SearchClient } from '@/search/client';
import type { SearchHit, SearchResponse } from '@/search/types';
import { useT } from '@/i18n';
import styles from './search.module.css';

/**
 * Search harness for step 3. The Reading Room in step 6 replaces this with the
 * real reading surface; this exists to prove retrieval works on the device and
 * to measure the two second contract against a real browser.
 */

function Highlighted({ hit }: { hit: SearchHit }) {
  const text = hit.passage.text;
  if (hit.spans.length === 0) return <>{text}</>;
  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  hit.spans.forEach(([start, end], i) => {
    if (start < cursor) return;
    if (start > cursor) pieces.push(text.slice(cursor, start));
    pieces.push(
      <mark key={i} className={styles.mark}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) pieces.push(text.slice(cursor));
  return <>{pieces}</>;
}

export default function SearchPage() {
  const t = useT();
  const clientRef = useRef<SearchClient | null>(null);
  const [stage, setStage] = useState('starting');
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = createSearchClient();
    clientRef.current = client;
    const off = client.onProgress(setStage);
    client.ready
      .then((manifest) => {
        setReady(true);
        setCount(manifest.count);
        setStage('ready');
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      off();
      client.dispose();
    };
  }, []);

  const run = useCallback(async () => {
    const client = clientRef.current;
    if (client === null || query.trim().length === 0) return;
    try {
      setResponse(await client.search(query, 10));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [query]);

  const status = useMemo(() => {
    if (error !== null) return error;
    if (!ready) return `loading index: ${stage}`;
    if (response === null) return `${count} passages, on this device`;
    return `${response.hits.length} results in ${response.tookMs}ms (embed ${response.embedMs}ms)`;
  }, [error, ready, stage, response, count]);

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <h1 style={{ fontSize: 'var(--t-title)' }}>{t('field.search.label')}</h1>
        <span className={styles.status} data-testid="status">
          {status}
        </span>
      </div>
      <Rule section />

      <div className={styles.results}>
        {response === null ? (
          <p className={styles.empty}>{t('field.search.placeholder')}</p>
        ) : (
          response.hits.map((hit) => (
            <Card key={hit.chunkId} className={styles.hit}>
              {hit.passage.speaker !== null && (
                <span className={styles.speaker}>{hit.passage.speaker}</span>
              )}
              <p className={`${styles.passage} selectable`}>
                <Highlighted hit={hit} />
              </p>
              <Citation citation={hit.passage.citation} block />
              <span className={styles.scores}>
                <span>rrf {hit.score.toFixed(4)}</span>
                <span>dense {hit.dense === null ? 'miss' : hit.dense.toFixed(3)}</span>
                <span>bm25 {hit.lexical === null ? 'miss' : hit.lexical.toFixed(2)}</span>
              </span>
            </Card>
          ))
        )}
      </div>

      <div className={styles.bar}>
        <div className={styles.field}>
          <Field
            label={t('field.search.label')}
            placeholder={t('field.search.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run();
            }}
            disabled={!ready}
            data-testid="query"
          />
        </div>
        <Button variant="primary" onClick={() => void run()} disabled={!ready}>
          {t('action.search')}
        </Button>
      </div>
    </main>
  );
}
