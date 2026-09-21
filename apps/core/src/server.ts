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
  writeReply,
  type CoreService,
  type DeviceConfig,
  type RawChunk,
} from '@toran/contracts';
import { ask } from './assistant/ask.ts';
import type { Provider } from './assistant/provider.ts';
import type { Db } from './db.ts';
import { Fleet, UnknownDevice } from './fleet.ts';
import { BadRequest, fail, NotFound, ok, RateLimit, Router, TooMany } from './http.ts';
import { Sessions } from './session.ts';

export interface CoreOptions {
  readonly db: Db;
  readonly version: string;
  readonly origins: readonly string[];
  /** The hall's devices, used only to seed an empty database. */
  readonly seed: readonly DeviceConfig[];
  /** Absent when no key was configured, and the status then says so. */
  readonly assistant?: Provider | undefined;
  readonly now?: () => number;
}

/**
 * The assistant's ceiling, per caller per minute.
 *
 * Four, because the binding constraint is Groq's 8,000 tokens a minute across
 * the whole key and one question with six passages costs about 2,000. Thirteen
 * devices sharing that is not a per-device limit worth having, so this stops
 * one misbehaving page from spending the hall's minute, and the provider's own
 * 429 stops the hall from spending its day. D-134.
 */
const ASK_PER_MINUTE = 4;

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

  // What this deployment actually serves. A Core with no Groq key still runs
  // the hall; saying so in the status is how a kiosk knows to answer from its
  // cache rather than making a call that fails in front of a visitor.
  const services: readonly CoreService[] = [
    'fleet',
    'session',
    ...(options.assistant === undefined ? [] : (['assistant'] as const)),
  ];
  const asking = new RateLimit(ASK_PER_MINUTE, 60_000, now);

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

  /**
   * A question, and the passages the device's own search found for it.
   *
   * Retrieval stays on the kiosk, so Core holds no corpus and the search
   * stays offline. Only the generation crosses the wire, because only the
   * generation needs a key.
   */
  router.post(`${CORE_API}/assistant/ask`, async ({ body, from }) => {
    const provider = options.assistant;
    if (provider === undefined) {
      // 503 rather than 404: the route exists, this deployment has no key.
      // A kiosk reads the status and answers from its cache instead.
      return fail(503, 'this Core serves no assistant');
    }
    if (typeof body !== 'object' || body === null) {
      throw new BadRequest('a question needs a body');
    }
    const input = body as { question?: unknown; passages?: unknown };
    if (typeof input.question !== 'string' || input.question.trim().length < 3) {
      throw new BadRequest('a question must be a few words');
    }
    if (input.question.length > 400) {
      throw new BadRequest('a question must be shorter than 400 characters');
    }
    if (!Array.isArray(input.passages)) {
      throw new BadRequest('the device must send the passages its search found');
    }
    if (!asking.take(from)) {
      throw new TooMany(
        `wait ${String(asking.retryAfter(from))} seconds; the hall shares one quota`,
      );
    }

    const result = await ask(provider, {
      question: input.question,
      passages: input.passages as RawChunk[],
    });
    // The numbers, not the question and not the answer. What a visitor asked a
    // memorial is not something this server writes down.
    console.log(
      `core: ask ${String(result.ms)}ms ${String(result.attempts)} attempt(s) ` +
        `${String(result.tokens)} tokens ${result.reply.kind}` +
        (result.reply.kind === 'refusal' ? ` ${result.reply.because}` : ''),
    );
    return ok(writeReply(result.reply));
  });

  return { router, fleet, sessions, services, startedAt };
}
