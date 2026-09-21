/**
 * Toran Core's routes. R17 in the coverage matrix.
 *
 * Every route here is one a kiosk can do without. Search, reading, the graph,
 * the manuscripts and the cached translations are on the device and never touch
 * this server, which is what makes the offline claim in PROJECT.md section 11
 * a claim about the code rather than about intent. What Core adds is the part
 * that genuinely needs a server: card continuity across thirteen machines, a
 * fleet an operator can see and change, and the two API keys that must not ship
 * inside a static export.
 */

import {
  CORE_API,
  readBeat,
  type CoreService,
  type DeviceConfig,
} from '@toran/contracts';
import type { Db } from './db.ts';
import { Fleet, UnknownDevice } from './fleet.ts';
import { BadRequest, fail, NotFound, ok, Router } from './http.ts';
import { Sessions } from './session.ts';

export interface CoreOptions {
  readonly db: Db;
  readonly version: string;
  readonly origins: readonly string[];
  /** The hall's devices, used only to seed an empty database. */
  readonly seed: readonly DeviceConfig[];
  readonly now?: () => number;
}

export interface Core {
  readonly router: Router;
  readonly fleet: Fleet;
  readonly sessions: Sessions;
  readonly services: readonly CoreService[];
  readonly startedAt: string;
}

export function createCore(options: CoreOptions): Core {
  const now = options.now ?? Date.now;
  const fleet = new Fleet(options.db, now);
  const sessions = new Sessions(options.db, now);
  const startedAt = new Date(now()).toISOString();
  fleet.seed(options.seed);
  sessions.sweep();

  // Assistant and language arrive with their own commits in this step. Saying
  // so in the status is how a kiosk knows to use its cache without first
  // making a call that fails in front of a visitor.
  const services: readonly CoreService[] = ['fleet', 'session'];

  const router = new Router(options.origins);

  router.get(`${CORE_API}/status`, () =>
    ok({
      service: 'toran-core',
      version: options.version,
      startedAt,
      services,
    }),
  );

  router.get(`${CORE_API}/fleet`, () => ok(fleet.snapshot()));

  router.get(`${CORE_API}/fleet/:deviceId`, ({ params }) => {
    const config = fleet.config(params['deviceId'] ?? '');
    if (config === null) throw new NotFound(`no device ${params['deviceId'] ?? ''}`);
    return ok(config);
  });

  router.put(`${CORE_API}/fleet/:deviceId`, ({ params, body }) => {
    if (body === null) throw new BadRequest('a config change needs a body');
    return ok(fleet.put(params['deviceId'] ?? '', body));
  });

  router.post(`${CORE_API}/fleet/:deviceId/beat`, ({ params, body }) => {
    try {
      const { config, changed } = fleet.beat(params['deviceId'] ?? '', readBeat(body));
      return ok({ config, changed });
    } catch (error) {
      // A device nobody configured is not an error the device can fix, and it
      // must not be a 500. It is told, and it keeps running what it has.
      if (error instanceof UnknownDevice) return fail(404, error.message);
      throw error;
    }
  });

  router.get(`${CORE_API}/session/:token`, ({ params }) => {
    const record = sessions.read(params['token'] ?? '');
    // A blank card is not an error. Most taps at the entrance are one.
    if (record === null) return { status: 204, body: null };
    return ok(record);
  });

  router.put(`${CORE_API}/session/:token`, ({ params, body }) => {
    if (body === null) throw new BadRequest('a session needs a body');
    const { record, refused } = sessions.write(params['token'] ?? '', body);
    return ok({ ...record, refused });
  });

  router.delete(`${CORE_API}/session/:token`, ({ params }) => {
    sessions.forget(params['token'] ?? '');
    return { status: 204, body: null };
  });

  return { router, fleet, sessions, services, startedAt };
}
