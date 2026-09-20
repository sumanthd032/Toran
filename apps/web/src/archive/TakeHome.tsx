'use client';

/**
 * What a visitor kept, on their own phone. The page a dossier's QR code opens.
 *
 * The link carries page references in its fragment, which the browser does
 * not send to any server, so opening it tells nobody what was read. This page
 * rebuilds each passage from the archive, through the citation contract, and
 * sets it with its source: a visitor takes home the words as printed and
 * where to find them, not a paraphrase.
 */

import { useEffect, useState } from 'react';
import type { CitedPassage } from '@toran/contracts';
import { Citation } from '@/design/primitives';
import { hasCatalogue, useI18n } from '@/i18n';
import { parseRef } from '@/kiosk/visitor/dossier';
import { refsFromHash } from '@/kiosk/visitor/link';
import { kindOf, openCitation } from './client';
import styles from './takehome.module.css';

async function passageFor(ref: string): Promise<CitedPassage | null> {
  const parsed = parseRef(ref);
  if (parsed === null) return null;
  const kind = await kindOf(parsed.pageId);
  const { document } = await openCitation({ pageId: parsed.pageId, locator: { kind } });
  switch (document.kind) {
    case 'page':
      return parsed.block === null
        ? null
        : (document.blocks[parsed.block]?.passage ?? null);
    case 'sitting':
      return document.paragraphs.find((p) => p.pageId === parsed.pageId)?.passage ?? null;
    case 'article':
    case 'section':
      return document.passage;
  }
}

export function TakeHome() {
  const { t, setLang } = useI18n();
  const [passages, setPassages] = useState<readonly CitedPassage[] | null>(null);
  const [missing, setMissing] = useState(0);

  // The fragment and the query exist only in the browser, so both are read
  // after mount, never during render (DECISIONS.md D-070).
  useEffect(() => {
    const lang = new URLSearchParams(window.location.search).get('lang');
    if (lang !== null && hasCatalogue(lang)) setLang(lang);
    const refs = refsFromHash(window.location.hash);
    void Promise.all(refs.map((r) => passageFor(r).catch(() => null))).then((found) => {
      setPassages(found.filter((p): p is CitedPassage => p !== null));
      setMissing(found.filter((p) => p === null).length);
    });
  }, [setLang]);

  return (
    <main className={styles.page} data-theme="light" data-testid="takehome">
      <header className={styles.head}>
        <p className={styles.place}>{t('takehome.place')}</p>
        <h1 className={styles.title}>{t('takehome.title')}</h1>
      </header>
      {passages === null && <p className={styles.note}>{t('takehome.loading')}</p>}
      {passages !== null && passages.length === 0 && missing === 0 && (
        <p className={styles.note}>{t('takehome.empty')}</p>
      )}
      {passages !== null && passages.length > 0 && (
        <ol className={styles.list}>
          {passages.map((p, i) => (
            <li key={i} className={styles.item} data-testid="takehome-passage">
              {p.speaker !== null && <span className={styles.speaker}>{p.speaker}</span>}
              <blockquote className={styles.quote} lang={p.language}>
                {p.text}
              </blockquote>
              <Citation citation={p.citation} block />
            </li>
          ))}
        </ol>
      )}
      {missing > 0 && (
        <p className={styles.note}>{t('takehome.missing', { count: missing })}</p>
      )}
      <footer className={styles.foot}>{t('takehome.note')}</footer>
    </main>
  );
}
