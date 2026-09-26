'use client';

/**
 * Every device, as a list. This is the path to each device that does not need
 * a pointer on a 3D canvas: keyboard, screen reader, switch access. It is also
 * where an operator sees the whole fleet's status at once and, with a curator
 * key, changes what a device shows. ARCHITECTURE.md section 10.
 */

import { Dialog } from '@/design/primitives';
import { FleetPanel } from '@/fleet/FleetPanel';
import { useFleet } from '@/fleet/FleetProvider';
import { useI18n } from '@/i18n';
import { useTwinState } from './state';

export function DeviceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { openDevice } = useTwinState();
  const { devices } = useFleet();

  return (
    <Dialog
      open={open}
      title={t('twin.devices.count', { count: devices.length })}
      onClose={onClose}
    >
      <FleetPanel
        onOpen={(id) => {
          onClose();
          openDevice(id);
        }}
      />
    </Dialog>
  );
}
