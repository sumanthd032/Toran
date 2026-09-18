'use client';

import { useEffect, useState } from 'react';
import { citation, LANGUAGES } from '@toran/contracts';
import {
  Badge,
  Button,
  Card,
  Citation,
  Dialog,
  Field,
  ReachZone,
  Rule,
} from '@/design/primitives';
import { Ruler } from '@/design/system/Ruler';
import { Swatch } from '@/design/system/Swatch';
import { loadedLanguages, useI18n } from '@/i18n';
import styles from './system.module.css';

type Theme = 'light' | 'dark';

const SWATCHES: ReadonlyArray<{
  name: string;
  token: string;
  ratio: string;
  role: string;
}> = [
  { name: 'ink', token: '--text', ratio: '15.58:1', role: 'body text' },
  { name: 'ink-soft', token: '--text-soft', ratio: '7.01:1', role: 'secondary' },
  { name: 'brass', token: '--accent', ratio: '4.51:1', role: 'interactive UI' },
  { name: 'brass-deep', token: '--accent-text', ratio: '7.05:1', role: 'brass as text' },
  { name: 'sandstone', token: '--section', ratio: '5.29:1', role: 'section marks' },
  {
    name: 'sandstone-deep',
    token: '--section-text',
    ratio: '7.01:1',
    role: 'section text',
  },
  { name: 'correction', token: '--danger', ratio: '8.08:1', role: 'errors, diffs' },
  { name: 'verdigris', token: '--confirmed', ratio: '7.03:1', role: 'confirmed' },
  { name: 'rule', token: '--border', ratio: 'non-text', role: 'hairlines' },
  { name: 'vellum', token: '--surface-raised', ratio: 'surface', role: 'raised cards' },
];

const TYPE_SPECIMENS: ReadonlyArray<{
  label: string;
  size: string;
  latin: string;
  deva: string;
}> = [
  { label: 'ambient  96px', size: 'var(--t-ambient)', latin: 'Educate', deva: 'शिक्षित' },
  { label: 'display  64px', size: 'var(--t-display)', latin: 'Agitate', deva: 'संघटित' },
  { label: 'title    48px', size: 'var(--t-title)', latin: 'Organise', deva: 'संघर्ष' },
  {
    label: 'heading  32px',
    size: 'var(--t-heading)',
    latin: 'Annihilation of Caste',
    deva: 'जातिभेद निर्मूलन',
  },
];

const READING_LATIN =
  'I measure the progress of a community by the degree of progress which women have achieved.';
const READING_DEVA =
  'मी समाजाची प्रगती त्या समाजातील स्त्रियांनी केलेल्या प्रगतीवरून मोजतो.';

const SAMPLE_CITATION = citation({
  corpus: 'baws',
  workId: 'baws-v1',
  pageId: 'baws-v1-p0047',
  volume: 1,
  page: 47,
});

