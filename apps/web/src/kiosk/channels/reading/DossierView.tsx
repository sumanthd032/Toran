'use client';

/**
 * The visitor's dossier: what they kept, each with its source, and the code
 * that takes it home. PS clause R20, "compile".
 *
 * The code holds page references, not the visitor. With a card, the dossier
 * also goes to every other kiosk the card is tapped at; without one, the code
 * is how it leaves this kiosk, before the session ends.
 */

import { useEffect, useState } from 'react';
import type { Citation as CitationData } from '@toran/contracts';
import { Button, Card, Citation } from '@/design/primitives';
import { useI18n } from '@/i18n';
import { ICON, Icon } from '../../icons';
import type { DossierItem } from '../../visitor/dossier';
import { dossierUrl } from '../../visitor/link';
import { QrCode } from '../../visitor/QrCode';
import styles from './reading.module.css';

/**
 * Where the take-home link points. A kiosk is configured with the archive's
 * public address at build time; without one, the link points at this origin,
 * which is right for a demonstration on one machine and wrong for a phone.
 */
function useOrigin(): string | null {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    // Dot access only: Next inlines NEXT_PUBLIC_ variables it can see written this way.
    setOrigin(process.env.NEXT_PUBLIC_TORAN_PUBLIC_ORIGIN ?? window.location.origin);
  }, []);
  return origin;
}

export function DossierView({
  items,
  card,
  onOpen,
  onDiscard,
}: {
  items: readonly DossierItem[];
  card: boolean;
  onOpen: (citation: CitationData) => void;
  onDiscard: (ref: string) => void;
}) {
  const { t, lang } = useI18n();
  const origin = useOrigin();

  if (items.length === 0) {
    return (
      <p className={styles.empty} data-testid="dossier-empty">
        {t('dossier.empty')}
      </p>
    );
  }

  return (
    <div className={styles.dossier} data-testid="dossier">
      <ol className={styles.keptList}>
        {items.map((item) => (
          <li key={item.ref}>
            <Card className={styles.kept} data-testid="dossier-item">
              {item.passage.speaker !== null && (
                <span className={styles.speaker}>{item.passage.speaker}</span>
              )}
              <p className={styles.hitText}>{item.passage.text}</p>
              <Citation citation={item.passage.citation} block />
              <div className={styles.keptActions}>
                <Button variant="secondary" onClick={() => onOpen(item.passage.citation)}>
                  {t('dossier.open')}
                </Button>
                <Button
                  variant="quiet"
                  icon={<Icon d={ICON.remove} />}
                  onClick={() => onDiscard(item.ref)}
                  aria-label={t('dossier.remove')}
                >
                  <span className={styles.label}>{t('dossier.remove')}</span>
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      {origin !== null && (
        <figure className={styles.takeHome}>
          <QrCode
            value={dossierUrl(
              origin,
              items.map((i) => i.ref),
              lang,
            )}
            label={t('dossier.qr.label', { count: items.length })}
          />
          <figcaption>
            <strong>{t('dossier.qr.title')}</strong>
            <span>{t('dossier.qr.caption')}</span>
            <span className={styles.quiet}>
              {card ? t('dossier.onCard') : t('dossier.noCard')}
            </span>
          </figcaption>
        </figure>
      )}
    </div>
  );
}
