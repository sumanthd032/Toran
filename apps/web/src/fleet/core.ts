'use client';

/**
 * The kiosk's client for Toran Core.
 *
 * The rule this file exists to keep: nothing here may ever be the reason a
 * visitor waits. Every call has a hard timeout, every failure returns null
 * rather than throwing, and a device that cannot reach Core carries on with
 * what it has on disk. The surfaces that call it are all built to degrade,
 * because ARCHITECTURE.md section 12 lists exactly what each one does when
 * this file returns nothing.
 *
 * With no Core configured, no request is made at all. That is not an
 * optimisation. The offline core is the claim this project is built on, and a
 * kiosk that quietly probes a server on boot has a network dependency whether
 * or not the probe succeeds.
 */

import {
  BEAT_INTERVAL_MS,
  CORE_API,
  CORE_TIMEOUT_MS,
  readBeatReply,
  readCoreStatus,
  readDeviceConfig,
  readFleetSnapshot,
  readSessionRecord,
  readTranscript,
  SPEECH_TIMEOUT_MS,
  type BeatReply,
  type CoreService,
  type CoreStatus,
  type DeviceBeat,
  type DeviceConfig,
  type FleetSnapshot,
  type SessionRecord,
} from '@toran/contracts';

/**
 * Where Core is, in order of precedence: the device's URL, a value saved on
 * the device, then the build's default.
 *
 * The URL comes first because a kiosk is configured by its URL already, the
 * way `?scale` sets the panel's physical calibration. Thirteen devices on a
 * hall LAN should not need thirteen builds to point at a server, and a
 * venue that moves the server should not need a build at all. The build-time
 * default stays for the public web deployment, where the URL is fixed.
 */
export function coreUrl(search?: string): string | null {
  const fromBuild = process.env.NEXT_PUBLIC_CORE_URL ?? '';
  if (typeof window === 'undefined') {
    // 'self' is an origin only a browser knows.
    return fromBuild === '' || fromBuild === 'self' ? null : fromBuild;
  }

  const asked = new URLSearchParams(search ?? window.location.search).get('core');
  if (asked !== null) {
    const chosen = asked.trim();
    try {
      if (chosen === '') window.localStorage.removeItem('toran.core-url');
      else window.localStorage.setItem('toran.core-url', chosen);
    } catch {
      // Private browsing, or storage blocked. The URL still applies to this load.
    }
    return valid(chosen);
  }

  let saved = '';
  try {
    saved = window.localStorage.getItem('toran.core-url') ?? '';
  } catch {
    saved = '';
  }
  return valid(saved !== '' ? saved : fromBuild);
}

