/**
 * Step 10 verification: the kiosk hardware daemon, driving a real kiosk.
 *
 * Runs hardware/daemon/toran_daemon.py in --simulate mode on the port the
 * kiosk expects, opens a kiosk with the hardware drivers (?sensor=hw&card=hw)
 * and watches a scripted visitor walk up, tap a card and leave. The daemon's
 * own tests cover the PN532 frames and the socket; this covers the part in
 * between, which is where a daemon and a browser disagree.
 *
 * It does not cover the HC-SR04 or the PN532 themselves. Those need a Pi,
 * and until one is on the bench that is unmeasured, not passed. D-156.
 *
 *   npm run build:quiet && npm run verify:hardware
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { launchBrowser, serveExport, sleep } from './lib/stage.mjs';

const ROOT = process.cwd();
const WEB_PORT = Number(process.env.WEB_PORT ?? 4193);
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const OUT = path.join(ROOT, 'apps/web/out');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${detail === '' ? '' : `  (${detail})`}`);
};

function daemon(args) {
  const child = spawn('python3', ['hardware/daemon/toran_daemon.py', ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let log = '';
  child.stderr.on('data', (b) => (log += String(b)));
  return { child, log: () => log };
}

/** A raw upgrade request, so the Origin header is ours to set. */
function upgrade(origin) {
  return new Promise((resolve) => {
    const socket = net.connect(8765, '127.0.0.1', () => {
      socket.write(
        'GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`,
      );
    });
    let got = '';
    socket.on('data', (b) => {
      got += b.toString('latin1');
      if (got.includes('\r\n\r\n')) {
        socket.destroy();
        resolve(got.split('\r\n')[0]);
      }
    });
    socket.on('error', () => resolve('error'));
  });
}

console.log('Step 10: the hardware daemon\n');

// 1. It will not listen anywhere but loopback.
const exposed = daemon(['--simulate', '--host', '0.0.0.0']);
const exposedCode = await new Promise((resolve) => exposed.child.on('exit', resolve));
check(
  '1 the daemon refuses to listen on anything but loopback',
  exposedCode !== 0,
  exposed.log().trim().split('\n').at(-1),
);

const stopSite = await serveExport(OUT, WEB_PORT);
const run = daemon(['--simulate', '--origin', WEB]);
await sleep(1000);
const { browser, engine } = await launchBrowser();

try {
  // 2
  const allowed = await upgrade(WEB);
  const stranger = await upgrade('https://example.org');
  check(
    "2 the kiosk's own origin is let in, and any other page is turned away",
    allowed.includes('101') && stranger.includes('403'),
    `${allowed}; ${stranger}`,
  );

  // 3. The kiosk, driven by the daemon, through one visit.
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${WEB}/kiosk/dev-03/?sensor=hw&card=hw&status`, { waitUntil: 'load' });
  const seen = new Set();
  let session = false;
  const started = Date.now();
  while (Date.now() - started < 100_000) {
    const now = await page.evaluate(() => ({
      state:
        document.querySelector('[data-testid="kiosk"]')?.getAttribute('data-state') ??
        null,
      sensor: document.querySelector('[data-testid="kiosk-status"]')?.textContent ?? '',
      held:
        document
          .querySelector('[data-testid="kiosk-card"]')
          ?.getAttribute('data-held') === 'true',
    }));
    if (now.state !== null) seen.add(now.state);
    if (now.held) session = true;
    if (
      seen.has('personal') &&
      session &&
      (seen.has('decaying') || [...seen].at(-1) !== 'personal')
    )
      break;
    await sleep(500);
  }
  const status = await page.$eval(
    '[data-testid="kiosk-status"]',
    (e) => e.textContent ?? '',
  );
  check(
    '3 the kiosk reads the daemon as its sensor, and a visitor walks through every zone',
    ['ambient', 'implicit', 'subtle', 'personal'].every((s) => seen.has(s)) &&
      /hardware live/.test(status),
    `${[...seen].join(' > ')}; ${/hardware live/.test(status) ? 'hardware live' : status}`,
  );
  check('4 a card tapped at the reader binds the visit', session);

  // 5. Pull the daemon out from under the kiosk, and put it back.
  run.child.kill('SIGTERM');
  await sleep(4000);
  const down = await page.$eval(
    '[data-testid="kiosk-status"]',
    (e) => e.textContent ?? '',
  );
  const again = daemon(['--simulate', '--origin', WEB]);
  let back = false;
  for (let i = 0; i < 30 && !back; i++) {
    await sleep(500);
    back = /hardware live/.test(
      await page.$eval('[data-testid="kiosk-status"]', (e) => e.textContent ?? ''),
    );
  }
  check(
    '5 when the daemon restarts, the kiosk notices, carries on, and reconnects',
    /hardware (down|connecting)/.test(down) && back,
    `${down.match(/sensor\s*\S+ \S+/)?.[0] ?? down}, then ${back ? 'live again' : 'still down'}`,
  );
  again.child.kill('SIGTERM');
  console.log(
    `\nin ${engine}; the HC-SR04 and the PN532 themselves are unmeasured until a Pi is on the bench`,
  );
} catch (error) {
  failures++;
  console.log(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
} finally {
  run.child.kill('SIGTERM');
  await browser.close();
  await stopSite();
}

console.log(
  failures === 0 ? '\nverify:hardware passed' : `\nverify:hardware: ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
