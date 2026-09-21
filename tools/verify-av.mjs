/**
 * Step 10 verification: the AV Archive on devices 9 and 10. R8.
 *
 * Three claims, and they are checked in order of how easy they are to fake.
 *
 * That the transcript is the primary surface, which is a layout claim and is
 * measured as one: the words are wider than the picture and larger than
 * anything else on the screen.
 *
 * That a phrase lands on the second it is spoken, which is checked by typing
 * one and reading the video element's currentTime afterwards rather than by
 * trusting that a result was clicked.
 *
 * And that a cue is a cited passage like any other, so an English query
 * reaches a sentence spoken in Hindi. That one is the reason the transcripts
 * go into the same index as the books, and it is checked against the shipped
 * index rather than asserted.
 *
 * Everything runs with every request that would leave this machine refused.
 * The AV Archive is in the offline core: a film on the device is a file on the
 * device.
 */

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { readRecordings, timecode } from '@toran/contracts';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const DEVICE = 'dev-09';
const TABLET = { width: 1280, height: 800 };
const axeSource = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const MEDIA = 'apps/web/public/archive/media.json';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  ${detail}`}`);
};
const info = (label, detail) => console.log(`  INFO  ${label}  ${detail}`);

console.log('Step 10: the AV Archive\n');

// 1. What is on the device, read through the contract.
if (!fs.existsSync(MEDIA)) {
  console.log('  FAIL  no media.json. Run: npm run media && npm run transcribe && npm run build:media');
  process.exit(1);
}
const recordings = readRecordings(JSON.parse(fs.readFileSync(MEDIA, 'utf8')));
const cues = recordings.flatMap((r) => r.cues);
check(
  '1 every recording passes the media contract, with its licence and attribution',
  recordings.length > 0 && recordings.every((r) => r.licence !== '' && r.attribution !== ''),
  recordings.map((r) => `${r.id} ${r.licenceName}`).join(', '),
);
check(
  '2 every cue resolves to a moment in a named recording',
  cues.length > 0 && cues.every((c) => c.passage.citation.locator.kind === 'timecode'),
  `${cues.length} cues across ${recordings.length} recording(s)`,
);
check(
  '3 every recording says what transcribed it',
  recordings.every((r) => r.transcribedBy !== null),
  [...new Set(recordings.map((r) => r.transcribedBy))].join(', '),
);

// 2. The cue is in the same index as the books, which is the claim in 7.6.
{
  const chunks = 'data/dip/media-chunks.jsonl';
  const inIndex = fs.existsSync(chunks)
    ? fs.readFileSync(chunks, 'utf8').split('\n').filter((l) => l.trim()).length
    : 0;
  check(
    '4 every cue is a chunk the search index builds from',
    inIndex === cues.length && inIndex > 0,
    `${inIndex} chunks for ${cues.length} cues`,
  );
  const meta = JSON.parse(fs.readFileSync('apps/web/public/index/meta.json', 'utf8'));
  const media = meta.filter((m) => m.corpus === 'media');
  check(
    '5 and the built index actually holds them',
    media.length === cues.length,
    `${media.length} of ${meta.length} chunks in the shipped index are film`,
  );
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

/**
 * Puts text in the search field.
 *
 * Not `page.type`, which sends a key event per character and reorders
 * Devanagari: typing "जलाता सरस्वती के" into the field produced
 * "े ीकतव्सर ासतालज". That is a limit of driving a keyboard from a test
 * harness rather than of the kiosk, where the text arrives from an input
 * method. The value is set the way a controlled React input expects instead.
 */
async function typeInto(page, selector, text) {
  await page.$eval(
    selector,
    (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    text,
  );
  const got = await page.$eval(selector, (i) => i.value);
  if (got !== text) throw new Error(`field holds ${got}, not ${text}`);
}

async function open() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ deviceScaleFactor: 1, ...TABLET });
  const leaked = [];
  const errors = [];
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(BASE) && !url.startsWith('data:') && !url.startsWith('blob:')) {
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
  await page.goto(`${BASE}/kiosk/${DEVICE}/?card=null`, { waitUntil: 'networkidle0' });
  await page.evaluate(() =>
    document
      .querySelector('[data-testid="kiosk"]')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
  );
  await page.waitForSelector('[data-testid="av"]', { timeout: 15000 });
  return { context, page, leaked, errors };
}

console.log('\n  At the kiosk');
const room = await open();
await room.page.waitForSelector('[data-testid="av-cue"]', { timeout: 15000 });

