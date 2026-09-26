/**
 * The built Twin, served by Core from the same origin as the API. D-160.
 *
 * On a laptop the Twin was one process and Core another, joined by ?core=.
 * Deployed, that is two things to host and a cross-origin hop in between. So
 * Core serves `apps/web/out` itself when TORAN_WEB_ROOT names it, and a page
 * finds Core at its own origin. localhost and the deployed hall are then the
 * same program on the same paths.
 *
 * It is a static server and nothing more: files, directory index pages, the
 * export's own 404 page, and byte ranges, because the AV Archive seeks inside
 * films of a hundred megabytes. No path outside the root can be named.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt; charset=utf-8',
};

/** Where a request path lands on disk, or null when it names nothing servable. */
export function resolveStatic(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (stat.isDirectory()) {
    const index = path.join(file, 'index.html');
    return fs.existsSync(index) ? index : null;
  }
  return stat.isFile() ? file : null;
}

/** Hashed build output never changes; everything else may, after a republish. */
function cacheControl(pathname: string): string {
  return pathname.startsWith('/_next/static/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

export function serveStatic(
  root: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const url = new URL(req.url ?? '/', 'http://core.invalid');
  // A directory route without its slash is sent to it, as the export's links expect.
  if (!url.pathname.endsWith('/') && path.extname(url.pathname) === '') {
    const dir = resolveStatic(root, `${url.pathname}/`);
    if (dir !== null) {
      res.writeHead(308, { location: `${url.pathname}/${url.search}` });
      res.end();
      return;
    }
  }
  const file = resolveStatic(root, url.pathname);
  if (file === null) {
    const missing = path.join(root, '404.html');
    res.writeHead(404, { 'content-type': TYPES['.html']!, 'cache-control': 'no-cache' });
    if (req.method === 'HEAD' || !fs.existsSync(missing)) res.end();
    else fs.createReadStream(missing).pipe(res);
    return;
  }
  const size = fs.statSync(file).size;
  const headers: Record<string, string> = {
    'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': cacheControl(url.pathname),
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range !== null && (range[1] !== '' || range[2] !== '')) {
    const start =
      range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
    const end =
      range[1] === '' || range[2] === ''
        ? size - 1
        : Math.min(size - 1, Number(range[2]));
    if (start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${String(size)}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${String(start)}-${String(end)}/${String(size)}`,
      'content-length': String(end - start + 1),
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': String(size) });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
}
