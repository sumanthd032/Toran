'use client';

/**
 * The Reading Room. PROJECT.md 7.1: search the corpus, read it as printed,
 * keep what matters.
 *
 * Three views and a history. Back, Home and Forward walk the history (the
 * only navigation a kiosk has). Turning a page replaces the current entry
 * rather than adding one, so Back from page 52, reached by turning from 47,
 * goes to the results a visitor came from, not through every page between.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Abstract, Citation as CitationData, Translation } from '@toran/contracts';
import { Button } from '@/design/primitives';
import { useI18n } from '@/i18n';
import {
  abstractOf,
  openCitation,
  sectionOf,
  translationOf,
  type ArchiveSection,
  type ArchiveWork,
  type OpenedDocument,
} from '@/archive/client';
import type { SearchClient } from '@/search/client';
import { sharedSearch } from '@/search/shared';
import type { SearchHit, SearchResponse } from '@/search/types';
import { ICON, Icon } from '../../icons';
import { useChannelNav } from '../../nav';
import { ReachTools } from '../../reach';
import { refFor } from '../../visitor/dossier';
import { useVisitor } from '../../visitor/VisitorProvider';
import { DocumentView, type Chosen, type Hit } from './DocumentView';
import { hitMarks } from './highlight';
import { DossierView } from './DossierView';
import { SearchView } from './SearchView';
import styles from './reading.module.css';

/** What opening a document needs: its id and the kind of thing it is. */
interface Target {
  readonly pageId: string;
  readonly locator: { readonly kind: CitationData['locator']['kind'] };
}

type View =
  | { readonly kind: 'search'; readonly query: string }
  | { readonly kind: 'document'; readonly target: Target; readonly hit: Hit | null }
  | { readonly kind: 'dossier' };

const HOME: View = { kind: 'search', query: '' };

interface Loaded {
  readonly key: string;
  readonly opened: OpenedDocument;
  readonly context: { work: ArchiveWork; section: ArchiveSection } | null;
  readonly abstract: Abstract | null;
  readonly translation: Translation | null;
}

const keyOf = (t: Target, hit: Hit | null) => `${t.pageId}|${hit?.text ?? ''}`;
const targetOf = (c: CitationData): Target => ({
  pageId: c.pageId,
  locator: { kind: c.locator.kind },
});

