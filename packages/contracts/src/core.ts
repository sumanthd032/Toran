/**
 * The wire between a kiosk and Toran Core.
 *
 * Core is the institutional server named in R17: it holds the fleet's
 * configuration, the anonymous card sessions, and the two API keys that cannot
 * ship inside a static export. ARCHITECTURE.md section 7.
 *
 * Both sides read these shapes through the functions below rather than trusting
 * what arrived. A kiosk that trusts a malformed config would misconfigure
 * itself; a Core that trusts a malformed dossier item would store a passage
 * nobody can trace back to a page, which is the one failure CLAUDE.md section
 * 12 forbids. So the reply is validated on arrival at both ends, and a device
 * that cannot understand an answer carries on with the configuration it has.
 *
 * Nothing in the offline core crosses this wire. Search, reading, the graph,
 * the manuscripts and the cached translations all run against files on the
 * device. What is here is the part that is allowed to be unavailable.
 */

import { CitationError } from './citation.ts';
import { restore, type StoredItem } from './dossier.ts';
import {
  DEFAULT_ACCESSIBILITY,
  DEVICE_CHANNELS,
  PROXEMIC_STATES,
  type AccessibilityProfile,
  type DeviceChannel,
  type DeviceConfig,
  type DeviceHealth,
  type ProxemicState,
  type SutraSession,
} from './kiosk.ts';

/** Every path Core serves sits under this, so a version bump is not a rewrite. */
export const CORE_API = '/v1';

/**
 * How often a kiosk reports in. ARCHITECTURE.md section 10.
 *
 * Thirteen devices at this interval is 26 requests a minute against a server on
 * the same LAN, which is nothing. It also decides how stale the Twin's view of
 * the hall can be, so it is not a number to raise casually.
 */
export const BEAT_INTERVAL_MS = 30_000;

/**
 * A device is shown as offline after this long without a beat. Two missed
 * beats plus a margin, so one dropped packet does not grey out a healthy
 * kiosk on the Twin.
 */
export const BEAT_STALE_MS = 90_000;

/**
 * A call to Core gives up here. The kiosk contract is a response inside 2000ms
 * and a visitor is standing there, so a slow server must fail rather than hold
 * the interface. Whatever needed Core then degrades, which every surface that
 * calls it is built to do.
 */
export const CORE_TIMEOUT_MS = 2000;

/** A visit is a day. After this a card's session and its dossier are gone. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * What a deployment actually serves. A Core on a laptop with no Groq key still
 * runs the fleet and the sessions, and says plainly that it does not answer
 * questions, rather than failing one call at a time in front of a visitor.
 * `curation` is served only where a curator key is set, because it is the one
 * service that writes to the archive.
 */
export const CORE_SERVICES = [
  'fleet',
  'session',
  'assistant',
  'language',
  'curation',
] as const;
export type CoreService = (typeof CORE_SERVICES)[number];

export interface CoreStatus {
  readonly service: 'toran-core';
  readonly version: string;
  readonly startedAt: string;
  readonly services: readonly CoreService[];
}

/** The hall as Core believes it to be: what each device should be, and what it reports. */
export interface FleetSnapshot {
  readonly at: string;
  readonly devices: readonly DeviceConfig[];
  readonly health: readonly DeviceHealth[];
}

/** What a kiosk posts every BEAT_INTERVAL_MS. */
export interface DeviceBeat {
  readonly state: ProxemicState;
  /** The version the device is actually running, which is how Core sees drift. */
  readonly configVersion: number;
  readonly uptimeSeconds: number;
}

/**
 * Core's answer to a beat. `changed` is true when the device is behind, which
 * is the device's cue to apply the config it was just handed.
 */
export interface BeatReply {
  readonly config: DeviceConfig;
  readonly changed: boolean;
}

/** A card's session and what it holds. No device, no times beyond the issue. */
export interface SessionRecord {
  readonly session: SutraSession;
  readonly dossier: readonly StoredItem[];
}

export class WireError extends Error {
  public override readonly name = 'WireError';
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WireError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WireError(`${what} must be a non-empty string`);
  }
  return value;
}

function num(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WireError(`${what} must be a finite number`);
  }
  return value;
}

function whole(value: unknown, what: string): number {
  const n = num(value, what);
  if (!Number.isInteger(n) || n < 0) {
    throw new WireError(`${what} must be a whole number, got ${String(n)}`);
  }
  return n;
}

/** BCP-47 enough to be a language tag and not a sentence. */
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function readLanguage(value: unknown, what = 'language'): string {
  const code = str(value, what);
  if (!LANGUAGE.test(code)) throw new WireError(`${what} is not a language tag: ${code}`);
  return code;
}

export function isChannel(value: unknown): value is DeviceChannel {
  return (
    typeof value === 'string' && (DEVICE_CHANNELS as readonly string[]).includes(value)
  );
}

export function isProxemicState(value: unknown): value is ProxemicState {
  return (
    typeof value === 'string' && (PROXEMIC_STATES as readonly string[]).includes(value)
  );
}

/**
 * A card token. Printed on nothing, derived from nothing, and bound to a
 * physical card rather than to a person. The shape is restricted because the
 * token reaches a database key and a URL, not because a longer one would say
 * anything about its holder.
 */
const TOKEN = /^[a-z0-9][a-z0-9-]{3,63}$/i;

export function readToken(value: unknown): string {
  const token = str(value, 'token');
  if (!TOKEN.test(token)) throw new WireError('token is not a card token');
  return token;
}

const DEVICE_ID = /^[a-z0-9][a-z0-9-]{1,63}$/i;

