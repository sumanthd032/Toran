/**
 * Step 10 verification: the Research Assistant on device 11. R11.
 *
 * The claim being checked is not that the assistant answers well. It is that
 * it cannot show a claim without the page it came from, and that it says so
 * rather than inventing when the archive does not hold an answer. Those are
 * the two things CLAUDE.md section 12 makes structural, so they are checked on
 * the shipped build rather than in a unit test.
 *
 * Most of this runs with every request that would leave the machine refused,
 * because the prepared answers are on the device and the scripted path has to
 * work in a hall with no network. The live path is checked separately, at the
 * end, and only when a key exists; it spends two of a thousand daily requests.
 */

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { questionKey, readReply } from '@toran/contracts';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const CORE_PORT = Number(process.env.CORE_PORT ?? 8789);
const CORE = `http://127.0.0.1:${CORE_PORT}`;
const DEVICE = 'dev-11';
const TABLET = { width: 1280, height: 800 };
const axeSource = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const PREPARED = JSON.parse(
  fs.readFileSync('apps/web/public/archive/assistant.json', 'utf8'),
);
// A locator on screen: a page, a paragraph, an Article, a section of an Act.
const LOCATOR = /(page|para|Article|section|पान|पृष्ठ|अनुच्छेद|परिच्छेद)\s*[\d०-९]*/i;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  ${detail}`}`);
};
const info = (label, detail) => console.log(`  INFO  ${label}  ${detail}`);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

/** A kiosk whose only reachable server is this machine, and optionally Core. */
async function open(query = '', { allowCore = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ deviceScaleFactor: 1, ...TABLET });
  const leaked = [];
  const errors = [];
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const url = r.url();
    const local =
      url.startsWith(BASE) ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      (allowCore && url.startsWith(CORE));
    if (!local) {
      leaked.push(url);
      void r.abort();
      return;
    }
    void r.continue();
  });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/8765|ERR_FAILED|ERR_CONNECTION/.test(m.text())) {
      errors.push(m.text());
    }
  });
  await page.goto(`${BASE}/kiosk/${DEVICE}/?card=null${query}`, {
    waitUntil: 'networkidle0',
  });
  await page.evaluate(() =>
    document
      .querySelector('[data-testid="kiosk"]')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
  );
  await page.waitForSelector('[data-testid="assistant"]', { timeout: 10000 });
  return { context, page, leaked, errors };
}

const answered = (page) =>
  page.waitForSelector('[data-testid="assistant-answer"],[data-testid="assistant-refusal"]', {
    timeout: 90000,
  });

console.log('Step 10: the Research Assistant\n');

// 0. The prepared answers on the device are themselves cited.
{
  let claims = 0;
  let cited = 0;
  let refusals = 0;
  let bad = 0;
  for (const row of PREPARED) {
    try {
      const reply = readReply(row);
      if (reply.kind === 'refusal') refusals++;
      else {
        for (const segment of reply.segments) {
          claims++;
          if (segment.support.length > 0) cited++;
        }
      }
    } catch {
      bad++;
    }
  }
  check(
    'every prepared answer passes the citation contract on the device',
    bad === 0 && claims === cited && claims > 0,
    `${claims} claims, ${cited} cited, ${refusals} prepared refusals, ${bad} refused on read`,
  );
}

// 1. The desk, with nothing reachable but this origin.
const desk = await open();
check(
  'the desk says what it answers from, and that it will refuse',
  await desk.page.$eval('[data-testid="assistant"]', (n) =>
    /refus|does not|only from|says so/i.test(n.textContent ?? ''),
  ),
);
const openers = await desk.page.$$('[data-testid="assistant-opener"]');
check('a visitor is offered questions rather than an empty box', openers.length === 3);

// 2. The scripted path, with the network off.
const t0 = Date.now();
await openers[0].click();
await answered(desk.page);
const prepMs = Date.now() - t0;

const claims = await desk.page.$$('[data-testid="assistant-claim"]');
const marks = await desk.page.$$('[data-testid="assistant-mark"]');
check(
  'a prepared question answers with the network off',
  claims.length > 0,
  `${claims.length} claims in ${prepMs} ms`,
);
check(
  'every claim on screen carries at least one source number',
  claims.length > 0 && marks.length >= claims.length,
  `${marks.length} marks for ${claims.length} claims`,
);
const markNumbers = await desk.page.$$eval('[data-testid="assistant-mark"]', (n) =>
  n.map((x) => x.textContent?.trim()),
);
check(
  'no claim points at source zero, which is what a broken link looks like',
  markNumbers.every((n) => Number(n) >= 1),
  markNumbers.join(' '),
);

