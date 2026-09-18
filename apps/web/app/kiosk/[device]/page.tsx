/**
 * /kiosk/<device>/ runs one kiosk with no hall around it. It is the address a
 * kiosk's Chromium opens, and a deep link that restarts a demo from a known
 * state. Every device is exported statically.
 */

import { DEVICES } from '@/fleet/devices';
import { KioskRoute } from './KioskRoute';

export const dynamicParams = false;

export function generateStaticParams() {
  return DEVICES.map((d) => ({ device: d.deviceId }));
}

export default async function Page({ params }: { params: Promise<{ device: string }> }) {
  const { device } = await params;
  return <KioskRoute deviceId={device} />;
}