export function ReadingRoom({ live }: { live: boolean }) {
  const { t, lang } = useI18n();
  const visitor = useVisitor();

  // One search engine per page (DECISIONS.md D-068). In the Twin it waits
  // until the flight has ended before it is touched.
  const client = useRef<SearchClient | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!live) return;
    const c = sharedSearch();
    client.current = c;
    let current = true;
    c.ready.then(() => current && setReady(true)).catch(() => current && setReady(false));
    return () => {
      current = false;
    };
  }, [live]);

  const [history, setHistory] = useState<{ views: readonly View[]; at: number }>({
    views: [HOME],
    at: 0,
  });
  const view = history.views[history.at] ?? HOME;
  const push = useCallback(
    (next: View) =>
      setHistory((h) => ({ views: [...h.views.slice(0, h.at + 1), next], at: h.at + 1 })),
    [],
  );
  const replace = useCallback(
    (next: View) =>
      setHistory((h) => ({
        views: h.views.map((v, i) => (i === h.at ? next : v)),
        at: h.at,
      })),
    [],
  );

  useChannelNav({
    back: () => {
      if (history.at === 0) return false;
      setHistory((h) => ({ ...h, at: h.at - 1 }));
      return true;
    },
    home: () => setHistory({ views: [HOME], at: 0 }),
    forward: () => {
      if (history.at >= history.views.length - 1) return false;
      setHistory((h) => ({ ...h, at: h.at + 1 }));
      return true;
    },
    canForward: history.at < history.views.length - 1,
  });

  // Search. Results are kept per query, so Back to a result list is instant.
  const [results, setResults] = useState<ReadonlyMap<string, SearchResponse>>(new Map());
  const [draft, setDraft] = useState('');
  const query = view.kind === 'search' ? view.query : '';
  useEffect(() => {
    if (query === '' || !ready || results.has(query)) return;
    let current = true;
    void client.current?.search(query, 8).then((response) => {
      if (current) setResults((m) => new Map(m).set(query, response));
    });
    return () => {
      current = false;
    };
  }, [query, ready, results]);
  useEffect(() => {
    if (view.kind === 'search') setDraft(view.query);
  }, [view]);

  const search = (q: string) => {
    const trimmed = q.trim();
    if (trimmed === '' || trimmed === query) return;
    push({ kind: 'search', query: trimmed });
  };

  // The document on screen, with its section, abstract and translation.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const { patina } = visitor;
  useEffect(() => {
    if (view.kind !== 'document') return;
    let current = true;
    const key = keyOf(view.target, view.hit);
    setFailed(null);
    void (async () => {
      const opened = await openCitation(view.target);
      const page = opened.document.kind === 'page' ? opened.document : null;
      const [context, abstract, translation] = await Promise.all([
        page === null ? null : sectionOf(page).then((c) => c ?? null),
        page === null || page.section === null ? null : abstractOf(page.section),
        page === null ? null : translationOf(page, lang),
      ]);
      if (!current) return;
      setLoaded({ key, opened, context, abstract, translation });
      patina.wear(opened.focus);
      // The passage a search hit landed on is chosen already, so keeping it
      // is one tap. An article, or a section of an Act, is one passage and
      // always chosen.
      const doc = opened.document;
      if (doc.kind === 'article' || doc.kind === 'section') {
        setChosen({ ref: refFor(doc.passage, null), passage: doc.passage });
      } else if (doc.kind === 'sitting') {
        const p = doc.paragraphs.find((x) => x.pageId === opened.focus);
        setChosen(
          p === undefined ? null : { ref: refFor(p.passage, null), passage: p.passage },
        );
      } else {
        const touched =
          view.hit === null
            ? []
            : [
                ...hitMarks(
                  doc.blocks.map((b) => ({
                    text: b.passage.text,
                    table: b.kind === 'table',
                  })),
                  view.hit.text,
                  view.hit.spans,
                ).blocks,
              ];
        // The first paragraph the hit runs through. A heading is not kept.
        const index = touched.find((i) => doc.blocks[i]?.kind !== 'heading');
        const block = index === undefined ? undefined : doc.blocks[index];
        setChosen(
          index === undefined || block === undefined
            ? null
            : { ref: refFor(block.passage, index), passage: block.passage },
        );
      }
    })().catch(() => {
      if (current) setFailed(view.target.pageId);
    });
    return () => {
      current = false;
    };
  }, [view, lang, patina]);

  const open = (citation: CitationData, hit: SearchHit | null = null) =>
    push({
      kind: 'document',
      target: targetOf(citation),
      hit: hit === null ? null : { text: hit.passage.text, spans: hit.spans },
    });
  const turn = (pageId: string | null) => {
    if (pageId === null) return;
    replace({
      kind: 'document',
      target: { pageId, locator: { kind: 'page' } },
      hit: null,
    });
  };

  const kept = new Set(visitor.dossier.map((i) => i.ref));
  const current =
    view.kind === 'document' && loaded?.key === keyOf(view.target, view.hit)
      ? loaded
      : null;
  const page = current?.opened.document.kind === 'page' ? current.opened.document : null;

  return (
    <div className={styles.room}>
      {view.kind === 'search' && (
        <SearchView
          ready={ready}
          query={view.query}
          response={results.get(view.query) ?? null}
          patina={patina}
          onSearch={search}
          onOpen={open}
        />
      )}
      {view.kind === 'document' &&
        (failed === view.target.pageId ? (
          <p className={styles.quiet}>{t('reading.failed')}</p>
        ) : current === null ? (
          <p className={styles.quiet}>{t('reading.opening')}</p>
        ) : (
          <DocumentView
            opened={current.opened}
            hit={view.hit}
            context={current.context}
            abstract={current.abstract}
            translation={current.translation}
            chosen={chosen?.ref ?? null}
            kept={kept}
            patina={patina.level(current.opened.focus)}
            onChoose={setChosen}
            onOpen={(c) => open(c)}
          />
        ))}
      {view.kind === 'dossier' && (
        <DossierView
          items={visitor.dossier}
          card={visitor.card !== null}
          onOpen={(c) => open(c)}
          onDiscard={visitor.discard}
        />
      )}

      <ReachTools>
        {view.kind === 'search' && (
          <form
            className={styles.searchBar}
            role="search"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              search(draft);
            }}
          >
            <input
              className={styles.searchInput}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('field.search.placeholder')}
              aria-label={t('field.search.label')}
              disabled={!ready}
              data-testid="reading-query"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={!ready}
              icon={<Icon d={ICON.search} />}
              aria-label={t('action.search')}
            >
              <span className={styles.label}>{t('action.search')}</span>
            </Button>
          </form>
        )}
        {view.kind === 'document' && page !== null && (
          <>
            <Button
              variant="secondary"
              icon={<Icon d={ICON.pagePrev} />}
              disabled={page.prev === null}
              onClick={() => turn(page.prev)}
              aria-label={t('reading.pagePrev')}
              data-testid="reading-prev"
            />
            <Button
              variant="secondary"
              icon={<Icon d={ICON.pageNext} />}
              disabled={page.next === null}
              onClick={() => turn(page.next)}
              aria-label={t('reading.pageNext')}
              data-testid="reading-next"
            />
          </>
        )}
        {view.kind === 'document' && (
          <Button
            variant="primary"
            weight="firm"
            icon={<Icon d={ICON.keep} />}
            disabled={chosen === null || kept.has(chosen.ref)}
            onClick={() => chosen !== null && visitor.keep(chosen)}
            aria-label={
              chosen !== null && kept.has(chosen.ref)
                ? t('reading.kept')
                : t('action.save')
            }
            data-testid="reading-keep"
          >
            <span className={styles.label}>
              {chosen !== null && kept.has(chosen.ref)
                ? t('reading.kept')
                : t('reading.keep')}
            </span>
          </Button>
        )}
        {view.kind !== 'dossier' && visitor.dossier.length > 0 && (
          <Button
            variant="secondary"
            icon={<Icon d={ICON.dossier} />}
            onClick={() => push({ kind: 'dossier' })}
            aria-label={t('dossier.title', { count: visitor.dossier.length })}
            data-testid="reading-dossier"
          >
            <span className={styles.label}>
              {t('dossier.title', { count: visitor.dossier.length })}
            </span>
          </Button>
        )}
      </ReachTools>
    </div>
  );
}
