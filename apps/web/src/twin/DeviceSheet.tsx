'use client';

/**
 * Every device, as a list. This is the path to each device that does not need
 * a pointer on a 3D canvas: keyboard, screen reader, switch access. It is also
 * how an operator sees the whole fleet's status at once.
 */

import { Badge, Button, Dialog } from '@/design/primitives';
import { useI18n, type MessageKey } from '@/i18n';
import { CHANNEL_ORDER, DEVICES, fixtureHealth, statusOf } from '@/fleet/devices';
import { useTwinState } from './state';

export function DeviceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { selected, select } = useTwinState();
  const health = fixtureHealth();
  const ordered = [...DEVICES].sort(
    (a, b) => CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel),
  );

  return (
    <Dialog
      open={open}
      title={t('twin.devices.count', { count: DEVICES.length })}
      onClose={onClose}
    >
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gap: 'var(--s-1)',
        }}
      >
        {ordered.map((d) => {
          const h = health.get(d.deviceId);
          const status = statusOf(h);
          const minutes =
            h !== undefined
              ? Math.round((Date.now() - new Date(h.lastSeen).getTime()) / 60_000)
              : 0;
          return (
            <li key={d.deviceId}>
              <Button
                fullWidth
                variant={selected === d.deviceId ? 'primary' : 'secondary'}
                aria-pressed={selected === d.deviceId}
                onClick={() => {
                  select(d.deviceId);
                  onClose();
                }}
                style={{ justifyContent: 'space-between' }}
              >
                <span>{t(`device.channel.${d.channel}` as MessageKey)}</span>
                <span
                  style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--t-meta)',
                      opacity: 0.8,
                    }}
                  >
                    {d.deviceId}
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
                    {status === 'offline'
                      ? t('device.status.offlineFor', { minutes })
                      : t(`device.status.${status}` as MessageKey)}
                  </Badge>
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
