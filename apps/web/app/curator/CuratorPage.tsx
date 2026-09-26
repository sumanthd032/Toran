'use client';

/**
 * /curator. The console on the operator's own machine, the one surface in
 * the build that expects a network: it is pointed at Core with ?core= like a
 * kiosk is, and says so when it is not. ARCHITECTURE.md section 13.
 */

import { useEffect } from 'react';
import { CuratorDesk } from '@/curator/CuratorDesk';
import { useT } from '@/i18n';
import styles from './curator-page.module.css';

export function CuratorPage() {
  const t = useT();
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    return () => document.documentElement.removeAttribute('data-theme');
  }, []);
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('curator.title')}</h1>
      <CuratorDesk />
    </main>
  );
}