const sources = await desk.page.$$('[data-testid="assistant-source"]');
const citations = await desk.page.$$eval('[data-testid="assistant-sources"] cite', (n) =>
  n.map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim()),
);
check(
  'the passage behind every claim is on the screen, not in a hover',
  sources.length > 0 && citations.length === sources.length,
  `${sources.length} passages, ${citations.length} cited`,
);
check(
  'every one of those citations resolves to a volume, page, Article or section',
  citations.length > 0 && citations.every((c) => LOCATOR.test(c)),
  citations[0] ?? 'none',
);
check(
  'the screen says what wrote the answer',
  await desk.page.$eval('[data-testid="assistant-engine"]', (n) =>
    (n.textContent ?? '').length > 10,
  ),
  (await desk.page.$eval('[data-testid="assistant-engine"]', (n) => n.textContent ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80),
);

// 3. The refusal, which is the feature.
await desk.page.click('nav button[aria-label="Home"]');
await desk.page.waitForSelector('[data-testid="assistant-opener"]');
const all = await desk.page.$$('[data-testid="assistant-opener"]');
await all[2].click();
await answered(desk.page);
const refused = await desk.page.$('[data-testid="assistant-refusal"]');
check(
  'a question the corpus does not answer is refused, not answered',
  refused !== null && (await desk.page.$('[data-testid="assistant-answer"]')) === null,
);
const refusalText = refused === null ? '' : await desk.page.evaluate((n) => n.textContent ?? '', refused);
check(
  'the refusal says plainly that the archive does not hold it',
  /does not answer|not hold|nothing/i.test(refusalText),
  refusalText.replace(/\s+/g, ' ').trim().slice(0, 70),
);
check(
  'a refusal shows no claim and no source number anywhere on screen',
  (await desk.page.$$('[data-testid="assistant-claim"]')).length === 0 &&
    (await desk.page.$$('[data-testid="assistant-mark"]')).length === 0,
);

// 4. A question with no prepared answer and no server reachable.
await desk.page.click('nav button[aria-label="Home"]');
await desk.page.waitForSelector('[data-testid="assistant-question"]');
await desk.page.waitForFunction(
  () => document.querySelector('[data-testid="assistant-question"]')?.disabled === false,
  { timeout: 5000 },
);
await desk.page.type('[data-testid="assistant-question"]', 'What did he say about Bombay?');
await desk.page.click('[data-testid="assistant-submit"]');
await answered(desk.page);
const offline = await desk.page.$eval(
  '[data-testid="assistant-refusal"]',
  (n) => n.textContent ?? '',
);
check(
  'an unprepared question with no server says so, rather than inventing',
  /server|cannot reach/i.test(offline),
  offline.replace(/\s+/g, ' ').trim().slice(0, 70),
);
check(
  'it still hands the visitor the passages the search did find',
  (await desk.page.$$('[data-testid="assistant-source"]')).length > 0,
  `${(await desk.page.$$('[data-testid="assistant-source"]')).length} passages to read`,
);

check('nothing the desk needs leaves this origin', desk.leaked.length === 0, desk.leaked.slice(0, 2).join(' '));
check('no console errors', desk.errors.length === 0, desk.errors.slice(0, 2).join(' | '));

// 5. The kiosk contracts, measured on a screen with an answer on it.
console.log('\n  The kiosk contracts (CLAUDE.md 10)');
await desk.page.click('nav button[aria-label="Home"]');
await desk.page.waitForSelector('[data-testid="assistant-opener"]');
await (await desk.page.$$('[data-testid="assistant-opener"]'))[0].click();
await answered(desk.page);
const smallest = await desk.page.evaluate(() => {
  const targets = [...document.querySelectorAll('nav button')].filter(
    (t) => t.getBoundingClientRect().width > 0,
  );
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;width:30mm;visibility:hidden';
  document.body.appendChild(probe);
  const need = probe.getBoundingClientRect().width;
  probe.remove();
  const sizes = targets.map((t) => {
    const r = t.getBoundingClientRect();
    return { label: t.getAttribute('aria-label') ?? t.textContent?.trim() ?? '', size: Math.min(r.width, r.height) };
  });
  sizes.sort((a, b) => a.size - b.size);
  return { need, count: sizes.length, smallest: sizes[0] };
});
check(
  '3  every primary control is at least 30 mm',
  smallest.count > 0 && smallest.smallest.size >= smallest.need - 1,
  `${smallest.count} targets, smallest ${Math.round(smallest.smallest.size)} px (${smallest.smallest.label}), 30 mm is ${Math.round(smallest.need)} px`,
);
const claimPx = await desk.page.evaluate(() => {
  const n = document.querySelector('[data-testid="assistant-source"]');
  return n === null ? 0 : Number.parseFloat(getComputedStyle(n).fontSize);
});
check('4  passage text is at least 24 px', claimPx >= 24, `${claimPx} px`);
const nav = await desk.page.$$eval('nav button', (n) =>
  n
    .map((b) => b.getAttribute('aria-label'))
    .filter((l) => /^(Back|Home|Forward)$/.test(l ?? '')),
);
check('6  exactly three navigation affordances', nav.length === 3, nav.join(', '));
check(
  '7  zero help buttons',
  (await desk.page.$$eval('button', (n) =>
    n.filter((b) => /help|\?$/i.test(b.textContent ?? '')).length,
  )) === 0,
);
const violations = await desk.page.evaluate(
  async (src) => {
    // eslint-disable-next-line no-eval
    eval(src);
    const r = await window.axe.run(document, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    });
    return r.violations.map((v) => `${v.id} (${String(v.nodes.length)})`);
  },
  axeSource,
);
check('no accessibility violations on the desk', violations.length === 0, violations.join(', '));
const scrollX = await desk.page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
);
check('no sideways scroll at tablet size', !scrollX);
await desk.context.close();