export function readDeviceId(value: unknown): string {
  const id = str(value, 'deviceId');
  if (!DEVICE_ID.test(id)) throw new WireError(`not a device id: ${id}`);
  return id;
}

export function readDeviceConfig(raw: unknown): DeviceConfig {
  const d = record(raw, 'device config');
  const channel = d['channel'];
  if (!isChannel(channel)) throw new WireError(`unknown channel: ${String(channel)}`);
  const position = d['position'];
  if (!Array.isArray(position) || position.length !== 3) {
    throw new WireError('position must be three numbers');
  }
  return {
    deviceId: readDeviceId(d['deviceId']),
    channel,
    defaultLanguage: readLanguage(d['defaultLanguage'], 'defaultLanguage'),
    position: [
      num(position[0], 'position x'),
      num(position[1], 'position y'),
      num(position[2], 'position z'),
    ],
    rotationY: num(d['rotationY'], 'rotationY'),
    version: whole(d['version'], 'version'),
  };
}

export function readDeviceHealth(raw: unknown): DeviceHealth {
  const h = record(raw, 'device health');
  const state = h['state'];
  if (!isProxemicState(state)) throw new WireError(`unknown state: ${String(state)}`);
  return {
    deviceId: readDeviceId(h['deviceId']),
    online: h['online'] === true,
    lastSeen: str(h['lastSeen'], 'lastSeen'),
    configVersion: whole(h['configVersion'], 'configVersion'),
    state,
    uptimeSeconds: whole(h['uptimeSeconds'], 'uptimeSeconds'),
  };
}

export function readCoreStatus(raw: unknown): CoreStatus {
  const s = record(raw, 'status');
  if (s['service'] !== 'toran-core') throw new WireError('not a Toran Core');
  const services = Array.isArray(s['services']) ? s['services'] : [];
  return {
    service: 'toran-core',
    version: str(s['version'], 'version'),
    startedAt: str(s['startedAt'], 'startedAt'),
    services: services.filter((v): v is CoreService =>
      (CORE_SERVICES as readonly unknown[]).includes(v),
    ),
  };
}

export function readFleetSnapshot(raw: unknown): FleetSnapshot {
  const f = record(raw, 'fleet');
  const devices = Array.isArray(f['devices']) ? f['devices'] : [];
  const health = Array.isArray(f['health']) ? f['health'] : [];
  return {
    at: str(f['at'], 'at'),
    devices: devices.map(readDeviceConfig),
    health: health.map(readDeviceHealth),
  };
}

export function readBeat(raw: unknown): DeviceBeat {
  const b = record(raw, 'beat');
  const state = b['state'];
  if (!isProxemicState(state)) throw new WireError(`unknown state: ${String(state)}`);
  return {
    state,
    configVersion: whole(b['configVersion'], 'configVersion'),
    uptimeSeconds: whole(b['uptimeSeconds'], 'uptimeSeconds'),
  };
}

export function readBeatReply(raw: unknown): BeatReply {
  const r = record(raw, 'beat reply');
  return { config: readDeviceConfig(r['config']), changed: r['changed'] === true };
}

const SCALES = ['default', 'large', 'largest'] as const;

export function readAccessibility(raw: unknown): AccessibilityProfile {
  if (raw === undefined || raw === null) return DEFAULT_ACCESSIBILITY;
  const a = record(raw, 'accessibility');
  const scale = a['typeScale'];
  return {
    typeScale: (SCALES as readonly unknown[]).includes(scale)
      ? (scale as AccessibilityProfile['typeScale'])
      : DEFAULT_ACCESSIBILITY.typeScale,
    highContrast: a['highContrast'] === true,
    audioFirst: a['audioFirst'] === true,
    reducedMotion: a['reducedMotion'] === true,
  };
}

export function readSutraSession(raw: unknown): SutraSession {
  const s = record(raw, 'session');
  return {
    token: readToken(s['token']),
    language: readLanguage(s['language']),
    accessibility: readAccessibility(s['accessibility']),
    issuedAt: str(s['issuedAt'], 'issuedAt'),
  };
}

/**
 * A session and its dossier, with any item that lost its citation dropped.
 *
 * Dropping rather than refusing the whole record is deliberate: a visitor who
 * kept twelve passages and hit one storage fault should get eleven back, not a
 * blank card. `refused` carries the count so a caller can say so.
 */
export function readSessionRecord(raw: unknown): {
  readonly record: SessionRecord;
  readonly refused: number;
} {
  const r = record(raw, 'session record');
  const session = readSutraSession(r['session']);
  const { items, refused } = restore(r['dossier']);
  if (items.length !== 0 && session.token === '') {
    throw new CitationError('a dossier without a card cannot be stored');
  }
  return {
    record: {
      session,
      dossier: items.map((item) => ({
        ref: item.ref,
        corpus: item.passage.citation.corpus,
        workId: item.passage.citation.workId,
        pageId: item.passage.citation.pageId,
        locator: item.passage.citation.locator,
        language: item.passage.language,
        speaker: item.passage.speaker,
        text: item.passage.text,
      })),
    },
    refused,
  };
}

/** Whether a session issued at this time is still the same visit. */
export function sessionIsLive(issuedAt: string, now: number): boolean {
  const at = Date.parse(issuedAt);
  return Number.isFinite(at) && now - at <= SESSION_TTL_MS;
}

/**
 * Whether a device that last reported at `lastSeen` should be drawn as online.
 * The Twin and Core both call this, so the hall and the server cannot disagree
 * about which node is lit.
 */
export function beatIsFresh(lastSeen: string, now: number): boolean {
  const at = Date.parse(lastSeen);
  return Number.isFinite(at) && now - at <= BEAT_STALE_MS;
}
