/**
 * The smallest router that serves Core's twelve routes.
 *
 * No framework. Core has to run three ways without change: on a workstation
 * inside DAIC, on a laptop at a demo, and on a Pi beside the kiosks. Every
 * dependency is one more thing to install on a machine an archivist owns and a
 * jury might unplug, so this file is the price of having none.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface Reply {
  readonly status: number;
  readonly body: unknown;
  /** Seconds a client may keep this. Absent means no-store, which is the default. */
  readonly maxAge?: number;
}

export interface Ctx {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  /** The caller, for the rate limiter. A LAN address, never stored. */
  readonly from: string;
  /** Parsed JSON body, or null for a request that carried none. */
  readonly body: unknown;
}

export type Handler = (ctx: Ctx) => Reply | Promise<Reply>;

interface Route {
  readonly method: string;
  readonly parts: readonly string[];
  readonly handler: Handler;
}

export const ok = (body: unknown, maxAge?: number): Reply =>
  maxAge === undefined ? { status: 200, body } : { status: 200, body, maxAge };

export const fail = (status: number, message: string): Reply => ({
  status,
  body: { error: message },
});

/** A body over this is refused unread. The largest real one is a dossier of 16 passages. */
const MAX_BODY_BYTES = 256 * 1024;

export class Router {
  private readonly routes: Route[] = [];
  private readonly origins: readonly string[];

  /**
   * `origins` is the CORS allow list. A kiosk is served from its own origin,
   * which is not Core's, so the browser will not talk to Core without this.
   * "*" is the default because a hall LAN has no other origin on it, and a
   * deployment that faces the public sets TORAN_CORE_ORIGINS instead.
   */
  constructor(origins: readonly string[] = ['*']) {
    this.origins = origins;
  }

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
    return this;
  }

  get = (pattern: string, handler: Handler) => this.add('GET', pattern, handler);
  put = (pattern: string, handler: Handler) => this.add('PUT', pattern, handler);
  post = (pattern: string, handler: Handler) => this.add('POST', pattern, handler);
  delete = (pattern: string, handler: Handler) => this.add('DELETE', pattern, handler);

  private match(
    method: string,
    path: string,
  ): { handler: Handler; params: Record<string, string> } | null {
    const parts = path.split('/').filter(Boolean);
    let pathExists = false;
    for (const route of this.routes) {
      if (route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < parts.length; i++) {
        const spec = route.parts[i]!;
        const given = parts[i]!;
        if (spec.startsWith(':')) params[spec.slice(1)] = decodeURIComponent(given);
        else if (spec !== given) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      pathExists = true;
      if (route.method === method) return { handler: route.handler, params };
    }
    // A path that exists under another verb is a 405, not a 404. The
    // difference is what tells an operator their client is wrong rather than
    // their URL.
    if (pathExists) throw new MethodNotAllowed();
    return null;
  }

  private allowOrigin(origin: string | undefined): string | null {
    if (this.origins.includes('*')) return '*';
    if (origin !== undefined && this.origins.includes(origin)) return origin;
    return null;
  }

  listen(port: number, host: string) {
    const server = createServer((req, res) => void this.handle(req, res));
    server.listen(port, host);
    return server;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    const allowed = this.allowOrigin(Array.isArray(origin) ? origin[0] : origin);
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      // Core answers with JSON only, so there is nothing a browser should
      // ever sniff a type for.
      'x-content-type-options': 'nosniff',
    };
    if (allowed !== null) {
      headers['access-control-allow-origin'] = allowed;
      headers['access-control-allow-headers'] = 'content-type';
      headers['access-control-allow-methods'] = 'GET, PUT, POST, DELETE, OPTIONS';
      headers['vary'] = 'origin';
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(allowed === null ? 403 : 204, headers);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://core.invalid');
    let reply: Reply;
    try {
      const found = this.match(req.method ?? 'GET', url.pathname);
      if (found === null) {
        reply = fail(404, `no route for ${url.pathname}`);
      } else {
        reply = await found.handler({
          method: req.method ?? 'GET',
          path: url.pathname,
          params: found.params,
          query: url.searchParams,
          from: req.socket.remoteAddress ?? 'unknown',
          body: await readBody(req),
        });
      }
    } catch (error) {
      reply = errorReply(error);
    }

    if (reply.maxAge !== undefined) {
      headers['cache-control'] = `public, max-age=${String(reply.maxAge)}`;
    }
    const payload = JSON.stringify(reply.body);
    headers['content-length'] = String(Buffer.byteLength(payload));
    res.writeHead(reply.status, headers);
    res.end(payload);
  }
}

export class MethodNotAllowed extends Error {
  public override readonly name = 'MethodNotAllowed';
}

export class BadRequest extends Error {
  public override readonly name = 'BadRequest';
}

export class NotFound extends Error {
  public override readonly name = 'NotFound';
}

export class TooMany extends Error {
  public override readonly name = 'TooMany';
}

export class Unavailable extends Error {
  public override readonly name = 'Unavailable';
}

/**
 * What the client is told. A message it can act on, and nothing about Core's
 * internals: a stack trace in a response body is how a server's file layout
 * ends up in someone's notes.
 */
function errorReply(error: unknown): Reply {
  if (error instanceof MethodNotAllowed) return fail(405, 'method not allowed');
  if (error instanceof BadRequest) return fail(400, error.message);
  if (error instanceof NotFound) return fail(404, error.message);
  if (error instanceof TooMany) return fail(429, error.message);
  if (error instanceof Unavailable) return fail(503, error.message);
  // A WireError or CitationError from the contract means the caller sent
  // something the archive will not store. That is the caller's fault.
  const name = error instanceof Error ? error.name : '';
  if (name === 'WireError' || name === 'CitationError') {
    return fail(400, (error as Error).message);
  }
  console.error('core: unhandled', error);
  return fail(500, 'internal error');
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'DELETE') return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new BadRequest('body too large');
    chunks.push(buffer);
  }
  if (size === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BadRequest('body is not JSON');
  }
}

/**
 * A fixed-window counter, per caller per route.
 *
 * It exists because of a measured ceiling, not as a formality: the Groq free
 * tier this account is served allows 1,000 requests a day and 8,000 tokens a
 * minute across the whole key. One misbehaving page could spend a day's quota
 * in a minute and leave the hall without an assistant, so the limit is
 * enforced here rather than hoped for.
 */
export class RateLimit {
  private readonly windows = new Map<string, { count: number; until: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Counts one use and says whether it was allowed. */
  take(key: string): boolean {
    const at = this.now();
    const found = this.windows.get(key);
    if (found === undefined || at >= found.until) {
      this.windows.set(key, { count: 1, until: at + this.windowMs });
      return true;
    }
    if (found.count >= this.limit) return false;
    found.count++;
    return true;
  }

  /** Seconds until this key is allowed again. */
  retryAfter(key: string): number {
    const found = this.windows.get(key);
    if (found === undefined) return 0;
    return Math.max(0, Math.ceil((found.until - this.now()) / 1000));
  }
}
