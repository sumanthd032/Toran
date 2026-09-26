'use client';

/**
 * The console with what it needs around it: the curator's session and the
 * fleet as Core reports it. Device 12 mounts this inside its kiosk frame, and
 * /curator mounts it on the operator's own machine. D-153.
 */

import { FleetProvider } from '@/fleet/FleetProvider';
import { CuratorConsole } from './CuratorConsole';
import { OperatorProvider } from './operator';

export function CuratorDesk() {
  return (
    <OperatorProvider>
      <FleetProvider>
        <CuratorConsole />
      </FleetProvider>
    </OperatorProvider>
  );
}