function valid(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;
  // A build served by Core itself finds it at its own origin. D-160.
  if (trimmed === 'self') return window.location.origin;
  try {
    const url = new URL(trimmed);
    // Anything but http keeps a kiosk from being pointed at a javascript: or
    // data: URL by a query string somebody typed at it.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

export type Reach = 'unconfigured' | 'unknown' | 'reachable' | 'unreachable';

export interface CoreClient {
  /** Null when no Core is configured, which is the default. */
  readonly base: string | null;
  readonly reach: Reach;
  status: () => Promise<CoreStatus | null>;
  serves: (service: CoreService) => Promise<boolean>;
  fleet: () => Promise<FleetSnapshot | null>;
  config: (deviceId: string) => Promise<DeviceConfig | null>;
  beat: (deviceId: string, beat: DeviceBeat) => Promise<BeatReply | null>;
  session: (token: string) => Promise<SessionRecord | null>;
  saveSession: (token: string, record: unknown) => Promise<SessionRecord | null>;
  forgetSession: (token: string) => Promise<boolean>;
  /** A spoken query's words, or null. Waits up to SPEECH_TIMEOUT_MS, and the kiosk says it is working. */
  transcribe: (language: string, audio: string) => Promise<string | null>;
  /** Called whenever reachability changes, for a surface that shows it. */
  watch: (listener: (reach: Reach) => void) => () => void;
}

/**
 * How long a client waits after a failure before trying again.
 *
 * A kiosk whose Core is switched off must not spend every card tap on a
 * two second timeout. After a failure the client answers null immediately
 * until this passes, which is the difference between a degraded kiosk and a
 * slow one.
 */
const BACKOFF_MS = 15_000;

class Client implements CoreClient {
  public readonly base: string | null;
  private state: Reach;
  private failedAt = 0;
  private readonly listeners = new Set<(reach: Reach) => void>();
  private cachedStatus: CoreStatus | null = null;

  constructor(base: string | null) {
    this.base = base;
    this.state = base === null ? 'unconfigured' : 'unknown';
  }

  get reach(): Reach {
    return this.state;
  }

  watch(listener: (reach: Reach) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private set(reach: Reach): void {
    if (this.state === reach) return;
    this.state = reach;
    for (const listener of this.listeners) listener(reach);
  }

  private resting(): boolean {
    return this.state === 'unreachable' && Date.now() - this.failedAt < BACKOFF_MS;
  }

  /**
   * One call. Returns null for every failure there is: no Core configured,
   * Core resting after a failure, a timeout, a non-2xx, a body the contract
   * refuses. The caller cannot tell them apart and should not need to.
   */
  private async call<T>(
    method: string,
    path: string,
    body: unknown,
    read: (raw: unknown) => T,
    timeout: number = CORE_TIMEOUT_MS,
  ): Promise<T | null> {
    if (this.base === null || this.resting()) return null;
    try {
      const init: RequestInit = {
        method,
        signal: AbortSignal.timeout(timeout),
        // A visitor's card is not a thing to keep in a browser cache.
        cache: 'no-store',
      };
      if (body !== undefined) {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify(body);
      }
      const response = await fetch(`${this.base}${CORE_API}${path}`, init);
      // Core answered, so it is up. A 404 for a blank card is not a failure of
      // the server, and treating it as one would put the client into backoff
      // on the most ordinary event there is.
      this.set('reachable');
      if (response.status === 204) return null;
      if (!response.ok) return null;
      return read(await response.json());
    } catch {
      this.failedAt = Date.now();
      this.set('unreachable');
      return null;
    }
  }

  async status(): Promise<CoreStatus | null> {
    const found = await this.call('GET', '/status', undefined, readCoreStatus);
    if (found !== null) this.cachedStatus = found;
    return found;
  }

  /** Whether this deployment serves something, asked once and remembered. */
  async serves(service: CoreService): Promise<boolean> {
    const status = this.cachedStatus ?? (await this.status());
    return status !== null && status.services.includes(service);
  }

  fleet(): Promise<FleetSnapshot | null> {
    return this.call('GET', '/fleet', undefined, readFleetSnapshot);
  }

  config(deviceId: string): Promise<DeviceConfig | null> {
    return this.call(
      'GET',
      `/fleet/${encodeURIComponent(deviceId)}`,
      undefined,
      readDeviceConfig,
    );
  }

  beat(deviceId: string, beat: DeviceBeat): Promise<BeatReply | null> {
    return this.call(
      'POST',
      `/fleet/${encodeURIComponent(deviceId)}/beat`,
      beat,
      readBeatReply,
    );
  }

  session(token: string): Promise<SessionRecord | null> {
    return this.call(
      'GET',
      `/session/${encodeURIComponent(token)}`,
      undefined,
      (raw) => readSessionRecord(raw).record,
    );
  }

  saveSession(token: string, record: unknown): Promise<SessionRecord | null> {
    return this.call(
      'PUT',
      `/session/${encodeURIComponent(token)}`,
      record,
      (raw) => readSessionRecord(raw).record,
    );
  }

  async transcribe(language: string, audio: string): Promise<string | null> {
    const found = await this.call(
      'POST',
      '/language/transcribe',
      { language, audio },
      readTranscript,
      SPEECH_TIMEOUT_MS,
    );
    return found === null || found.text === '' ? null : found.text;
  }

  async forgetSession(token: string): Promise<boolean> {
    if (this.base === null || this.resting()) return false;
    try {
      await fetch(`${this.base}${CORE_API}/session/${encodeURIComponent(token)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
      });
      this.set('reachable');
      return true;
    } catch {
      this.failedAt = Date.now();
      this.set('unreachable');
      return false;
    }
  }
}

/**
 * One client per page.
 *
 * Reachability is a property of the device, not of a component, and thirteen
 * components each discovering that Core is down would be thirteen timeouts.
 */
let shared: CoreClient | null = null;

export function sharedCore(): CoreClient {
  shared ??= new Client(coreUrl());
  return shared;
}

/** For tests and for the Twin, which points at a Core the URL named. */
export function createCore(base: string | null): CoreClient {
  return new Client(base);
}

export { BEAT_INTERVAL_MS };
