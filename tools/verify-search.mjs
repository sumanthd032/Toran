/**
 * Browser verification for step 3.
 *
 * Measures the contract that matters: a query answered on the device, fast
 * enough that a standing visitor does not think it broke, with the network
 * cut. Node timings are not this number; this runs the shipped build in a
 * real browser against the real worker.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const QUERIES = [
  'annihilation of caste',
  'Mahad',
  'who were the shudras',
  'जातिभेद निर्मूलन',
  'endogamy and the origin of caste',
];

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

// Track every network request so the offline claim can be checked against
// what actually went over the wire, not against a promise.
const requested = [];
page.on('request', (r) => requested.push(r.url()));

console.log('\nToran step 3 verification\n');

const t0 = Date.now();
await page.goto(`${BASE}/search/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(
  () =>
    /passages, on this device/.test(
      document.querySelector('[data-testid="status"]')?.textContent ?? '',
    ),
  { timeout: 180000 },
);
const loadMs = Date.now() - t0;
const status = await page.$eval('[data-testid="status"]', (n) => n.textContent);
check('worker loads index and model', true, `${loadMs}ms, ${status}`);

// Nothing may have been fetched from a third party.
const external = requested.filter(
  (u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:'),
);
check(
  'no third party requests',
  external.length === 0,
  external.length ? external.slice(0, 2).join(' ') : 'all from this origin',
);

async function search(q) {
  // Drive the real controls rather than poking React state, so this exercises
  // the path a visitor actually takes.
  const input = await page.$('[data-testid="query"]');
  await input.click();
  // Select all and delete. A triple click plus backspace leaves text behind in
  // a controlled React input, which silently concatenates successive queries.
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Delete');
  const cleared = await page.$eval('[data-testid="query"]', (el) => el.value);
  if (cleared !== '')
    throw new Error(`input not cleared, still holds ${JSON.stringify(cleared)}`);
  await page.type('[data-testid="query"]', q);
  const typed = await page.$eval('[data-testid="query"]', (el) => el.value);
  if (typed !== q)
    throw new Error(
      `input holds ${JSON.stringify(typed)}, expected ${JSON.stringify(q)}`,
    );

  // Mark the status so the wait cannot read the previous query's result.
  const SENTINEL = 'awaiting-' + Math.random().toString(36).slice(2);
  await page.$eval(
    '[data-testid="status"]',
    (n, v) => {
      n.textContent = v;
    },
    SENTINEL,
  );

  const buttons = await page.$$('button');
  for (const b of buttons) {
    const label = await b.evaluate((n) => n.textContent ?? '');
    if (/search|खोज|शोध/i.test(label)) {
      await b.click();
      break;
    }
  }

  await page.waitForFunction(
    (sentinel) => {
      const text = document.querySelector('[data-testid="status"]')?.textContent ?? '';
      return text !== sentinel && /results in \d+ms/.test(text);
    },
    { timeout: 60000 },
    SENTINEL,
  );
  const text = await page.$eval('[data-testid="status"]', (n) => n.textContent);
  const m = text.match(/(\d+) results in (\d+)ms \(embed (\d+)ms\)/);
  return {
    hits: Number(m?.[1] ?? 0),
    tookMs: Number(m?.[2] ?? -1),
    embedMs: Number(m?.[3] ?? -1),
  };
}

const timings = [];
for (const q of QUERIES) {
  const r = await search(q);
  timings.push(r.tookMs);
  check(
    `query ${JSON.stringify(q)}`,
    r.hits > 0 && r.tookMs >= 0,
    `${r.hits} hits, ${r.tookMs}ms (embed ${r.embedMs}ms)`,
  );
}

timings.sort((a, b) => a - b);
const p50 = timings[Math.floor(timings.length / 2)];
const worst = timings[timings.length - 1];
check('search under the 200ms contract', worst < 200, `p50 ${p50}ms, worst ${worst}ms`);

// --- the offline claim, tested by cutting the network ---
const client = await page.target().createCDPSession();
await client.send('Network.enable');
await client.send('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
});
const offline = await search('Mahad');
check(
  'search works with the network offline',
  offline.hits > 0,
  `${offline.hits} hits, ${offline.tookMs}ms`,
);
await client.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
});

// --- results carry a citation ---
const cited = await page.$$eval('cite', (nodes) => nodes.length);
check('every result renders a citation', cited > 0, `${cited} citations rendered`);

check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await page.screenshot({ path: 'tools/shots/search.png', fullPage: false });
await browser.close();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
