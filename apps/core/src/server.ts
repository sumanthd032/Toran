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

import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CORE_API,
  readBeat,
  readCuratorName,
  readEdgeDecisionInput,
  readMetadataEditInput,
  readOcrCorrectionInput,
  readRightsInput,
  writeReply,
  type CoreService,
  type DeviceConfig,
  type RawChunk,
} from '@toran/contracts';
import { ask } from './assistant/ask.ts';
import type { Provider } from './assistant/provider.ts';
import type { Db } from './db.ts';
import { decideEdge, listEdges } from './curation/edges.ts';
import { ArchiveFiles, CurationRefused, Rebuilder } from './curation/files.ts';
import { checkFixity, listIngest, verifyRights } from './curation/ingest.ts';
import { editMetadata, listWorks } from './curation/metadata.ts';
import { correctOcr, listOcr } from './curation/ocr.ts';
import { Fleet, UnknownDevice } from './fleet.ts';
import {
  BadRequest,
  fail,
  NotFound,
  ok,
  RateLimit,
  Router,
  TooMany,
  Unauthorized,
  Unavailable,
  type Ctx,
  type Reply,
} from './http.ts';
import { Sessions } from './session.ts';

export interface CoreOptions {
  readonly db: Db;
  readonly version: string;
  readonly origins: readonly string[];
  /** The hall's devices, used only to seed an empty database. */
  readonly seed: readonly DeviceConfig[];
  /** Absent when no key was configured, and the status then says so. */
  readonly assistant?: Provider | undefined;
  /**
   * The key a curator presents to change the hall or the archive. Absent means
   * this Core changes neither: the fleet is read only and curation is not
   * served. A kiosk never holds it. D-151.
   */
  readonly curatorKey?: string | undefined;
  /** The repository the archive lives in. Required for curation. */
  readonly archiveRoot?: string | undefined;
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

/**
 * Wrong curator keys allowed per caller per minute before the caller is made
 * to wait. A key of 16 characters or more is not guessed at ten a minute.
 */
const BAD_KEYS_PER_MINUTE = 10;

const digest = (value: string) => createHash('sha256').update(value).digest();

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
  const curating = options.curatorKey !== undefined && options.archiveRoot !== undefined;
  const services: readonly CoreService[] = [
    'fleet',
    'session',
    ...(options.assistant === undefined ? [] : (['assistant'] as const)),
    ...(curating ? (['curation'] as const) : []),
  ];
  const asking = new RateLimit(ASK_PER_MINUTE, 60_000, now);
  const guessing = new RateLimit(BAD_KEYS_PER_MINUTE, 60_000, now);
  const files =
    options.archiveRoot === undefined ? null : new ArchiveFiles(options.archiveRoot);
  const rebuild =
    options.archiveRoot === undefined ? null : new Rebuilder(options.archiveRoot);

  /**
   * The operator check, for every route that changes the hall or the archive.
   *
   * Compared as digests with a constant-time comparison, so the time a wrong
   * key takes to refuse says nothing about how much of it was right. A caller
   * who has spent its wrong guesses for the minute is refused before the
   * comparison, so a right guess after that does not get through either.
   */
  const operator = (ctx: Ctx): void => {
    const key = options.curatorKey;
    if (key === undefined) {
      throw new Unavailable(
        'this Core has no curator key, so the hall and the archive are read only',
      );
    }
    if (guessing.exhausted(ctx.from)) {
      throw new TooMany(`wait ${String(guessing.retryAfter(ctx.from))} seconds`);
    }
    const given = /^Bearer (.+)$/.exec(ctx.authorization ?? '')?.[1] ?? '';
    if (!timingSafeEqual(digest(given), digest(key))) {
      guessing.take(ctx.from);
      throw new Unauthorized('this needs a curator key');
    }
  };

  /** A curation route: the operator check, then the archive, then a refusal the curator can read. */
  const curation =
    (
      handler: (
        ctx: Ctx,
        files: ArchiveFiles,
        rebuild: Rebuilder,
      ) => Reply | Promise<Reply>,
    ) =>
    async (ctx: Ctx): Promise<Reply> => {
      operator(ctx);
      if (files === null || rebuild === null) {
        throw new Unavailable('this Core was started without the archive beside it');
      }
      try {
        return await handler(ctx, files, rebuild);
      } catch (error) {
        // A refusal is a curator's to act on: reload, or pick another value.
        if (error instanceof CurationRefused) return fail(409, error.message);
        throw error;
      }
    };

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

  router.put(`${CORE_API}/fleet/:deviceId`, (ctx) => {
    operator(ctx);
    if (ctx.body === null) throw new BadRequest('a config change needs a body');
    // A config for a device the hall does not have would put a machine on the
    // Twin that nobody can walk up to.
    if (fleet.config(ctx.params['deviceId'] ?? '') === null) {
      throw new NotFound(`no device ${ctx.params['deviceId'] ?? ''} in this hall`);
    }
    return ok(fleet.put(ctx.params['deviceId'] ?? '', ctx.body));
  });

  // The console asks this first, so a wrong key is found out before a curator
  // has written a correction they then cannot save.
  router.get(
    `${CORE_API}/curation`,
    curation(() => ok({ curation: true })),
  );

  router.get(
    `${CORE_API}/curation/edges`,
    curation((_, files) => ok(listEdges(files))),
  );

  router.post(
    `${CORE_API}/curation/edges`,
    curation(async ({ body }, files, rebuild) => {
      const decided = decideEdge(files, readEdgeDecisionInput(body), now);
      // Rebuilt at once, so the link is drawn as decided on the next load.
      const built = await rebuild.run('tools/build-graph.mjs');
      return ok({ decided, rebuilt: built.ok, edges: listEdges(files) });
    }),
  );

  router.get(
    `${CORE_API}/curation/ocr`,
    curation((_, files) => ok(listOcr(files))),
  );

  router.post(
    `${CORE_API}/curation/ocr`,
    curation(async ({ body }, files, rebuild) => {
      const corrected = correctOcr(files, readOcrCorrectionInput(body), now);
      const built = await rebuild.run('tools/build-scans.mjs');
      return ok({ corrected, rebuilt: built.ok, pages: listOcr(files) });
    }),
  );

  router.get(
    `${CORE_API}/curation/metadata`,
    curation((_, files) => ok(listWorks(files))),
  );

  router.post(
    `${CORE_API}/curation/metadata`,
    curation(async ({ body }, files, rebuild) => {
      const work = editMetadata(files, readMetadataEditInput(body), now);
      const built = await rebuild.run('tools/build-archive.mjs');
      return ok({ work, rebuilt: built.ok, works: listWorks(files) });
    }),
  );

  router.get(
    `${CORE_API}/curation/ingest`,
    curation((_, files) => ok(listIngest(files))),
  );

  router.post(
    `${CORE_API}/curation/fixity`,
    curation(async ({ body }, files) => {
      const input =
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>)
          : {};
      if (typeof input['id'] !== 'string')
        throw new BadRequest('say which package to check');
      const result = await checkFixity(
        files,
        input['id'],
        readCuratorName(input['by']),
        now,
      );
      return ok({ result, items: listIngest(files) });
    }),
  );

  router.post(
    `${CORE_API}/curation/rights`,
    curation(({ body }, files) => {
      const decision = verifyRights(files, readRightsInput(body), now);
      return ok({ decision, items: listIngest(files) });
    }),
  );

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