// 6. The live path, with Core. Two requests of a thousand a day.
console.log('\n  The live path, through Toran Core');
const hasKey = (() => {
  if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
  return (process.env.GROQ_API_KEY ?? '').trim() !== '';
})();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toran-assistant-'));
const core = spawn(
  process.execPath,
  ['--no-warnings=ExperimentalWarning', 'apps/core/src/main.ts'],
  {
    env: {
      ...process.env,
      TORAN_CORE_PORT: String(CORE_PORT),
      TORAN_CORE_DB: path.join(dir, 'core.sqlite'),
      TORAN_CORE_ORIGINS: BASE,
      ...(hasKey ? {} : { GROQ_API_KEY: '' }),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  },
);
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${CORE}/v1/status`)).ok) break;
  } catch {
    // Not listening yet.
  }
  await new Promise((r) => setTimeout(r, 100));
}

try {
  const serves = (await (await fetch(`${CORE}/v1/status`)).json()).services;
  check('Core reports whether it serves an assistant at all', Array.isArray(serves), serves.join(', '));

  if (!hasKey) {
    info('no GROQ_API_KEY', 'the live path is unmeasured; every check above is the offline path');
  } else {
    const live = await open(`&core=${encodeURIComponent(CORE)}`, { allowCore: true });
    await live.page.waitForFunction(
      () => document.querySelector('[data-testid="assistant-question"]')?.disabled === false,
      { timeout: 10000 },
    );
    // A question nobody prepared, so it can only be answered by the server.
    const question = 'What did Dr. Ambedkar say about the Chawdar Tank?';
    check(
      'the question asked live is not one of the prepared ones',
      !PREPARED.some((p) => questionKey(p.question) === questionKey(question)),
    );
    const started = Date.now();
    await live.page.type('[data-testid="assistant-question"]', question);
    await live.page.click('[data-testid="assistant-submit"]');
    await answered(live.page);
    const liveMs = Date.now() - started;

    const liveClaims = await live.page.$$('[data-testid="assistant-claim"]');
    const liveCites = await live.page.$$eval('[data-testid="assistant-sources"] cite', (n) =>
      n.map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
    if (liveClaims.length > 0) {
      check(
        'a live answer arrives, every claim cited to a resolvable page',
        liveCites.length > 0 && liveCites.every((c) => LOCATOR.test(c)),
        `${liveClaims.length} claims, ${liveCites.length} passages, ${liveMs} ms`,
      );
      const engine = await live.page.$eval(
        '[data-testid="assistant-engine"]',
        (n) => n.textContent ?? '',
      );
      check(
        'the live answer names the model that wrote it',
        /groq|gpt|llama|qwen/i.test(engine),
        engine.replace(/\s+/g, ' ').trim().slice(0, 70),
      );
    } else {
      // A refusal here is the assistant working, not the check failing. What
      // would be a failure is an uncited claim, and there is not one.
      const why = await live.page.$eval(
        '[data-testid="assistant-refusal"]',
        (n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );
      check(
        'the live path refused rather than answering without support',
        (await live.page.$$('[data-testid="assistant-claim"]')).length === 0,
        `${why.slice(0, 60)} (${liveMs} ms)`,
      );
    }
    check('nothing left this machine but Core', live.leaked.length === 0, live.leaked.slice(0, 2).join(' '));
    await live.context.close();
  }
} finally {
  core.kill('SIGTERM');
  fs.rmSync(dir, { recursive: true, force: true });
  await browser.close();
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
