'use client';

/**
 * The Hall panel: every switch the Twin used to hide in its address. D-167.
 *
 * Four groups. How this viewer sees the hall. The visitor at a kiosk that is
 * open, played from here since the Twin has no sensor or reader. The Twin
 * itself: language, motion, graphics, the entry flight, a tour. And, for a
 * curator with the key, the living hall itself, which every viewer shares.
 *
 * It docks at the side rather than covering the hall, so a kiosk stays in
 * view and in use while a visitor is stepped nearer to it or a card is laid
 * down. The controls are sized for a desk and a mouse: this is the Twin's
 * chrome, not a kiosk.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { CORE_API, language as languageInfo } from '@toran/contracts';
import { OperatorGate } from '@/curator/OperatorGate';
import { useOperator } from '@/curator/operator';
import { useFleet } from '@/fleet/FleetProvider';
import { loadedLanguages, useI18n, type MessageKey } from '@/i18n';
import { twinVisitor, type TwinDistance } from '@/kiosk/sensor/twinVisitor';
import { hallSettings, useHallSettings, type Quality } from './settings';
import { openMode, type OpenMode } from './transition/store';
import styles from './hall.module.css';

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  lang,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; lang?: string }[];
  onChange: (value: T) => void;
  lang?: boolean;
}) {
  return (
    <fieldset className={styles.choice}>
      <legend>{label}</legend>
      <div className={styles.options}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={styles.option}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {lang === true ? <span lang={o.lang}>{o.label}</span> : o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      {children}
    </section>
  );
}

/** Start and stop the simulated visitors, for everyone. Needs the curator key. */
function LivingHall() {
  const { t } = useI18n();
  const { base, call } = useOperator();
  const { refresh } = useFleet();
  const [running, setRunning] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (base === null) return;
    let live = true;
    fetch(`${base}${CORE_API}/hall`, { cache: 'no-store' })
      .then((r) =>
        r.ok ? (r.json() as Promise<{ available: boolean; running: boolean }>) : null,
      )
      .then((h) => live && setRunning(h?.available === true ? h.running : null))
      .catch(() => live && setRunning(null));
    return () => {
      live = false;
    };
  }, [base]);

  if (running === null) return <p className={styles.note}>{t('hall.living.none')}</p>;
  const set = (next: boolean) => {
    setFailed(false);
    void call(
      'PUT',
      '/hall',
      { running: next },
      (raw) => raw as { running: boolean },
    ).then((r) => {
      if (r.ok) {
        setRunning(r.value.running);
        refresh();
      } else setFailed(true);
    });
  };
  return (
    <>
      <Choice
        label={t('hall.living.label')}
        value={running ? 'on' : 'off'}
        options={[
          { value: 'on', label: t('hall.on') },
          { value: 'off', label: t('hall.off') },
        ]}
        onChange={(v) => set(v === 'on')}
      />
      <p className={styles.note}>{t('hall.living.note')}</p>
      {failed && <p className={styles.note}>{t('curator.failure.refused')}</p>}
    </>
  );
}

