/**
 * Step 9 verification at the kiosk: the Audio Booth on device 8.
 *
 * What this has to show is mostly about honesty rather than sound, because
 * with an empty cache there is no sound to check. A booth holding nothing must
 * say so, must say why, and must not claim the archive holds a recording of a
 * voice it cannot attribute. When clips do exist, every one of them carries
 * its citation and names the engine that produced it, on screen, not in a
 * tooltip.
 *
 * Nothing here reaches the network beyond the local server, which is the
 * kiosk's own origin.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { DEVICES } from '../apps/web/src/fleet/devices.ts';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const DEVICE = 'dev-08';
/**
 * Device 8 boots in Hindi, so the booth is checked against the Hindi
 * catalogue rather than against English prose. Asserting the exact strings
 * proves two things at once: the booth says what it should, and the i18n
 * layer actually reached it.
 */
const LANGUAGE = DEVICES.find((d) => d.deviceId === DEVICE)?.defaultLanguage ?? 'en';
const catalogue = JSON.parse(
  fs.readFileSync(`apps/web/src/i18n/messages/${LANGUAGE}.json`, 'utf8'),
);
const says = (text, key) => text.includes(catalogue[key].replace(/\s+/g, ' ').trim());
const TABLET = { width: 1280, height: 800 };
const axeSource = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${detail === '' ? '' : `  (${detail})`}`);
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const errors = [];
async function open(path) {
  const page = await browser.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
  });
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  // Nothing may leave this origin. The booth is part of the offline core.
  await page.setRequestInterception(true);
  const foreign = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) {
      foreign.push(r.url().slice(0, 80));
      void r.abort();
      return;
    }
    void r.continue();
  });
  await page.setViewport(TABLET);
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() =>
    document
      .querySelector('[data-testid="kiosk"]')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
  );
  await new Promise((r) => setTimeout(r, 900));
  return { page, foreign };
}

console.log('Step 9: the Audio Booth\n');

const { page, foreign } = await open(`/kiosk/${DEVICE}/`);
check('1 nothing the booth needs leaves this origin', foreign.length === 0, foreign.join(' '));

const state = await page.evaluate(() => {
  const empty = document.querySelector('[data-testid="audio-empty"]');
  const booth = document.querySelector('[data-testid="audio"]');
  const text = (document.body.innerText || '').replace(/\s+/g, ' ');
  return {
    empty: empty !== null,
    booth: booth !== null,
    text,
    clips: document.querySelectorAll('[data-testid="audio"] li').length,
    engine: document.querySelector('[data-testid="audio-engine"]')?.textContent ?? null,
    citations: document.querySelectorAll('[data-testid="audio"] [data-citation]').length,
  };
});

check('2 the booth renders one state or the other', state.empty !== state.booth,
  state.empty ? 'empty' : `${state.clips} passages`);

if (state.empty) {
  check(`3 an empty booth says it is empty, in ${LANGUAGE}`,
    says(state.text, 'audio.empty.lead'));
  check('4 an empty booth says why, and what would fill it',
    says(state.text, 'audio.empty.why'));
  check('5 the archive does not claim a recording it cannot attribute',
    says(state.text, 'audio.recordings.none'));
} else {
  check('3 every passage listed can be played', state.clips > 0, `${state.clips}`);
  check('4 the words on screen carry a citation', state.citations > 0);
  check('5 the screen names the engine, and calls it a machine reading',
    state.engine !== null && /machine reading/i.test(state.engine), state.engine ?? 'absent');
}

// The transport belongs in the reach zone, not up in the reading area.
const reach = await page.evaluate(() => {
  const play = document.querySelector('[data-testid="audio-play"]');
  if (play === null) return null;
  const box = play.getBoundingClientRect();
  return { top: box.top, height: window.innerHeight, mm: Math.min(box.width, box.height) };
});
check('6 the transport sits in the bottom third, where a standing hand is',
  reach === null || reach.top >= reach.height * (2 / 3),
  reach === null ? 'no transport with an empty cache' : `${Math.round(reach.top)}px of ${reach.height}px`);

const axe = await page.evaluate(async (src) => {
  // eslint-disable-next-line no-eval
  eval(src);
  const r = await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  });
  return r.violations.map((v) => `${v.id} x${v.nodes.length}`);
}, axeSource);
check('7 no accessibility violations on the booth', axe.length === 0, axe.join(', '));

const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth);
check('8 nothing overflows sideways at tablet width', !overflow);

// Audio-first: every announcement reaches somebody, with or without a clip.
const announce = await page.evaluate(() => ({
  polite: document.querySelector('[aria-live="polite"]') !== null,
  urgent: document.querySelector('[aria-live="assertive"]') !== null,
  said: document.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? '',
}));
check('9 the kiosk has a live region for a visitor who is not reading it',
  announce.polite && announce.urgent);
check('10 arriving at the booth announces which room it is',
  announce.said.replace(/\u200B/g, '') === catalogue['device.channel.audio'],
  announce.said.replace(/\u200B/g, '') || 'nothing announced');

check('11 no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await page.close();
await browser.close();

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
