'use client';

/**
 * The visitor's own settings, at the right of the reach zone: one button that
 * shows their language, and opens their language, text size and contrast in
 * one place. The same button at every kiosk, so a visitor learns it once. A
 * card sets all three on tap; this is for a visitor without one, or who wants
 * to change their mind.
 *
 * Beside it, when the kiosk has a reader, a mark shows whether a card is held.
 */

import { useState } from 'react';
import { LANGUAGES } from '@toran/contracts';
import { Button, Dialog } from '@/design/primitives';
import { loadedLanguages, useI18n, type MessageKey } from '@/i18n';
import { ICON, Icon } from './icons';
import { useVisitor } from './visitor/VisitorProvider';
import styles from './kiosk.module.css';

const SCALES = ['default', 'large', 'largest'] as const;

const nativeName = (code: string) =>
  LANGUAGES.find((l) => l.code === code)?.native ?? code;

export function CardMark() {
  const { t } = useI18n();
  const { card, reader, taps } = useVisitor();
  if (reader === 'null') return null;
  const label = card === null ? t('visitor.card.tap') : t('visitor.card.held');
  return (
    <span
      className={styles.cardMark}
      data-held={card !== null}
      // Re-keyed on every read, so the acknowledgement plays each time.
      key={taps}
      role="status"
      aria-label={label}
      data-testid="kiosk-card"
    >
      <Icon d={ICON.card} />
    </span>
  );
}

/**
 * Language, text size, contrast and sound: the choices a card carries. The
 * same controls at the entrance, where a card is set up, and behind the
 * settings button at every kiosk.
 */
export function ProfileControls() {
  const { t, lang, setLang } = useI18n();
  const { profile, setProfile } = useVisitor();
  return (
    <>
      <fieldset className={styles.settingsGroup}>
        <legend>{t('language.choose')}</legend>
        <div className={styles.settingsRow}>
          {loadedLanguages().map((code) => (
            <Button
              key={code}
              variant={lang === code ? 'primary' : 'secondary'}
              aria-pressed={lang === code}
              onClick={() => setLang(code)}
            >
              <span lang={code}>{nativeName(code)}</span>
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.settingsGroup}>
        <legend>{t('visitor.textSize')}</legend>
        <div className={styles.settingsRow}>
          {SCALES.map((scale) => (
            <Button
              key={scale}
              variant={profile.typeScale === scale ? 'primary' : 'secondary'}
              aria-pressed={profile.typeScale === scale}
              onClick={() => setProfile({ ...profile, typeScale: scale })}
              data-testid={`kiosk-text-${scale}`}
            >
              <span className={styles.sizeSample} data-scale={scale} aria-hidden="true">
                A
              </span>
              {t(`visitor.textSize.${scale}` as MessageKey)}
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset className={styles.settingsGroup}>
        <legend>{t('visitor.contrast')}</legend>
        <div className={styles.settingsRow}>
          <Button
            variant={profile.highContrast ? 'secondary' : 'primary'}
            aria-pressed={!profile.highContrast}
            onClick={() => setProfile({ ...profile, highContrast: false })}
          >
            {t('visitor.contrast.standard')}
          </Button>
          <Button
            variant={profile.highContrast ? 'primary' : 'secondary'}
            aria-pressed={profile.highContrast}
            onClick={() => setProfile({ ...profile, highContrast: true })}
            data-testid="kiosk-contrast-high"
          >
            {t('visitor.contrast.high')}
          </Button>
        </div>
      </fieldset>
      <fieldset className={styles.settingsGroup}>
        <legend>{t('visitor.sound')}</legend>
        <div className={styles.settingsRow}>
          <Button
            variant={profile.audioFirst ? 'secondary' : 'primary'}
            aria-pressed={!profile.audioFirst}
            onClick={() => setProfile({ ...profile, audioFirst: false })}
          >
            {t('visitor.sound.standard')}
          </Button>
          <Button
            variant={profile.audioFirst ? 'primary' : 'secondary'}
            aria-pressed={profile.audioFirst}
            onClick={() => setProfile({ ...profile, audioFirst: true })}
          >
            {t('visitor.sound.louder')}
          </Button>
        </div>
      </fieldset>
    </>
  );
}

export function VisitorButton() {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        icon={<Icon d={ICON.language} />}
        aria-label={`${t('visitor.settings')}: ${nativeName(lang)}`}
        onClick={() => setOpen(true)}
        data-testid="kiosk-visitor"
      >
        <span lang={lang} className={styles.label}>
          {nativeName(lang)}
        </span>
      </Button>
      <Dialog
        open={open}
        title={t('visitor.settings')}
        onClose={() => setOpen(false)}
        actions={
          <Button variant="primary" onClick={() => setOpen(false)}>
            {t('action.close')}
          </Button>
        }
      >
        <ProfileControls />
      </Dialog>
    </>
  );
}
