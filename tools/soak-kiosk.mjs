/**
 * Step 10 verification: a kiosk left alone for an hour. STEPS.md step 10,
 * "runs unattended for an hour with no crash and no memory growth".
 *
 * One kiosk, the Provenance Room (dev-03), with everything a hall gives it:
 * the hardware daemon in --simulate mode walking a visitor up every 80 s and
 * tapping a card, a real Toran Core taking its beats, and a hand that traces
 * a node of the graph every few seconds while the visitor is there. That is
 * 45 visits an hour, each one through every proxemic state and a card.
 *
 * Memory is the resident size of the browser's whole process tree, sampled
 * every minute. The claim is about growth, so the check compares the median
 * of minutes 5 to 15, after start-up has settled, with the median of the last
 * ten minutes. A crash, a page error, or a kiosk that stops changing state
 * fails it outright.
 *
 *   npm run build:quiet && npm run soak:kiosk            one hour
 *   SOAK_MINUTES=10 npm run soak:kiosk                   a shorter run
 *
 * Runs in Chrome when there is one and Firefox otherwise. The Pi's Chromium
 * is the target, so a Firefox hour on a desktop is evidence about the page,
 * not about the device. D-157.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, serveExport, sleep, startCore } from './lib/stage.mjs';

const ROOT = process.cwd();
const MINUTES = Number(process.env.SOAK_MINUTES ?? 60);
const CORE_PORT = Number(process.env.CORE_PORT ?? 8794);
const WEB_PORT = Number(process.env.WEB_PORT ?? 4194);
const CORE = `http://127.0.0.1:${CORE_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const OUT = path.join(ROOT, 'apps/web/out');
const GROWTH_LIMIT = 0.1;

/** Resident kilobytes of a process and every process under it, from /proc. */
function treeRss(root) {
  const children = new Map();
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
      // The command name is in parentheses and may hold spaces; the parent
      // pid is the second field after it.
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(entry));
    } catch {
      // A process that ended while we looked.
    }
  }
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const pid = stack.pop();
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      total += Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
    } catch {
      // Gone.
    }
    stack.push(...(children.get(pid) ?? []));
  }
  return total;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : s[Math.floor(s.length / 2)];
};

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'toran-soak-'));
const stopCore = await startCore(CORE_PORT, {
  TORAN_CORE_DB: path.join(scratch, 'core.sqlite'),
});
const stopSite = await serveExport(OUT, WEB_PORT);
const daemon = spawn(
  'python3',
  ['hardware/daemon/toran_daemon.py', '--simulate', '--origin', WEB],
  {
    stdio: 'ignore',
  },
);
await sleep(1000);
const { browser, engine } = await launchBrowser();
const pid = browser.process()?.pid;

const errors = [];
let crashed = false;
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
page.on('error', () => {
  crashed = true;
});
await page.goto(
  `${WEB}/kiosk/dev-03/?sensor=hw&card=hw&status&core=${encodeURIComponent(CORE)}`,
  {
    waitUntil: 'load',
  },
);

console.log(`Soak: dev-03 for ${MINUTES} min in ${engine}, pid ${String(pid)}\n`);

const samples = [];
const states = new Set();
let visits = 0;
let wasPersonal = false;
const started = Date.now();
let nextSample = started;
let nodes = [];
let traced = 0;

while (Date.now() - started < MINUTES * 60_000 && !crashed) {
  const state = await page
    .evaluate(
      () =>
        document.querySelector('[data-testid="kiosk"]')?.getAttribute('data-state') ??
        null,
    )
    .catch(() => null);
  if (state === null) {
    crashed = true;
    break;
  }
  states.add(state);
  const personal = state === 'personal' || state === 'subtle';
  if (personal && !wasPersonal) visits++;
  wasPersonal = personal;
  // A visitor's hand while they are there: trace a node of the graph.
  // The graph loads after the page, so its nodes are read once they are there.
  if (nodes.length === 0) {
    nodes = await page
      .$$eval('[data-node]', (b) => b.map((x) => x.getAttribute('data-node')))
      .catch(() => []);
  }
  if (personal && nodes.length > 0) {
    const node = nodes[Math.floor(Math.random() * nodes.length)];
    const hit = await page
      .evaluate((id) => {
        const button = document.querySelector(`[data-node="${id}"]`);
        button?.click();
        return button !== null;
      }, node)
      .catch(() => false);
    if (hit) traced++;
  }
  if (Date.now() >= nextSample) {
    const minute = Math.round((Date.now() - started) / 60_000);
    const rss = pid === undefined ? 0 : treeRss(pid);
    samples.push({ minute, rssMb: Math.round(rss / 1024) });
    console.log(
      `  minute ${String(minute).padStart(2)}  ${String(Math.round(rss / 1024)).padStart(5)} MB` +
        `  visits ${visits}  nodes traced ${traced}  errors ${errors.length}`,
    );
    nextSample += 60_000;
  }
  await sleep(3000);
}

await browser.close();
daemon.kill('SIGTERM');
stopCore();
await stopSite();
fs.rmSync(scratch, { recursive: true, force: true });

const settled = samples.filter(
  (s) => s.minute >= Math.min(5, MINUTES / 4) && s.minute <= Math.min(15, MINUTES / 2),
);
const last = samples.filter((s) => s.minute > MINUTES - Math.max(2, MINUTES / 6));
const early = median(settled.map((s) => s.rssMb));
const late = median(last.map((s) => s.rssMb));
const growth = (late - early) / early;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${detail === '' ? '' : `  (${detail})`}`);
};
console.log('');
check(`1 no crash in ${MINUTES} minutes`, !crashed);
check('2 no page error', errors.length === 0, errors.slice(0, 3).join(' | '));
check(
  '3 the kiosk kept cycling through its states',
  ['ambient', 'implicit', 'subtle', 'personal'].every((s) => states.has(s)) &&
    visits >= Math.floor(MINUTES / 1.5),
  `${visits} visits, ${traced} nodes traced`,
);
check(
  `4 memory did not grow by more than ${GROWTH_LIMIT * 100}%`,
  Number.isFinite(growth) && growth <= GROWTH_LIMIT,
  `${early} MB settled, ${late} MB at the end, ${(growth * 100).toFixed(1)}%`,
);
if (process.env.SOAK_OUT) {
  fs.writeFileSync(
    process.env.SOAK_OUT,
    JSON.stringify({ engine, MINUTES, samples, visits, traced, errors }, null, 2),
  );
}
console.log(failures === 0 ? '\nsoak passed' : `\nsoak: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
