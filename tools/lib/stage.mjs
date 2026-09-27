/**
 * What a browser check needs around it: the built export served on a port,
 * a Toran Core on another, and a browser.
 *
 * The export is served by a few lines of node:http rather than `npm run
 * serve`, so a check owns its port and stops its server when it is done.
 * The browser is Chrome when the machine has one and Firefox otherwise,
 * because a check that cannot run is a check nobody runs.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.opus': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.vtt': 'text/vtt',
};

/** Serves the static export in `root` on loopback. Resolves to a close function. */
export async function serveExport(root, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory())
      file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return () => new Promise((resolve) => server.close(resolve));
}

/** Starts Toran Core with these extra environment variables, and waits until it answers. */
export async function startCore(port, env) {
  const child = spawn(
    process.execPath,
    ['--no-warnings=ExperimentalWarning', 'apps/core/src/main.ts'],
    {
      // The simulated hall is on by default (D-164). A check asks for it by name
      // when it wants it, so no other check has made-up visitors in its hall.
      env: {
        ...process.env,
        TORAN_CORE_PORT: String(port),
        TORAN_SIMULATE_HALL: '0',
        ...env,
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/v1/status`)).ok)
        return () => child.kill('SIGTERM');
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill('SIGTERM');
  throw new Error('Core did not start');
}

export async function launchBrowser() {
  const chrome = process.env.CHROME ?? '/usr/bin/google-chrome';
  if (fs.existsSync(chrome)) {
    return {
      engine: 'chrome',
      browser: await puppeteer.launch({
        executablePath: chrome,
        headless: 'new',
        args: ['--no-sandbox'],
      }),
    };
  }
  return {
    engine: 'firefox',
    browser: await puppeteer.launch({
      browser: 'firefox',
      executablePath: process.env.FIREFOX ?? '/usr/bin/firefox',
      headless: true,
    }),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