export default function SystemPage() {
  const { t, lang, setLang } = useI18n();
  const [theme, setTheme] = useState<Theme>('light');
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    return () => document.documentElement.removeAttribute('data-theme');
  }, [theme]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 style={{ fontSize: 'var(--t-title)' }}>{t('system.title')}</h1>
          <p style={{ color: 'var(--text-soft)' }}>{t('system.subtitle')}</p>
        </div>
        <div className={styles.controls}>
          <Button
            variant={theme === 'light' ? 'primary' : 'secondary'}
            onClick={() => setTheme('light')}
            aria-pressed={theme === 'light'}
          >
            {t('system.theme.light')}
          </Button>
          <Button
            variant={theme === 'dark' ? 'primary' : 'secondary'}
            onClick={() => setTheme('dark')}
            aria-pressed={theme === 'dark'}
          >
            {t('system.theme.dark')}
          </Button>
          <Rule orientation="vertical" />
          {loadedLanguages().map((code) => (
            <Button
              key={code}
              variant={lang === code ? 'primary' : 'secondary'}
              onClick={() => setLang(code)}
              aria-pressed={lang === code}
            >
              {LANGUAGES.find((l) => l.code === code)?.native ?? code}
            </Button>
          ))}
        </div>
      </header>

      <Rule section />

      {/* ---------------- Colour ---------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('system.section.colour')}</h2>
        <p style={{ color: 'var(--text-soft)', maxWidth: '68ch' }}>
          Every colour is a material from the building or the documents. Ratios are
          measured against the reading surface by tools/contrast-check.mjs, which reads
          the real tokens and fails the build below 7:1 for body text.
        </p>
        <div className={styles.swatches}>
          {SWATCHES.map((swatch) => (
            <Swatch key={swatch.name} {...swatch} themeKey={theme} />
          ))}
        </div>
      </section>

      <Rule section />

      {/* ---------------- Type ---------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('system.section.type')}</h2>
        <p style={{ color: 'var(--text-soft)', maxWidth: '68ch' }}>
          Devanagari metrics are set first and Latin is checked against them, so mixed
          text shares one baseline. The tinted rules below are the baseline grid at the
          current type scale. Both columns land on it.
        </p>

        {TYPE_SPECIMENS.map((spec) => (
          <div key={spec.label} className={styles.specimenRow}>
            <span className={styles.specimenLabel}>{spec.label}</span>
            <div className={styles.grid}>
              <div style={{ fontSize: spec.size, fontFamily: 'var(--font-read)' }}>
                {spec.latin}
              </div>
              <div
                lang="mr"
                style={{ fontSize: spec.size, fontFamily: 'var(--font-indic)' }}
              >
                {spec.deva}
              </div>
            </div>
          </div>
        ))}

        <span className={styles.specimenLabel}>body 24px, on the baseline grid</span>
        <div className={`${styles.grid} ${styles.baseline}`}>
          <p className="selectable">{READING_LATIN}</p>
          <p className="selectable" lang="mr">
            {READING_DEVA}
          </p>
        </div>

        <span className={styles.specimenLabel}>metadata 18px, mono</span>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-meta)' }}>
          baws-v1-p0047 &middot; sha256 4f2a91c8 &middot; ocr 0.94
        </p>
      </section>

      <Rule section />

      {/* ---------------- Primitives ---------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('system.section.primitives')}</h2>

        <span className={styles.specimenLabel}>Button, 30mm minimum, sound on press</span>
        <div className={styles.row}>
          <Button variant="primary">{t('action.search')}</Button>
          <Button variant="secondary">{t('action.listen')}</Button>
          <Button variant="quiet">{t('nav.back')}</Button>
          <Button variant="primary" weight="firm">
            {t('action.save')}
          </Button>
          <Button variant="secondary" disabled>
            {t('action.cancel')}
          </Button>
        </div>

        <span className={styles.specimenLabel}>Field</span>
        <div style={{ maxWidth: '52ch' }}>
          <Field
            label={t('field.search.label')}
            placeholder={t('field.search.placeholder')}
          />
        </div>

        <span className={styles.specimenLabel}>Citation, inline and block</span>
        <div className={styles.row}>
          <Citation citation={SAMPLE_CITATION} />
        </div>
        <Card>
          <p className="selectable">{READING_LATIN}</p>
          <Citation citation={SAMPLE_CITATION} block />
        </Card>

        <span className={styles.specimenLabel}>
          Badge, and an unconfirmed edge that cannot be styled as confirmed
        </span>
        <div className={styles.row}>
          <Badge>baws</Badge>
          <Badge tone="confirmed">{t('provenance.confirmed')}</Badge>
          <Badge tone="unconfirmed">{t('provenance.unconfirmed')}</Badge>
        </div>

        <span className={styles.specimenLabel}>
          Card with patina, from none to heaviest wear
        </span>
        <div className={styles.row}>
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <Card key={level} patina={level} interactive>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-meta)' }}>
                patina {level}
              </span>
            </Card>
          ))}
        </div>

        <span className={styles.specimenLabel}>Dialog</span>
        <div className={styles.row}>
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
        </div>
        <Dialog
          open={dialogOpen}
          title={t('language.choose')}
          onClose={() => setDialogOpen(false)}
          actions={
            <>
              <Button variant="quiet" onClick={() => setDialogOpen(false)}>
                {t('action.cancel')}
              </Button>
              <Button variant="primary" onClick={() => setDialogOpen(false)}>
                {t('action.confirm')}
              </Button>
            </>
          }
        >
          <p style={{ color: 'var(--text-soft)' }}>
            Idle timeout never raises a dialog. A kiosk session decays instead of asking
            whether anyone is still there.
          </p>
        </Dialog>

        <span className={styles.specimenLabel}>
          ReachZone, pinned to the bottom third within thumb reach
        </span>
        <div className={styles.stage}>
          <p className={styles.stageNote}>
            The upper two thirds belong to the eye. Reading content sits here, where the
            hand never goes.
          </p>
          <div className={styles.zoneGuide} />
          <ReachZone align="between">
            <Button variant="quiet">{t('nav.back')}</Button>
            <Button variant="primary">{t('action.search')}</Button>
          </ReachZone>
        </div>
      </section>

      <Rule section />

      {/* ---------------- Touch geometry ---------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('system.section.ruler')}</h2>
        <Ruler />
      </section>

      <Rule section />

      {/* ---------------- Scripts ---------------- */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('system.section.scripts')}</h2>
        <p style={{ color: 'var(--text-soft)', maxWidth: '68ch' }}>
          The 22 languages of the Eighth Schedule, plus English. Step 1 self-hosts Latin
          and Devanagari only, so the ambient script carousel may cycle just the nine
          marked below. Step 9 adds the remaining scripts.
        </p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Language</th>
              <th>Native</th>
              <th>Script</th>
              <th>Font today</th>
            </tr>
          </thead>
          <tbody>
            {LANGUAGES.map((l) => (
              <tr key={l.code}>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{l.code}</td>
                <td>{l.english}</td>
                <td className={styles.native} lang={l.code} dir={l.direction}>
                  {l.native}
                </td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{l.script}</td>
                <td className={l.fontCoverage ? styles.yes : styles.no}>
                  {l.fontCoverage ? 'yes' : 'step 9'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
