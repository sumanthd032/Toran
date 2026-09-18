/**
 * Kiosk contracts. Shared between the web app, Toran Core and the Pi daemons,
 * so a device and the Twin cannot disagree about what state a device is in.
 */

/**
 * Vogel and Balakrishnan's four phases for public ambient displays, plus the
 * decay state. See ARCHITECTURE.md section 6 and DECISIONS.md D-022.
 */
export const PROXEMIC_STATES = [
  'ambient',
  'implicit',
  'subtle',
  'personal',
  'decaying',
] as const;
export type ProxemicState = (typeof PROXEMIC_STATES)[number];

/** Distance thresholds in metres. Crossing downward advances a state. */
export const PROXEMIC_THRESHOLDS = {
  implicit: 3.0,
  subtle: 1.5,
  personal: 0.5,
} as const;

/** Idle timing in milliseconds. CLAUDE.md section 10. */
export const IDLE = {
  decayBegins: 45_000,
  returnToAmbient: 90_000,
  dropSession: 120_000,
} as const;

export const DEVICE_CHANNELS = [
  'reading',
  'provenance',
  'timeline',
  'manuscript',
  'audio',
  'av',
  'assistant',
  'curator',
  'entrance',
] as const;
export type DeviceChannel = (typeof DEVICE_CHANNELS)[number];

export interface DeviceConfig {
  readonly deviceId: string;
  readonly channel: DeviceChannel;
  /** BCP-47 default. A Sutra card overrides it for one session. */
  readonly defaultLanguage: string;
  /** Position in the hall, metres, for the Twin. */
  readonly position: readonly [x: number, y: number, z: number];
  readonly rotationY: number;
  /** Bumped by Toran Core on every change so a device can detect drift. */
  readonly version: number;
}

export interface DeviceHealth {
  readonly deviceId: string;
  readonly online: boolean;
  readonly lastSeen: string;
  readonly configVersion: number;
  readonly state: ProxemicState;
  readonly uptimeSeconds: number;
}

/**
 * Accessibility profile carried by a Sutra card. Never contains anything
 * identifying. See DECISIONS.md D-023.
 */
export interface AccessibilityProfile {
  readonly typeScale: 'default' | 'large' | 'largest';
  readonly highContrast: boolean;
  readonly audioFirst: boolean;
  readonly reducedMotion: boolean;
}

export const DEFAULT_ACCESSIBILITY: AccessibilityProfile = {
  typeScale: 'default',
  highContrast: false,
  audioFirst: false,
  reducedMotion: false,
};

/**
 * An anonymous session bound to a physical card, not to a person.
 * There is no name, no contact, and nothing that survives the card going
 * back in the bowl at the exit.
 */
export interface SutraSession {
  readonly token: string;
  readonly language: string;
  readonly accessibility: AccessibilityProfile;
  readonly issuedAt: string;
}
