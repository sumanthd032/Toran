/**
 * The fleet service: what each device should be, and what it reports being.
 *
 * Two facts live here and they are kept apart on purpose. The configuration is
 * what a curator decided. The health is what a device says about itself. When
 * they disagree the device is behind, and the Twin draws that difference rather
 * than hiding it, because a config push that silently failed is the failure
 * mode a fleet view exists to catch. ARCHITECTURE.md section 10.
 *
 * Bumping the version is Core's job, never the caller's. A curator sends what
 * the device should be; Core decides what number that is. Otherwise two
 * curators editing at once would both write version 42 and one would vanish.
 */

import {
  BEAT_STALE_MS,
  beatIsFresh,
  driftFor,
  readDeviceConfig,
  type DeviceBeat,
  type DeviceConfig,
  type DeviceHealth,
  type FleetSnapshot,
} from '@toran/contracts';
import { one, rows, run, type Db } from './db.ts';

interface DeviceRow {
  device_id: string;
  channel: string;
  default_language: string;
  x: number;
  y: number;
  z: number;
  rotation_y: number;
  version: number;
}

interface HealthRow {
  device_id: string;
  last_seen: string;
  config_version: number;
  state: string;
  uptime_seconds: number;
}

export class Fleet {
  private readonly db: Db;
  private readonly now: () => number;
  /**
   * Devices whose last beat came from the hall simulator, and when a real
   * kiosk last reported for each device. Kept in memory: a restart forgets
   * both, and the next beats say again which is which.
   */
  private readonly simulated = new Set<string>();
  private readonly realAt = new Map<string, number>();

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  /**
   * Writes the hall's devices if the table is empty.
   *
   * A Core booting against a fresh database knows nothing about the hall, and
   * a fleet view of nothing is useless at a demo. The roster ships with the
   * web app, so Core is seeded from it once and never again: after the first
   * boot the database is the truth and the file is only history.
   */
  seed(devices: readonly DeviceConfig[]): number {
    const count = one<{ n: number }>(this.db, 'select count(*) as n from device');
    if (count !== null && count.n > 0) return 0;
    const at = new Date(this.now()).toISOString();
    const insert = `insert into device
         (device_id, channel, default_language, x, y, z, rotation_y, version, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    for (const d of devices) {
      run(
        this.db,
        insert,
        d.deviceId,
        d.channel,
        d.defaultLanguage,
        d.position[0],
        d.position[1],
        d.position[2],
        d.rotationY,
        d.version,
        at,
      );
    }
    return devices.length;
  }

  config(deviceId: string): DeviceConfig | null {
    const row = one<DeviceRow>(
      this.db,
      'select * from device where device_id = ?',
      deviceId,
    );
    return row === null ? null : toConfig(row);
  }

  configs(): readonly DeviceConfig[] {
    return rows<DeviceRow>(this.db, 'select * from device order by device_id').map(
      toConfig,
    );
  }

  /**
   * A curator's change. Returns the stored config, whose version Core set.
   *
   * The device id in the path wins over anything in the body, so a malformed
   * or mischievous payload cannot reconfigure a device the caller did not name.
   */
  put(deviceId: string, raw: unknown): DeviceConfig {
    const existing = this.config(deviceId);
    const version = existing === null ? 1 : existing.version + 1;
    const wanted = readDeviceConfig({
      ...(typeof raw === 'object' && raw !== null ? raw : {}),
      deviceId,
      version,
    });
    const at = new Date(this.now()).toISOString();
    run(
      this.db,
      `insert into device
           (device_id, channel, default_language, x, y, z, rotation_y, version, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(device_id) do update set
           channel = excluded.channel,
           default_language = excluded.default_language,
           x = excluded.x, y = excluded.y, z = excluded.z,
           rotation_y = excluded.rotation_y,
           version = excluded.version,
           updated_at = excluded.updated_at`,
      wanted.deviceId,
      wanted.channel,
      wanted.defaultLanguage,
      wanted.position[0],
      wanted.position[1],
      wanted.position[2],
      wanted.rotationY,
      wanted.version,
      at,
    );
    return wanted;
  }

  /**
   * A device reporting in. Returns its config, whether it is behind, and the
   * work being read nearby, if any.
   */
  beat(
    deviceId: string,
    beat: DeviceBeat,
    { simulated = false }: { simulated?: boolean } = {},
  ): { config: DeviceConfig; changed: boolean; drift: string | null } {
    const config = this.config(deviceId);
    if (config === null) throw new UnknownDevice(deviceId);
    if (simulated) this.simulated.add(deviceId);
    else {
      this.simulated.delete(deviceId);
      this.realAt.set(deviceId, this.now());
    }
    run(
      this.db,
      `insert into device_health
           (device_id, last_seen, config_version, state, uptime_seconds)
         values (?, ?, ?, ?, ?)
         on conflict(device_id) do update set
           last_seen = excluded.last_seen,
           config_version = excluded.config_version,
           state = excluded.state,
           uptime_seconds = excluded.uptime_seconds`,
      deviceId,
      new Date(this.now()).toISOString(),
      beat.configVersion,
      beat.state,
      beat.uptimeSeconds,
    );
    if (beat.topic === null) {
      run(this.db, 'delete from device_topic where device_id = ?', deviceId);
    } else {
      run(
        this.db,
        `insert into device_topic (device_id, topic) values (?, ?)
           on conflict(device_id) do update set topic = excluded.topic`,
        deviceId,
        beat.topic,
      );
    }
    return {
      config,
      changed: beat.configVersion !== config.version,
      drift: driftFor(config, this.engaged()),
    };
  }

  /** Removes every report the hall simulator made. Real kiosks' reports stay. */
  forgetSimulated(): void {
    for (const deviceId of this.simulated) {
      run(this.db, 'delete from device_health where device_id = ?', deviceId);
      run(this.db, 'delete from device_topic where device_id = ?', deviceId);
    }
    this.simulated.clear();
  }

  /** Whether a real kiosk has reported for this device recently. */
  reportedByDevice(deviceId: string): boolean {
    const at = this.realAt.get(deviceId);
    return at !== undefined && this.now() - at <= BEAT_STALE_MS;
  }

  /** The work each device is drifting toward right now, for the Twin to draw. */
  drifts(): { deviceId: string; work: string }[] {
    const engaged = this.engaged();
    return this.configs().flatMap((c) => {
      const work = driftFor(c, engaged);
      return work === null ? [] : [{ deviceId: c.deviceId, work }];
    });
  }

  /**
   * Devices whose visitor is deep in a work right now. A device that stopped
   * reporting is not engaged, whatever it last said: its reader may have gone
   * an hour ago with the power.
   */
  private engaged(): {
    deviceId: string;
    position: DeviceConfig['position'];
    topic: string;
  }[] {
    const at = this.now();
    const fresh = new Set(
      this.health()
        .filter((h) => beatIsFresh(h.lastSeen, at))
        .map((h) => h.deviceId),
    );
    const placed = new Map(this.configs().map((c) => [c.deviceId, c.position]));
    return rows<{ device_id: string; topic: string }>(
      this.db,
      'select * from device_topic',
    )
      .filter((r) => fresh.has(r.device_id) && placed.has(r.device_id))
      .map((r) => ({
        deviceId: r.device_id,
        position: placed.get(r.device_id)!,
        topic: r.topic,
      }));
  }

  health(): readonly DeviceHealth[] {
    const at = this.now();
    return rows<HealthRow>(this.db, 'select * from device_health order by device_id').map(
      (row) => ({
        deviceId: row.device_id,
        // A device is offline when it stopped reporting, not when it said so.
        // Nothing that crashes gets to send a goodbye.
        online: beatIsFresh(row.last_seen, at),
        lastSeen: row.last_seen,
        configVersion: row.config_version,
        state: row.state as DeviceHealth['state'],
        uptimeSeconds: row.uptime_seconds,
        simulated: this.simulated.has(row.device_id),
      }),
    );
  }

  snapshot(): FleetSnapshot {
    return {
      at: new Date(this.now()).toISOString(),
      devices: this.configs(),
      health: this.health(),
      drift: this.drifts(),
    };
  }
}

export class UnknownDevice extends Error {
  public override readonly name = 'UnknownDevice';
  constructor(deviceId: string) {
    super(`no device ${deviceId} in this hall`);
  }
}

function toConfig(row: DeviceRow): DeviceConfig {
  return readDeviceConfig({
    deviceId: row.device_id,
    channel: row.channel,
    defaultLanguage: row.default_language,
    position: [row.x, row.y, row.z],
    rotationY: row.rotation_y,
    version: row.version,
  });
}