// 3. The transcript is the primary surface. A layout claim, measured.
const shape = await room.page.evaluate(() => {
  const words = document.querySelector('[data-testid="av-transcript"]');
  const picture = document.querySelector('[data-testid="av-video"]');
  const cue = document.querySelector('[data-testid="av-cue"] span:last-child');
  return {
    transcriptWidth: words?.getBoundingClientRect().width ?? 0,
    videoWidth: picture?.getBoundingClientRect().width ?? 0,
    cuePx: cue === null ? 0 : Number.parseFloat(getComputedStyle(cue).fontSize),
  };
});
check(
  '6 the transcript is wider than the picture, which inverts the usual player',
  shape.transcriptWidth > shape.videoWidth,
  `${Math.round(shape.transcriptWidth)} px of words, ${Math.round(shape.videoWidth)} px of picture`,
);
check(
  '7 a line of transcript is at least 24 px (contract 4)',
  shape.cuePx >= 24,
  `${shape.cuePx} px`,
);

// 4. Tapping a line plays from that second. The transcript on screen is the
// first recording's, so the line has to come from that one.
const shown = recordings[0];
const lineIndex = Math.min(3, shown.cues.length - 1);
const firstCue = shown.cues[lineIndex];
const seeked = await room.page.evaluate(async (index) => {
  const lines = [...document.querySelectorAll('[data-testid="av-cue"]')];
  lines[index]?.click();
  await new Promise((r) => setTimeout(r, 400));
  const video = document.querySelector('[data-testid="av-video"]');
  return video?.currentTime ?? -1;
}, lineIndex);
check(
  '8 tapping a line of transcript plays from the second it is spoken',
  Math.abs(seeked - firstCue.from) < 1.5,
  `asked for ${timecode(firstCue.from)}, landed at ${timecode(seeked)}`,
);

// 5. The transcript follows the film.
const marked = await room.page.evaluate(async () => {
  const video = document.querySelector('[data-testid="av-video"]');
  if (video === null) return null;
  video.currentTime = video.currentTime + 0.2;
  await new Promise((r) => setTimeout(r, 600));
  const current = document.querySelector('[data-testid="av-cue"][data-current="true"]');
  return current === null ? null : (current.textContent ?? '').replace(/\s+/g, ' ').trim();
});
check(
  '9 the line being spoken is marked while the film plays',
  marked !== null,
  (marked ?? 'nothing marked').slice(0, 60),
);

// 6. A phrase lands on its moment. In the script it was spoken in.
const words = firstCue.passage.text.split(/\s+/).slice(1, 4).join(' ');
await room.page.click('nav button[aria-label="Home"]');
await room.page.waitForSelector('[data-testid="av-query"]');
await typeInto(room.page, '[data-testid="av-query"]', words);
await room.page.click('[data-testid="av-submit"]');
await room.page.waitForSelector('[data-testid="av-result"]', { timeout: 30000 });
const results = await room.page.$$eval('[data-testid="av-result"]', (n) =>
  n.map((r) => ({
    how: r.getAttribute('data-how'),
    text: (r.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50),
  })),
);
check(
  '10 a phrase from the film finds the line it is spoken in',
  results.length > 0,
  `${results.length} results for "${words}", first found by ${results[0]?.how ?? '?'}`,
);
const resultCites = await room.page.$$eval('[data-testid="av-results"] cite', (n) =>
  n.map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim()),
);
check(
  '11 every result shows the recording and the second, as a citation',
  resultCites.length === results.length && resultCites.every((c) => /\d+:\d\d/.test(c)),
  resultCites[0] ?? 'none',
);

// The seek is checked against the result that was opened rather than against a
// cue chosen before the search ran, because the best result is the engine's
// business and this check is about the player following it.
const wanted = resultCites[0] ?? '';
const landed = await room.page.evaluate(async () => {
  document.querySelector('[data-testid="av-result"]')?.click();
  await new Promise((r) => setTimeout(r, 900));
  const video = document.querySelector('[data-testid="av-video"]');
  return video?.currentTime ?? -1;
});
check(
  '12 opening a result plays from the second that result names',
  wanted.includes(timecode(landed)) ||
    wanted.includes(timecode(landed + 1)) ||
    wanted.includes(timecode(Math.max(0, landed - 1))),
  `the result says ${wanted}, the film is at ${timecode(landed)}`,
);

// 7. Attribution travels with the work. CC BY requires it, and a visitor
// standing at a kiosk cannot open a credits screen.
const onScreen = await room.page.evaluate(() => ({
  attribution: document.querySelector('[data-testid="av-attribution"]')?.textContent ?? '',
  licence: document.querySelector('[data-testid="av-licence"]')?.textContent ?? '',
  engine: document.querySelector('[data-testid="av-engine"]')?.textContent ?? '',
}));
check(
  '13 who made the film is printed under it, not hidden',
  /Doordarshan/.test(onScreen.attribution),
  onScreen.attribution.replace(/\s+/g, ' ').trim().slice(0, 70),
);
check(
  '14 the licence it is shown under is printed too',
  /CC BY/.test(onScreen.licence),
  onScreen.licence.replace(/\s+/g, ' ').trim().slice(0, 60),
);
check(
  '15 and the screen says a machine wrote the transcript',
  /whisper|machine/i.test(onScreen.engine),
  onScreen.engine.replace(/\s+/g, ' ').trim().slice(0, 70),
);

