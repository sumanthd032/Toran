/**
 * The thirteen devices in the hall, placed where they would physically stand.
 * Roster and roles follow PROJECT.md section 7.
 *
 * Positions are metres in hall coordinates: x across the nave (negative is the
 * left wall), y up, z along the nave (positive is the entrance). The centre
 * aisle is kept clear so the view from the doorway reaches the Chaitya arch.
 *
 * The config shape is the shared DeviceConfig contract, so the fleet service in
 * step 10 can replace this list without the scene changing.
 */

import type { DeviceChannel, DeviceConfig, DeviceHealth } from '@toran/contracts';

/** Physical form, which decides the geometry the scene draws. */
export type DeviceForm = 'kiosk' | 'wall' | 'desk' | 'booth' | 'console' | 'totem';

export interface HallDevice extends DeviceConfig {
  readonly form: DeviceForm;
}

const Q = Math.PI / 4;

export const DEVICES: readonly HallDevice[] = [
  {
    deviceId: 'dev-13',
    channel: 'entrance',
    form: 'totem',
    defaultLanguage: 'en',
    position: [-3.6, 0, 9.4],
    rotationY: 0.35,
    version: 1,
  },
  {
    deviceId: 'dev-01',
    channel: 'reading',
    form: 'kiosk',
    defaultLanguage: 'en',
    position: [-5.4, 0, 4.0],
    rotationY: Q * 0.9,
    version: 1,
  },
  {
    deviceId: 'dev-02',
    channel: 'reading',
    form: 'kiosk',
    defaultLanguage: 'mr',
    position: [-5.4, 0, -1.6],
    rotationY: Q * 0.9,
    version: 1,
  },
  {
    deviceId: 'dev-03',
    channel: 'provenance',
    form: 'kiosk',
    defaultLanguage: 'en',
    position: [5.4, 0, 4.0],
    rotationY: -Q * 0.9,
    version: 1,
  },
  {
    deviceId: 'dev-07',
    channel: 'manuscript',
    form: 'kiosk',
    defaultLanguage: 'en',
    position: [5.4, 0, -1.6],
    rotationY: -Q * 0.9,
    version: 1,
  },
  {
    deviceId: 'dev-04',
    channel: 'timeline',
    form: 'wall',
    defaultLanguage: 'en',
    position: [-11.55, 3.1, -7],
    rotationY: Math.PI / 2,
    version: 1,
  },
  {
    deviceId: 'dev-05',
    channel: 'timeline',
    form: 'wall',
    defaultLanguage: 'hi',
    position: [-11.55, 3.1, -13],
    rotationY: Math.PI / 2,
    version: 1,
  },
  {
    deviceId: 'dev-06',
    channel: 'timeline',
    form: 'wall',
    defaultLanguage: 'mr',
    position: [-11.55, 3.1, -19],
    rotationY: Math.PI / 2,
    version: 1,
  },
  // Beside the processional line, not on it: the view from the door to the
  // Chaitya arch stays clear.
  {
    deviceId: 'dev-11',
    channel: 'assistant',
    form: 'desk',
    defaultLanguage: 'en',
    position: [3.7, 0, -6.4],
    rotationY: -0.5,
    version: 1,
  },
  {
    deviceId: 'dev-08',
    channel: 'audio',
    form: 'booth',
    defaultLanguage: 'hi',
    position: [6.2, 0, -11.5],
    rotationY: -0.55,
    version: 1,
  },
  // Staggered so the pair do not line up, and their plates do not stack, from the door.
  {
    deviceId: 'dev-09',
    channel: 'av',
    form: 'kiosk',
    defaultLanguage: 'en',
    position: [-5.7, 0, -13.2],
    rotationY: Q * 0.7,
    version: 1,
  },
  {
    deviceId: 'dev-10',
    channel: 'av',
    form: 'kiosk',
    defaultLanguage: 'en',
    position: [-3.7, 0, -19.6],
    rotationY: Q * 0.55,
    version: 1,
  },
  {
    deviceId: 'dev-12',
    channel: 'curator',
    form: 'console',
    defaultLanguage: 'en',
    position: [6.2, 0, -19],
    rotationY: -0.5,
    version: 1,
  },
];

/**
 * Health fixture.
 *
 * This is NOT live data. Toran Core's fleet service does not exist until step
 * 10, so health comes from here. The fixture deliberately includes one idle and
 * one offline device, because the renderer has to handle every state a real
 * fleet will report, and a fixture where everything is green tests nothing.
 */
export function fixtureHealth(now: Date = new Date()): ReadonlyMap<string, DeviceHealth> {
  const iso = (minutesAgo: number) =>
    new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const map = new Map<string, DeviceHealth>();
  for (const d of DEVICES) {
    const offline = d.deviceId === 'dev-10';
    const idle = d.deviceId === 'dev-06';
    map.set(d.deviceId, {
      deviceId: d.deviceId,
      online: !offline,
      lastSeen: offline ? iso(11) : iso(0),
      configVersion: d.version,
      state: idle ? 'ambient' : 'subtle',
      uptimeSeconds: offline ? 0 : 6 * 3600 + d.deviceId.charCodeAt(5) * 97,
    });
  }
  return map;
}

export type DeviceStatus = 'online' | 'idle' | 'offline';

export function statusOf(health: DeviceHealth | undefined): DeviceStatus {
  if (health === undefined || !health.online) return 'offline';
  return health.state === 'ambient' ? 'idle' : 'online';
}

export const CHANNEL_ORDER: readonly DeviceChannel[] = [
  'entrance',
  'reading',
  'provenance',
  'manuscript',
  'timeline',
  'assistant',
  'audio',
  'av',
  'curator',
];
