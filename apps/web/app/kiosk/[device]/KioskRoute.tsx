'use client';

import { KioskApp } from '@/kiosk/KioskApp';

export function KioskRoute({ deviceId }: { deviceId: string }) {
  return (
    <main style={{ position: 'fixed', inset: 0 }}>
      <KioskApp deviceId={deviceId} context="standalone" />
    </main>
  );
}