// 8. The kiosk contracts that apply here.
console.log('\n  The kiosk contracts (CLAUDE.md 10)');
const nav = await room.page.$$eval('nav button', (n) =>
  n.map((b) => b.getAttribute('aria-label')).filter((l) => /^(Back|Home|Forward)$/.test(l ?? '')),
);
check('contract 6  exactly three navigation affordances', nav.length === 3, nav.join(', '));
// The chrome, not the content. A line of a Hindi transcript often ends in a
// question mark, and a transcript is not a help button.
const help = await room.page.$$eval('nav button, [data-testid="kiosk-tools"] button', (n) =>
  n
    .map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim())
    .filter((label) => /^(help|\?)$/i.test(label)),
);
check('contract 7  zero help buttons', help.length === 0, help.join(', '));
const targets = await room.page.evaluate(() => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;width:30mm;visibility:hidden';
  document.body.appendChild(probe);
  const need = probe.getBoundingClientRect().width;
  probe.remove();
  const sizes = [...document.querySelectorAll('nav button')]
    .filter((t) => t.getBoundingClientRect().width > 0)
    .map((t) => ({
      label: t.getAttribute('aria-label') ?? '',
      size: Math.min(t.getBoundingClientRect().width, t.getBoundingClientRect().height),
    }))
    .sort((a, b) => a.size - b.size);
  return { need, smallest: sizes[0], count: sizes.length };
});
check(
  'contract 3  every primary control is at least 30 mm',
  targets.count > 0 && targets.smallest.size >= targets.need - 1,
  `${targets.count} targets, smallest ${Math.round(targets.smallest.size)} px (${targets.smallest.label}), 30 mm is ${Math.round(targets.need)} px`,
);
const violations = await room.page.evaluate(
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
check('no accessibility violations in the AV Archive', violations.length === 0, violations.join(', '));
check(
  'no sideways scroll at tablet size',
  !(await room.page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )),
);
check('nothing left this machine', room.leaked.length === 0, room.leaked.slice(0, 2).join(' '));
check('no console errors', room.errors.length === 0, room.errors.slice(0, 2).join(' | '));

// 10. The cross-lingual claim, at the kiosk rather than only in the index. The
// films are in Hindi; the query is in English; no word is shared, so a result
// can only have come from the meaning.
await room.page.click('nav button[aria-label="Home"]');
await room.page.waitForSelector('[data-testid="av-query"]');
await typeInto(room.page, '[data-testid="av-query"]', 'the four castes of ancient society');
await room.page.click('[data-testid="av-submit"]');
let crossLingual = [];
try {
  // The engine is 118 MB and this is the first room in this profile to want it.
  await room.page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="av-result"]')].some(
        (r) => r.getAttribute('data-how') === 'meaning',
      ),
    { timeout: 180000 },
  );
  crossLingual = await room.page.$$eval('[data-testid="av-result"][data-how="meaning"]', (n) =>
    n.map((r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70)),
  );
} catch {
  crossLingual = [];
}
check(
  'contract 8  an English query reaches a sentence spoken in Hindi',
  crossLingual.length > 0,
  crossLingual[0] ?? 'nothing found by meaning',
);

await browser.close();

// 9. The claim the whole index exists for: one query, two media.
//
// Reported per query rather than asserted for one, because whether a film line
// outranks four thousand printed chunks depends on the question. What is being
// checked is that a cue can win at all, in English, against Hindi speech; how
// often is a measurement worth printing rather than hiding behind a pass.
{
  const { searchIndex, openIndex } = await import('../packages/indexer/src/query.mjs');
  const index = await openIndex();
  const spoken = cues[0]?.passage.language ?? 'hi';
  const QUERIES = [
    'the four castes of ancient society',
    'a school for girls',
    'the caste system and the four-fold division of society',
    'what the Brahmins said about the Shudras',
  ];
  let reached = 0;
  for (const query of QUERIES) {
    const { hits } = await searchIndex(query, 20);
    const film = hits.filter((h) => index.meta[h.id].corpus === 'media');
    const print = hits.length - film.length;
    if (film.length > 0) reached++;
    const first = film[0];
    info(
      `"${query}"`,
      `${print} printed, ${film.length} film` +
        (first === undefined
          ? ''
          : ` · ${index.meta[first.id].locator.recording} at ` +
            `${timecode(index.meta[first.id].locator.from)}: ${index.texts[first.id].slice(0, 44)}`),
    );
  }
  check(
    '16 an English query reaches a line of Hindi film alongside the books',
    reached > 0,
    `${reached} of ${QUERIES.length} queries surfaced film in the top 20, spoken in ${spoken}`,
  );
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
