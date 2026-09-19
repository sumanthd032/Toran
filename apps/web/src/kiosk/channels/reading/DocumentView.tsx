'use client';

/**
 * A document, as printed.
 *
 * A page of Writings and Speeches is set as its page: the running head and
 * the page's citation at the top, then its headings, paragraphs and tables in
 * printed order, a paragraph carried over from the page before set without
 * its indent. In an archive the page is the citable unit, so the page is what
 * a visitor reads (PROJECT.md 7.1). Beside it sits the section's abstract,
 * each sentence with its page, and a tap on one opens that page.
 *
 * Where the archive holds the page in the visitor's language, the translation
 * sits beside the original, block for block, and the two scroll together, so
 * two people at one kiosk can read the same page in two languages.
 *
 * A passage is chosen by holding a finger on it, or by focusing it.
 */

import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import type {
  Abstract,
  Citation as CitationData,
  CitedPassage,
  ReadingArticle,
  ReadingPage,
  ReadingSitting,
  Translation,
} from '@toran/contracts';
import { Citation, type PatinaLevel } from '@/design/primitives';
import { useT } from '@/i18n';
import type { ArchiveSection, ArchiveWork, OpenedDocument } from '@/archive/client';
import { refFor } from '../../visitor/dossier';
import { hitMarks, type HitRange } from './highlight';
import { usePress } from './usePress';
import styles from './reading.module.css';

export interface Chosen {
  readonly ref: string;
  readonly passage: CitedPassage;
}

/** A search hit: its text, and where the query's own words are in it. */
export interface Hit {
  readonly text: string;
  readonly spans: readonly (readonly [number, number])[];
}

export interface DocumentViewProps {
  opened: OpenedDocument;
  /** The search hit this document was opened from, to mark where it falls. */
  hit: Hit | null;
  context: { work: ArchiveWork; section: ArchiveSection } | null;
  abstract: Abstract | null;
  translation: Translation | null;
  chosen: string | null;
  kept: ReadonlySet<string>;
  patina: PatinaLevel;
  onChoose: (chosen: Chosen) => void;
  onOpen: (citation: CitationData) => void;
}

/** "Narake, Hari; Kasare, M. L. (editors)" becomes "Hari Narake, M. L. Kasare". */
function editorsOf(creator: string): string | null {
  if (!/\(editors\)\s*$/.test(creator)) return null;
  return creator
    .replace(/\(editors\)\s*$/, '')
    .split(';')
    .map((name) =>
      name
        .trim()
        .split(',')
        .map((part) => part.trim())
        .reverse()
        .join(' '),
    )
    .filter(Boolean)
    .join(', ');
}

