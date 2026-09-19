'use client';

/**
 * The entrance, device 13. PROJECT.md 6.3, the Sutra card.
 *
 * On the way in, a visitor chooses a language and how they want to read,
 * takes a card from the bowl and taps it here; the card carries those choices
 * to every kiosk in the hall. On the way out the same kiosk shows the code for
 * what they kept and takes the card back, erasing what it held.
 *
 * The hall's plan, drawn from where the devices actually stand, opens across
 * the whole screen from the reach zone, because at the size a standing visitor
 * can read, it does not fit beside anything else.
 */

import { useEffect, useState } from 'react';
import { LANGUAGES } from '@toran/contracts';
import { Button } from '@/design/primitives';
import { DEVICES } from '@/fleet/devices';
import { useI18n, type MessageKey } from '@/i18n';
import { ICON, Icon } from '../../icons';
import { useChannelNav } from '../../nav';
import { ReachTools } from '../../reach';
import { ProfileControls } from '../../VisitorControls';
import { dossierUrl } from '../../visitor/link';
import { QrCode } from '../../visitor/QrCode';
import { useVisitor } from '../../visitor/VisitorProvider';
import styles from './entrance.module.css';

/** Hall coordinates in metres: x across the nave, z along it, the entrance at +z. */
const PLAN = { minX: -12.5, maxX: 12.5, minZ: -22, maxZ: 11 } as const;
const HERE = 'dev-13';

/**
 * The hall from above, drawn from where the devices stand. Every device is a
 * mark; each application is named once, at the middle of its devices, and on
 * the side facing the aisle, so three Timeline Walls read as one place and
 * no two names collide.
 */
function HallPlan() {
  const { t } = useI18n();
  const w = PLAN.maxX - PLAN.minX;
  const h = PLAN.maxZ - PLAN.minZ;
  const places = new Map<string, { x: number; y: number; n: number }>();
  for (const d of DEVICES) {
    const key = d.deviceId === HERE ? HERE : d.channel;
    const p = places.get(key) ?? { x: 0, y: 0, n: 0 };
    places.set(key, {
      x: p.x + d.position[0] - PLAN.minX,
      y: p.y + d.position[2] - PLAN.minZ,
      n: p.n + 1,
    });
  }
  return (
    <figure className={styles.plan}>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t('entrance.plan')}>
        <rect x={0.2} y={0.2} width={w - 0.4} height={h - 0.4} className={styles.walls} />
        {DEVICES.map((d) => (
          <circle
            key={d.deviceId}
            cx={d.position[0] - PLAN.minX}
            cy={d.position[2] - PLAN.minZ}
            r={d.deviceId === HERE ? 0.75 : 0.5}
            className={d.deviceId === HERE ? styles.hereMark : styles.mark}
          />
        ))}
        {[...places].map(([key, p]) => {
          const x = p.x / p.n;
          const y = p.y / p.n;
          const aisle = x < w / 2;
          const label =
            key === HERE ? t('entrance.here') : t(`device.channel.${key}` as MessageKey);
          return (
            <text
              key={key}
              x={aisle ? x + 1 : x - 1}
              y={y + 0.35}
              textAnchor={aisle ? 'start' : 'end'}
              className={key === HERE ? styles.hereLabel : styles.placeLabel}
            >
              {label}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}

function CardPanel() {
  const { t, lang } = useI18n();
  const { card, reader, profile } = useVisitor();
  const language = LANGUAGES.find((l) => l.code === lang)?.native ?? lang;
  if (reader === 'null') {
    return (
      <section className={styles.cardPanel} data-testid="entrance-card">
        <h3 className={styles.cardTitle}>{t('entrance.noReader.title')}</h3>
        <p className={styles.cardText}>{t('entrance.noReader')}</p>
      </section>
    );
  }
  return (
    <section
      className={styles.cardPanel}
      data-held={card !== null}
      data-testid="entrance-card"
    >
      <div className={styles.cardArt} aria-hidden="true">
        <Icon d={ICON.card} className={styles.cardIcon} />
      </div>
      {card === null ? (
        <>
          <h3 className={styles.cardTitle}>{t('entrance.take.title')}</h3>
          <p className={styles.cardText}>{t('entrance.take')}</p>
        </>
      ) : (
        <>
          <h3 className={styles.cardTitle}>{t('entrance.ready.title')}</h3>
          <p className={styles.cardText}>
            {t('entrance.ready', {
              language,
              size: t(`visitor.textSize.${profile.typeScale}` as MessageKey),
            })}
          </p>
        </>
      )}
    </section>
  );
}

function Farewell() {
  const { t, lang } = useI18n();
  const { dossier } = useVisitor();
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    setOrigin(process.env.NEXT_PUBLIC_TORAN_PUBLIC_ORIGIN ?? window.location.origin);
  }, []);
  return (
    <section className={styles.farewell} data-testid="entrance-farewell">
      <div className={styles.farewellText}>
        <h3 className={styles.cardTitle}>{t('entrance.leaving.title')}</h3>
        <p className={styles.cardText}>
          {t('entrance.leaving', { count: dossier.length })}
        </p>
        <p className={styles.cardText}>{t('entrance.return')}</p>
      </div>
      {origin !== null && (
        <QrCode
          value={dossierUrl(
            origin,
            dossier.map((i) => i.ref),
            lang,
          )}
          label={t('dossier.qr.label', { count: dossier.length })}
        />
      )}
    </section>
  );
}

export function Entrance() {
  const { t } = useI18n();
  const { card, dossier, returnCard } = useVisitor();
  const [plan, setPlan] = useState(false);
  // A card that comes back holding passages is a visitor on the way out.
  const leaving = card !== null && dossier.length > 0;
  useChannelNav({
    back: () => {
      if (!plan) return false;
      setPlan(false);
      return true;
    },
    home: () => setPlan(false),
    forward: () => false,
    canForward: false,
  });

  return (
    <div className={styles.entrance} data-plan={plan || undefined} data-testid="entrance">
      {plan ? (
        <HallPlan />
      ) : (
        <>
          {leaving ? (
            <Farewell />
          ) : (
            <div className={styles.choose}>
              <ProfileControls />
            </div>
          )}
          {!leaving && (
            <div className={styles.side}>
              <CardPanel />
            </div>
          )}
        </>
      )}
      <ReachTools>
        <Button
          variant={plan ? 'primary' : 'secondary'}
          icon={<Icon d={ICON.plan} />}
          aria-pressed={plan}
          onClick={() => setPlan((p) => !p)}
          data-testid="entrance-plan"
        >
          <span className={styles.label}>{t('entrance.plan')}</span>
        </Button>
        {card !== null && (
          <Button
            variant={leaving ? 'primary' : 'secondary'}
            weight="firm"
            icon={<Icon d={ICON.card} />}
            onClick={returnCard}
            data-testid="entrance-return"
          >
            <span className={styles.label}>{t('entrance.returnCard')}</span>
          </Button>
        )}
      </ReachTools>
    </div>
  );
}
