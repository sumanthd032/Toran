'use client';

/**
 * Every device, with what it is showing and how it is. The Twin's device
 * sheet and the Curator Console's fleet tab are this list.
 *
 * A curator can change what a device shows and the language it opens in, and
 * then watch the change land: Core stores it as a new version, the device
 * picks it up on its next beat, and the row says "applied" only when the
 * device itself reports running that version. ARCHITECTURE.md section 10. A
 * push to a device that stopped reporting says so, rather than pretending.
 */

import { useState } from 'react';
import {
  DEVICE_CHANNELS,
  language as languageInfo,
  readDeviceConfig,
  type DeviceChannel,
  type DeviceHealth,
} from '@toran/contracts';
import { Badge, Button } from '@/design/primitives';
import { FailureNote, OperatorGate } from '@/curator/OperatorGate';
import { useOperator, type OperatorFailure } from '@/curator/operator';
import { loadedLanguages, useI18n, type MessageKey } from '@/i18n';
import { CHANNEL_ORDER, statusOf, type DeviceForm, type HallDevice } from './devices';
import { useFleet } from './FleetProvider';
import styles from './fleet.module.css';

/**
 * What a device of each form may be turned into. The curator's desk stays the
 * curator's desk, and nothing a visitor walks up to becomes one.
 */
export function channelsFor(form: DeviceForm): readonly DeviceChannel[] {
  if (form === 'console') return ['curator'];
  return DEVICE_CHANNELS.filter((c) => c !== 'curator');
}

/** A language by its own name, so a Marathi speaker finds Marathi without reading English. */
const nativeName = (code: string) => languageInfo(code)?.native ?? code;

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

function Configure({
  device,
  health,
}: {
  device: HallDevice;
  health: DeviceHealth | undefined;
}) {
  const { t } = useI18n();
  const { call } = useOperator();
  const { refresh } = useFleet();
  const [channel, setChannel] = useState<DeviceChannel>(device.channel);
  const [language, setLanguage] = useState(device.defaultLanguage);
  const [sent, setSent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{
    failure: OperatorFailure;
    detail: string;
  } | null>(null);
  const changed = channel !== device.channel || language !== device.defaultLanguage;

  const send = () => {
    setBusy(true);
    setFailed(null);
    void call(
      'PUT',
      `/fleet/${encodeURIComponent(device.deviceId)}`,
      {
        channel,
        defaultLanguage: language,
        position: device.position,
        rotationY: device.rotationY,
      },
      readDeviceConfig,
    ).then((result) => {
      setBusy(false);
      if (result.ok) {
        setSent(result.value.version);
        refresh();
      } else setFailed({ failure: result.failure, detail: result.detail });
    });
  };

  // Applied means the device said so, not that Core accepted it.
  const applied = sent !== null && health !== undefined && health.configVersion >= sent;

  return (
    <div className={styles.configure}>
      <fieldset className={styles.choices}>
        <legend>{t('fleet.channel')}</legend>
        {channelsFor(device.form).map((c) => (
          <Button
            key={c}
            variant={c === channel ? 'primary' : 'secondary'}
            aria-pressed={c === channel}
            onClick={() => setChannel(c)}
          >
            {t(`device.channel.${c}` as MessageKey)}
          </Button>
        ))}
      </fieldset>
      <p className={styles.note}>{t(`channel.${channel}.about` as MessageKey)}</p>
      <fieldset className={styles.choices}>
        <legend>{t('fleet.language')}</legend>
        {loadedLanguages().map((code) => (
          <Button
            key={code}
            variant={code === language ? 'primary' : 'secondary'}
            aria-pressed={code === language}
            onClick={() => setLanguage(code)}
          >
            {/* The span, not the button, carries lang, so the Indic face applies over the button's own. */}
            <span lang={code}>{nativeName(code)}</span>
          </Button>
        ))}
      </fieldset>
      <div className={styles.row}>
        <Button
          variant="primary"
          weight="firm"
          disabled={busy || !changed}
          onClick={send}
        >
          {t('fleet.send')}
        </Button>
        {sent !== null && (
          <span role="status" className={styles.note}>
            {applied
              ? t('fleet.applied', { version: sent })
              : health?.online === true
                ? t('fleet.waiting', { version: sent })
                : t('fleet.waitingOffline', { version: sent })}
          </span>
        )}
      </div>
      {failed !== null && <FailureNote failure={failed.failure} detail={failed.detail} />}
    </div>
  );
}

export function FleetPanel({ onOpen }: { onOpen?: (deviceId: string) => void }) {
  const { t } = useI18n();
  const { devices, health, source, at, simulated, drift, titleOf } = useFleet();
  const [configuring, setConfiguring] = useState<string | null>(null);
  const ordered = [...devices].sort(
    (a, b) => CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel),
  );

  return (
    <div className={styles.panel}>
      <p className={styles.source}>
        {source === 'fleet' && at !== null
          ? t('fleet.source.live', { at: new Date(at).toLocaleTimeString() })
          : t('fleet.source.fixture')}
        {source === 'fleet' && simulated > 0 && (
          <span className={styles.simNote}>
            {t('fleet.source.simulatedCount', { count: simulated })}
          </span>
        )}
      </p>
      <ul className={styles.list}>
        {ordered.map((d) => {
          const h = health.get(d.deviceId);
          const status = statusOf(h);
          const behind = h !== undefined && h.configVersion !== d.version;
          return (
            <li key={d.deviceId} className={styles.device}>
              <div className={styles.row}>
                {onOpen === undefined ? (
                  <span className={styles.name}>
                    {t(`device.channel.${d.channel}` as MessageKey)}
                  </span>
                ) : (
                  <Button onClick={() => onOpen(d.deviceId)} className={styles.open}>
                    {t(`device.channel.${d.channel}` as MessageKey)}
                  </Button>
                )}
                <span className={styles.id}>{d.deviceId}</span>
                {h?.simulated === true && source === 'fleet' && (
                  <Badge tone="neutral">{t('fleet.simulated')}</Badge>
                )}
                <span className={styles.lang} lang={d.defaultLanguage}>
                  {nativeName(d.defaultLanguage)}
                </span>
                <Badge
                  tone={
                    status === 'online'
                      ? 'confirmed'
                      : status === 'offline'
                        ? 'unconfirmed'
                        : 'neutral'
                  }
                >
                  {status === 'offline' && h !== undefined
                    ? t('device.status.offlineFor', { minutes: minutesSince(h.lastSeen) })
                    : t(`device.status.${status}` as MessageKey)}
                </Badge>
                {source === 'fleet' && behind && (
                  <Badge tone="unconfirmed">
                    {t('fleet.behind', { running: h.configVersion, wanted: d.version })}
                  </Badge>
                )}
                {source === 'fleet' && (
                  <Button
                    variant="quiet"
                    aria-expanded={configuring === d.deviceId}
                    onClick={() =>
                      setConfiguring((c) => (c === d.deviceId ? null : d.deviceId))
                    }
                  >
                    {t('fleet.configure')}
                  </Button>
                )}
              </div>
              {drift.has(d.deviceId) && (
                <span className={styles.note} data-testid="fleet-drift">
                  {t('twin.nearby', { title: titleOf(drift.get(d.deviceId)!) })}
                </span>
              )}
              {configuring === d.deviceId && (
                <OperatorGate>
                  <Configure device={d} health={h} />
                </OperatorGate>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