export function HallPanel({
  open,
  onClose,
  deviceOpen,
  quality,
  onQuality,
  onReplay,
  onTour,
  onAbout,
}: {
  open: boolean;
  onClose: () => void;
  /** A device is open, so there is a visitor to play. */
  deviceOpen: boolean;
  quality: Quality;
  onQuality: (q: Quality) => void;
  onReplay: () => void;
  /** Starts the guided tour. */
  onTour: () => void;
  /** Shows the note a first visit opens with. */
  onAbout: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const settings = useHallSettings();
  const { source, simulated } = useFleet();
  const [mode, setMode] = useState<OpenMode>('full');
  const [standing, setStanding] = useState<TwinDistance>('reading');
  useEffect(() => openMode.subscribe(setMode), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const onOff = [
    { value: 'on', label: t('hall.on') },
    { value: 'off', label: t('hall.off') },
  ] as const;

  return (
    <aside className={styles.panel} aria-label={t('hall.title')} data-testid="hall-panel">
      <header className={styles.head}>
        <h2 className={styles.title}>{t('hall.title')}</h2>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label={t('action.close')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div className={styles.body}>
        <Group title={t('hall.group.view')}>
          <Choice
            label={t('hall.visitors')}
            value={settings.visitors ? 'on' : 'off'}
            options={onOff}
            onChange={(v) => hallSettings.set({ visitors: v === 'on' })}
          />
          {source === 'fleet' && (
            <p className={styles.note}>{t('hall.visitors.note', { count: simulated })}</p>
          )}
          <Choice
            label={t('hall.openMode')}
            value={mode}
            options={[
              { value: 'full', label: t('hall.openMode.full') },
              { value: 'hall', label: t('hall.openMode.hall') },
            ]}
            onChange={(v) => openMode.set(v)}
          />
          <Choice
            label={t('hall.status')}
            value={settings.status ? 'on' : 'off'}
            options={onOff}
            onChange={(v) => hallSettings.set({ status: v === 'on' })}
          />
        </Group>

        <Group title={t('hall.group.visitor')}>
          {deviceOpen ? (
            <>
              <Choice
                label={t('hall.visitor.where')}
                value={standing}
                options={(['away', 'passing', 'near', 'reading'] as const).map((d) => ({
                  value: d,
                  label: t(`hall.visitor.${d}` as MessageKey),
                }))}
                onChange={(d) => {
                  setStanding(d);
                  twinVisitor.stand(d);
                }}
              />
              <div className={styles.options}>
                <button
                  type="button"
                  className={styles.option}
                  onClick={() => twinVisitor.tap('a')}
                >
                  {t('hall.visitor.cardA')}
                </button>
                <button
                  type="button"
                  className={styles.option}
                  onClick={() => twinVisitor.tap('b')}
                >
                  {t('hall.visitor.cardB')}
                </button>
              </div>
              <p className={styles.note}>{t('hall.visitor.note')}</p>
            </>
          ) : (
            <p className={styles.note}>{t('hall.visitor.closed')}</p>
          )}
        </Group>

        <Group title={t('hall.group.twin')}>
          <Choice
            label={t('language.choose')}
            value={lang}
            lang
            options={loadedLanguages().map((code) => ({
              value: code,
              label: languageInfo(code)?.native ?? code,
              lang: code,
            }))}
            onChange={setLang}
          />
          <Choice
            label={t('hall.motion')}
            value={settings.motion}
            options={[
              { value: 'system', label: t('hall.motion.system') },
              { value: 'reduced', label: t('hall.motion.reduced') },
            ]}
            onChange={(v) => hallSettings.set({ motion: v })}
          />
          <Choice
            label={t('hall.quality')}
            value={quality}
            options={[
              { value: 'auto', label: t('hall.quality.auto') },
              { value: 'high', label: t('hall.quality.high') },
              { value: 'low', label: t('hall.quality.low') },
            ]}
            onChange={onQuality}
          />
          <Choice
            label={t('hall.perf')}
            value={settings.perf ? 'on' : 'off'}
            options={onOff}
            onChange={(v) => hallSettings.set({ perf: v === 'on' })}
          />
          <div className={styles.options}>
            <button
              type="button"
              className={styles.option}
              onClick={onReplay}
              disabled={deviceOpen}
            >
              {t('twin.replay')}
            </button>
            <button
              type="button"
              className={styles.option}
              onClick={onTour}
              data-testid="hall-tour"
            >
              {t('hall.tour.start')}
            </button>
            <button type="button" className={styles.option} onClick={onAbout}>
              {t('hall.about')}
            </button>
          </div>
        </Group>

        <Group title={t('hall.group.living')}>
          <OperatorGate>
            <LivingHall />
          </OperatorGate>
        </Group>
      </div>
    </aside>
  );
}