function marked(text: string, ranges: readonly HitRange[]): ReactNode {
  if (ranges.length === 0) return text;
  const out: ReactNode[] = [];
  let at = 0;
  for (const r of ranges) {
    if (r.start > at) out.push(text.slice(at, r.start));
    out.push(<mark key={r.start}>{text.slice(r.start, r.end)}</mark>);
    at = r.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/**
 * The two panes scroll together by structure, not by proportion: the block at
 * the top of one is brought to the top of the other, at the same fraction of
 * its height, so a long Marathi paragraph stays beside its English original.
 */
function useScrollLock(
  a: RefObject<HTMLDivElement | null>,
  b: RefObject<HTMLDivElement | null>,
  on: boolean,
) {
  useEffect(() => {
    const x = a.current;
    const y = b.current;
    if (!on || x === null || y === null) return;
    let echo: HTMLElement | null = null;
    const follow = (from: HTMLElement, to: HTMLElement) => () => {
      if (echo === from) {
        echo = null;
        return;
      }
      const top = from.scrollTop;
      let current: HTMLElement | undefined;
      for (const el of from.querySelectorAll<HTMLElement>('[data-block]')) {
        if (current === undefined || el.offsetTop <= top + 1) current = el;
        if (el.offsetTop > top + 1) break;
      }
      if (current === undefined) return;
      const fraction = (top - current.offsetTop) / Math.max(1, current.offsetHeight);
      const twin = to.querySelector<HTMLElement>(
        `[data-block="${current.dataset['block']}"]`,
      );
      if (twin === null) return;
      echo = to;
      to.scrollTop = twin.offsetTop + fraction * twin.offsetHeight;
    };
    const fx = follow(x, y);
    const fy = follow(y, x);
    x.addEventListener('scroll', fx, { passive: true });
    y.addEventListener('scroll', fy, { passive: true });
    return () => {
      x.removeEventListener('scroll', fx);
      y.removeEventListener('scroll', fy);
    };
  }, [a, b, on]);
}

function AbstractPanel({
  abstract,
  here,
  onOpen,
}: {
  abstract: Abstract;
  here: string;
  onOpen: (citation: CitationData) => void;
}) {
  const t = useT();
  return (
    <aside
      className={styles.abstract}
      aria-label={t('reading.abstract')}
      data-testid="reading-abstract"
    >
      <h3 className={styles.abstractTitle}>{t('reading.abstract')}</h3>
      <ol className={styles.abstractList}>
        {abstract.sentences.map((s, i) => (
          <li key={i}>
            <button
              type="button"
              className={styles.abstractSentence}
              aria-current={s.citation.pageId === here ? 'page' : undefined}
              onClick={() => onOpen(s.citation)}
            >
              {s.speaker !== null && <span className={styles.speaker}>{s.speaker}</span>}
              <span className={styles.abstractText}>{s.text}</span>
              <Citation citation={s.citation} block />
            </button>
          </li>
        ))}
      </ol>
      <p className={styles.abstractNote}>
        {abstract.chosenBy === 'editor'
          ? t('reading.abstract.editor')
          : t('reading.abstract.machine')}
      </p>
    </aside>
  );
}

function PageView({
  page,
  hit,
  context,
  abstract,
  translation,
  chosen,
  kept,
  patina,
  onChoose,
  onOpen,
}: Omit<DocumentViewProps, 'opened'> & { page: ReadingPage }) {
  const t = useT();
  const original = useRef<HTMLDivElement>(null);
  const translated = useRef<HTMLDivElement>(null);
  const found = useMemo(
    () =>
      hit === null
        ? null
        : hitMarks(
            page.blocks.map((b) => ({ text: b.passage.text, table: b.kind === 'table' })),
            hit.text,
            hit.spans,
          ),
    [page, hit],
  );
  const choose = (i: number) => {
    const block = page.blocks[i];
    if (block !== undefined)
      onChoose({ ref: refFor(block.passage, i), passage: block.passage });
  };
  const press = usePress((key) => choose(Number(key)));
  useScrollLock(original, translated, translation !== null);

  useEffect(() => {
    const target = original.current?.querySelector('[data-hit]') ?? null;
    if (target !== null) target.scrollIntoView({ block: 'start' });
    else original.current?.scrollTo({ top: 0 });
  }, [page, hit]);

  const editors = context === null ? null : editorsOf(context.work.creator);

  const blocks = (source: 'original' | 'translation') =>
    page.blocks.map((block, i) => {
      const passage = source === 'original' ? block.passage : translation!.blocks[i]!;
      const ref = refFor(block.passage, i);
      const mine =
        source === 'original' && found !== null
          ? found.marks.filter((r) => r.block === i)
          : [];
      const inHit = source === 'original' && found !== null && found.blocks.has(i);
      if (block.kind === 'heading') {
        return (
          <h3
            key={i}
            data-block={i}
            data-hit={inHit || undefined}
            className={styles.printedHeading}
            data-align={block.align}
          >
            {marked(passage.text, mine)}
          </h3>
        );
      }
      const choosable = {
        'data-choose': source === 'original' ? String(i) : undefined,
        tabIndex: source === 'original' ? 0 : undefined,
        onFocus: source === 'original' ? () => choose(i) : undefined,
        'aria-current':
          chosen === ref && source === 'original' ? ('true' as const) : undefined,
        'data-kept': kept.has(ref) || undefined,
        'data-hit': inHit || undefined,
      };
      if (block.kind === 'table' && source === 'original') {
        return (
          <pre key={i} data-block={i} {...choosable} className={styles.table}>
            {block.layout}
          </pre>
        );
      }
      return (
        <p
          key={i}
          data-block={i}
          {...choosable}
          className={styles.para}
          data-continued={block.continued || undefined}
        >
          {marked(passage.text, mine)}
        </p>
      );
    });

  return (
    <article
      className={styles.document}
      data-patina={patina}
      data-testid="reading-document"
    >
      <header className={styles.docHead}>
        <p className={styles.runningHead}>
          <span className={styles.head}>{page.head ?? ''}</span>
          <Citation citation={page.citation} />
        </p>
        {editors !== null && (
          <p className={styles.editors}>{t('reading.editedBy', { names: editors })}</p>
        )}
      </header>
      <div
        className={styles.docBody}
        data-abstract={abstract !== null || undefined}
        data-dual={translation !== null || undefined}
      >
        {abstract !== null && (
          <AbstractPanel abstract={abstract} here={page.pageId} onOpen={onOpen} />
        )}
        <div
          className={styles.pane}
          ref={original}
          lang={page.blocks[0]?.passage.language}
          data-testid="reading-page"
          {...press}
        >
          {blocks('original')}
        </div>
        {translation !== null && (
          <div
            className={styles.pane}
            ref={translated}
            lang={translation.language}
            data-testid="reading-translation"
          >
            <p className={styles.translationSource}>
              {t('reading.translatedBy', { source: translation.source })}
            </p>
            {blocks('translation')}
          </div>
        )}
      </div>
    </article>
  );
}

function SittingView({
  sitting,
  focus,
  hit,
  chosen,
  kept,
  onChoose,
}: {
  sitting: ReadingSitting;
  focus: string;
  hit: Hit | null;
  chosen: string | null;
  kept: ReadonlySet<string>;
  onChoose: (chosen: Chosen) => void;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const byId = useMemo(
    () => new Map(sitting.paragraphs.map((p) => [p.pageId, p])),
    [sitting],
  );
  const choose = (pageId: string) => {
    const p = byId.get(pageId);
    if (p !== undefined) onChoose({ ref: refFor(p.passage, null), passage: p.passage });
  };
  const press = usePress(choose);
  useEffect(() => {
    pane.current
      ?.querySelector(`[data-choose="${focus}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [focus]);
  const first = sitting.paragraphs[0];

  return (
    <article className={styles.document} data-testid="reading-document">
      <header className={styles.docHead}>
        <p className={styles.runningHead}>
          {first !== undefined && <Citation citation={first.passage.citation} />}
        </p>
      </header>
      <div className={styles.pane} ref={pane} data-testid="reading-page" {...press}>
        {sitting.paragraphs.map((p) => {
          const ref = refFor(p.passage, null);
          const ranges =
            hit !== null && p.pageId === focus
              ? hitMarks([{ text: p.passage.text, table: false }], hit.text, hit.spans)
                  .marks
              : [];
          return (
            <section
              key={p.pageId}
              className={styles.speech}
              data-choose={p.pageId}
              data-procedural={p.procedural || undefined}
              data-focus={p.pageId === focus || undefined}
              data-kept={kept.has(ref) || undefined}
              aria-current={chosen === ref ? 'true' : undefined}
              tabIndex={0}
              onFocus={() => choose(p.pageId)}
            >
              {p.passage.speaker !== null && (
                <span className={styles.speaker}>{p.passage.speaker}</span>
              )}
              <p className={styles.para}>{marked(p.passage.text, ranges)}</p>
              <Citation citation={p.passage.citation} />
            </section>
          );
        })}
      </div>
    </article>
  );
}

function ArticleView({
  article,
  chosen,
  kept,
  onChoose,
}: {
  article: ReadingArticle;
  chosen: string | null;
  kept: ReadonlySet<string>;
  onChoose: (chosen: Chosen) => void;
}) {
  const t = useT();
  const ref = refFor(article.passage, null);
  const press = usePress(() => onChoose({ ref, passage: article.passage }));
  return (
    <article className={styles.document} data-testid="reading-document">
      <div className={styles.pane} data-testid="reading-page" {...press}>
        <h3 className={styles.articleHead}>
          {t('citation.article', { article: article.article })}. {article.heading}
        </h3>
        <p
          className={styles.articleText}
          data-choose="article"
          data-kept={kept.has(ref) || undefined}
          aria-current={chosen === ref ? 'true' : undefined}
          tabIndex={0}
          onFocus={() => onChoose({ ref, passage: article.passage })}
        >
          {article.passage.text}
        </p>
        <Citation citation={article.passage.citation} block />
      </div>
    </article>
  );
}

export function DocumentView(props: DocumentViewProps) {
  const { document, focus } = props.opened;
  switch (document.kind) {
    case 'page':
      return <PageView {...props} page={document} />;
    case 'sitting':
      return (
        <SittingView
          sitting={document}
          focus={focus}
          hit={props.hit}
          chosen={props.chosen}
          kept={props.kept}
          onChoose={props.onChoose}
        />
      );
    case 'article':
      return (
        <ArticleView
          article={document}
          chosen={props.chosen}
          kept={props.kept}
          onChoose={props.onChoose}
        />
      );
  }
}
