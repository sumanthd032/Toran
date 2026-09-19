/**
 * Step 6 verification: a visitor's path through the hall, against the shipped
 * build, with every request that would leave this machine refused.
 *
 * The card store is the browser's own storage, shared by every kiosk on one
 * origin. That stands in for the hall's Toran Core server until step 10, so
 * card continuity here means two kiosks in one browser, not two machines.
 *
 * The idle timings (45, 90 and 120 seconds) are covered by the state machine's
 * unit tests with exact timestamps, and the 7:1 palette by contrast-check; this
 * measures the rest on the screens a visitor actually sees.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const axeSource = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const jsqrSource = fs.readFileSync('node_modules/jsqr/dist/jsQR.js', 'utf8');
// The Timeline Wall panel: 2.8 m across at 1920 pixels.
const WALL_PPI = 1920 / (2800 / 25.4);
const CAP = 0.672;
const ADA_3M_MM = (5 / 8 + (3 / 0.3048 - 6) / 8) * 25.4;
const LOCATOR = /(page|para|frontispiece|Article|पान|पृष्ठ|अनुच्छेद|परिच्छेद|मुखचित्र|अनुच्छेद)\s*[\d०-९]*/;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const info = (label, detail) => console.log(`  INFO  ${label}  ${detail}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const timings = [];

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

/** A page whose only reachable server is this machine. */
async function open(context, path, viewport = { width: 1280, height: 800 }) {
  const page = await context.newPage();
  await page.setViewport({ deviceScaleFactor: 1, ...viewport });
  const blocked = [];
  const errors = [];
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.url().startsWith(BASE) || r.url().startsWith('data:') || r.url().startsWith('blob:')) {
      r.continue();
    } else {
      blocked.push(r.url());
      r.abort();
    }
  });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/8765|ERR_FAILED/.test(m.text())) errors.push(m.text());
  });
  // Count touch sounds: every one starts one oscillator.
  await page.evaluateOnNewDocument(() => {
    window.__sounds = 0;
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (...args) {
      window.__sounds++;
      return original.apply(this, args);
    };
  });
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  return { page, blocked, errors };
}

/** Time from an action to the moment the screen shows its answer. */
async function timed(label, page, action, until) {
  const t0 = Date.now();
  await action();
  await page.waitForFunction(until, { timeout: 10000 });
  const ms = Date.now() - t0;
  timings.push({ label, ms });
  return ms;
}

const langOf = (page) => page.$eval('[data-testid="kiosk"]', (n) => n.getAttribute('lang'));
const stateOf = (page) => page.$eval('[data-testid="kiosk"]', (n) => n.getAttribute('data-state'));

async function decodeQr(context, page) {
  const svg = await page.$('[data-testid="dossier-qr"]');
  const png = await svg.screenshot({ encoding: 'base64' });
  const reader = await context.newPage();
  await reader.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await reader.evaluate(jsqrSource);
  const text = await reader.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0);
    const pixels = g.getImageData(0, 0, canvas.width, canvas.height);
    // eslint-disable-next-line no-undef
    return jsQR(pixels.data, pixels.width, pixels.height)?.data ?? null;
  }, png);
  await reader.close();
  return text;
}

/** Every passage on screen, and whether each carries a locator a reader can follow. */
const citedOnScreen = (page, scope) =>
  page.$$eval(`${scope} blockquote, ${scope} [data-testid="reading-hit"], ${scope} [data-testid="dossier-item"], ${scope} [data-testid="takehome-passage"], ${scope} li:has(> button > cite)`, (nodes, pattern) => {
    const re = new RegExp(pattern);
    // A passage is counted once: a quotation inside a kept item is that item.
    const outer = nodes.filter((n) => !nodes.some((m) => m !== n && m.contains(n)));
    const visible = outer.filter((n) => n.getBoundingClientRect().width > 0);
    return {
      shown: visible.length,
      cited: visible.filter((n) => {
        const cite = n.querySelector('cite');
        return cite !== null && re.test(cite.textContent ?? '');
      }).length,
    };
  }, LOCATOR.source);

async function search(page, query) {
  await page.waitForFunction(() => document.querySelector('[data-testid="reading-query"]')?.disabled === false, { timeout: 90000 });
  const input = await page.$('[data-testid="reading-query"]');
  await input.click({ clickCount: 3 });
  await input.type(query);
  return timed('search, submit to results', page, () => page.keyboard.press('Enter'), () =>
    document.querySelectorAll('[data-testid="reading-hit"]').length > 0,
  );
}

console.log('\nToran step 6 verification: the visitor\n');

// ---- 1. end to end with the network off, with a card ----
const hall = await browser.createBrowserContext();
let kept = null;
{
  console.log('  With a card, nothing reachable but this machine');
  const entrance = await open(hall, '/kiosk/dev-13/?card=sim');
  await entrance.page.click('[data-testid="entrance"] button:has(span[lang="mr"])');
  await wait(300);
  await entrance.page.keyboard.press('F8');
  await entrance.page.waitForSelector('[data-testid="entrance-card"][data-held="true"]', { timeout: 5000 });
  check('the entrance issues a card carrying Marathi', (await langOf(entrance.page)) === 'mr');

  const room = await open(hall, '/kiosk/dev-01/?sensor=sim&card=sim');
  const trail = [];
  for (const key of ['0', '2', '4']) {
    await room.page.keyboard.press(key);
    await wait(700);
    trail.push(await stateOf(room.page));
  }
  check('approaching the kiosk changes its state', trail.join() === 'ambient,implicit,personal', trail.join(' > '));
  check('the Reading Room starts in its own language', (await langOf(room.page)) === 'en');
  const tap = await timed('card tap to Marathi', room.page, () => room.page.keyboard.press('F8'), () =>
    document.querySelector('[data-testid="kiosk"]')?.getAttribute('lang') === 'mr',
  );
  check('tapping the card switches the whole interface to Marathi', (await langOf(room.page)) === 'mr', `${tap} ms`);

  const searchMs = await search(room.page, 'महाड सत्याग्रह');
  const hits = await citedOnScreen(room.page, '[data-testid="kiosk"]');
  check('a Marathi query finds the English archive, every result cited', hits.shown > 0 && hits.cited === hits.shown, `${hits.cited} of ${hits.shown}, ${searchMs} ms`);

  await timed('open a result', room.page, () => room.page.click('[data-testid="reading-hit"]'), () =>
    document.querySelector('[data-testid="reading-document"]') !== null,
  );
  const pageCite = await room.page.$eval('[data-testid="reading-document"] cite', (c) => c.textContent ?? '');
  check('the page opened shows its volume and page', LOCATOR.test(pageCite), pageCite.replace(/\s+/g, ' ').trim());
  const abstract = await citedOnScreen(room.page, '[data-testid="reading-abstract"]');
  if (abstract.shown > 0) check('every sentence of the abstract is cited', abstract.cited === abstract.shown, `${abstract.cited} of ${abstract.shown}`);

  // Keep is enabled once the passage the result landed on has been chosen.
  await room.page.waitForFunction(() => document.querySelector('[data-testid="reading-keep"]')?.disabled === false, { timeout: 5000 });
  await timed('keep a passage', room.page, () => room.page.click('[data-testid="reading-keep"]'), () =>
    document.querySelector('[data-testid="reading-keep"]')?.disabled === true,
  );
  await timed('open the dossier with its code', room.page, () => room.page.click('[data-testid="reading-dossier"]'), () =>
    document.querySelector('[data-testid="dossier-qr"]') !== null,
  );
  const items = await citedOnScreen(room.page, '[data-testid="dossier"]');
  check('the dossier holds the kept passage, cited', items.shown === 1 && items.cited === 1, `${items.cited} of ${items.shown}`);
  const url = await decodeQr(hall, room.page);
  kept = url;
  check('the code on screen decodes, from its pixels, to the take-home link', url !== null && /\/dossier\/\?lang=mr#/.test(url), url ?? 'nothing decoded');

  const home = await open(hall, new URL(url).pathname + new URL(url).search + new URL(url).hash, { width: 390, height: 844 });
  await home.page.waitForSelector('[data-testid="takehome-passage"]', { timeout: 10000 });
  const taken = await citedOnScreen(home.page, '[data-testid="takehome"]');
  check('the phone page rebuilds the passage from the link, cited', taken.shown === 1 && taken.cited === 1, `${taken.cited} of ${taken.shown}`);
  check('the phone page reads in the visitor\'s language', (await home.page.$eval('html', (h) => h.lang)) === 'mr');

  const all = [entrance, room, home];
  const blocked = all.flatMap((p) => p.blocked);
  check('no request tried to leave the machine', blocked.length === 0, blocked.slice(0, 3).join(' '));
  const errors = all.flatMap((p) => p.errors);
  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await entrance.page.close();

  // ---- 2. card continuity ----
  console.log('\n  The same card at other kiosks');
  const wall = await open(hall, '/kiosk/dev-04/?card=sim');
  check('the Timeline Wall starts in its own language', (await langOf(wall.page)) === 'en');
  await wall.page.keyboard.press('F8');
  await wall.page.waitForFunction(() => document.querySelector('[data-testid="kiosk"]')?.getAttribute('lang') === 'mr', { timeout: 5000 });
  check('a tap at the Timeline Wall brings the card\'s Marathi', (await langOf(wall.page)) === 'mr');
  await wall.page.close();

  const second = await open(hall, '/kiosk/dev-02/?card=sim');
  await second.page.keyboard.press('F8');
  await wait(400);
  await second.page.click('[data-testid="reading-dossier"]');
  await second.page.waitForSelector('[data-testid="dossier"]');
  const carried = await second.page.$$eval('[data-testid="dossier-item"]', (n) => n.length);
  check('the second Reading Room shows the same dossier', carried === 1, `${carried} passage`);
  await second.page.close();
  await room.page.close();
  await home.page.close();
}
await hall.close();

// ---- 3. no card reader at all ----
{
  console.log('\n  No card reader');
  const context = await browser.createBrowserContext();
  const { page, blocked } = await open(context, '/kiosk/dev-01/?card=null');
  check('there is no card to wait for', (await page.$('[data-testid="kiosk-card"]')) === null);
  await page.click('[data-testid="kiosk-visitor"]');
  await page.waitForSelector('dialog[open]');
  await page.click('dialog[open] button:has(span[lang="mr"])');
  await page.keyboard.press('Escape');
  await wait(400);
  check('the language is chosen by hand', (await langOf(page)) === 'mr');
  await search(page, 'Annihilation of Caste');
  await page.click('[data-testid="reading-hit"]');
  await page.waitForSelector('[data-testid="reading-document"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="reading-keep"]')?.disabled === false, { timeout: 5000 });
  await page.click('[data-testid="reading-keep"]');
  await page.waitForSelector('[data-testid="reading-dossier"]');
  await page.click('[data-testid="reading-dossier"]');
  await page.waitForSelector('[data-testid="dossier-qr"]');
  const url = await decodeQr(context, page);
  check('the dossier compiles locally and still makes a code', url !== null && /#.+/.test(url), url ?? 'nothing decoded');
  check('still nothing leaves the machine', blocked.length === 0, blocked.slice(0, 2).join(' '));
  await context.close();
}

// ---- 4. the Timeline Wall: four hands at once ----
{
  console.log('\n  The Timeline Wall');
  const context = await browser.createBrowserContext();
  const { page, errors } = await open(context, '/kiosk/dev-04/', { width: 2560, height: 1600, hasTouch: true });
  await page.waitForSelector('[data-testid="timeline-story"]');
  const story = await citedOnScreen(page, '[data-testid="timeline"]');
  check('the story on the wall is cited', story.shown > 0 && story.cited === story.shown, `${story.cited} of ${story.shown}`);

  // Drag the rail until 1932 to 1946 are all in reach.
  const axis = await page.$eval('[data-testid="timeline-axis"]', (n) => {
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y + r.height / 2, w: r.width };
  });
  const within = (year) =>
    page.$eval(`[data-year="${year}"]`, (n, a) => {
      const r = n.getBoundingClientRect();
      return r.left >= a.x && r.right <= a.x + a.w;
    }, axis);
  for (let i = 0; i < 12 && !((await within(1932)) && (await within(1946))); i++) {
    const at = await page.$eval('[data-year="1932"]', (n) => n.getBoundingClientRect().left);
    const dx = Math.max(-500, Math.min(500, axis.x + 40 - at));
    await page.mouse.move(axis.x + axis.w / 2, axis.y);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) {
      await page.mouse.move(axis.x + axis.w / 2 + (dx * k) / 10, axis.y);
      await wait(16);
    }
    await page.mouse.up();
    await wait(700);
  }
  check('the rail drags sideways to bring years into reach', (await within(1932)) && (await within(1946)));

  const years = [1932, 1935, 1936, 1946];
  const points = [];
  for (const [id, year] of years.entries()) {
    const c = await page.$eval(`[data-year="${year}"]`, (n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    points.push({ x: c.x, y: c.y, id });
  }
  const sounds0 = await page.evaluate(() => window.__sounds);
  const cdp = await page.createCDPSession();
  const t0 = Date.now();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await wait(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="timeline-card"]').length === 4, { timeout: 5000 }).catch(() => {});
  timings.push({ label: 'four years touched to four cards', ms: Date.now() - t0 });
  const opened = await page.$$eval('[data-testid="timeline-card"]', (n) => n.map((c) => c.dataset.event));
  check('four simultaneous touches open four years', opened.join() === 'poona-pact,yeola,annihilation,shudras', opened.join(', '));
  const sounds = (await page.evaluate(() => window.__sounds)) - sounds0;
  check('every one of the four touches is heard', sounds >= 4, `${sounds} touch sounds`);
  const cards = await citedOnScreen(page, '[data-testid="timeline"]');
  check('every passage on the four cards shows its volume and page', cards.shown >= 4 && cards.cited === cards.shown, `${cards.cited} of ${cards.shown}`);
  const credits = await page.$$eval('[data-testid="timeline-card"] figure', (f) => f.filter((x) => x.querySelector('figcaption')?.textContent?.trim()).length);
  const figures = await page.$$eval('[data-testid="timeline-card"] figure', (f) => f.length);
  check('every photograph says where it came from', figures > 0 && credits === figures, `${credits} of ${figures}`);

  await page.click('[data-testid="timeline-card"][data-event="poona-pact"] [data-testid="timeline-step"]');
  await wait(500);
  const branched = await page.$$eval('[data-testid="timeline-card"]', (n) => n.map((c) => c.dataset.event));
  check('a thread branches from an open event to the next one on it', !branched.includes('poona-pact') && branched.includes('yeola'), branched.join(', '));

  check('no console errors on the wall', errors.length === 0, errors.slice(0, 2).join(' | '));
  await context.close();
}

// ---- 5. the twelve kiosk contracts, measured ----
console.log('\n  The kiosk contracts (CLAUDE.md 10)');
{
  const context = await browser.createBrowserContext();
  const worst = timings.reduce((a, b) => (b.ms > a.ms ? b : a));
  check('1  every interaction answers within 2000 ms', worst.ms < 2000, `slowest: ${worst.label}, ${worst.ms} ms (of ${timings.length} measured)`);
  const searches = timings.filter((t) => t.label.startsWith('search')).map((t) => t.ms);
  info('2  search, submit to results on screen', `${searches.join(', ')} ms on this desktop, the tablet is unmeasured; engine latency is in verify:search`);

  const { page } = await open(context, '/kiosk/dev-04/', { width: 1920, height: 1080 });
  await page.waitForSelector('[data-testid="timeline-story"]');
  await page.click('[data-testid="timeline-story-open"]');
  await page.waitForSelector('[data-testid="timeline-card"]');
  const mm30 = await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;width:30mm;visibility:hidden';
    document.body.appendChild(d);
    const w = d.getBoundingClientRect().width;
    d.remove();
    return w;
  });
  const small = async (p) =>
    p.$$eval('[data-testid="kiosk"] button:not(:disabled)', (b) =>
      b
        .map((n) => ({ r: n.getBoundingClientRect(), n }))
        .filter(({ r }) => r.width > 0 && r.height > 0)
        .map(({ r, n }) => ({ min: Math.min(r.width, r.height), label: n.getAttribute('aria-label') ?? n.textContent?.trim().slice(0, 20) })),
    );
  const targets = await small(page);
  const smallest = targets.reduce((a, b) => (b.min < a.min ? b : a));
  check('3  every touch target on the wall is at least 30 mm', smallest.min >= mm30 - 0.5, `${targets.length} targets, smallest ${smallest.min.toFixed(0)} px (${smallest.label}), 30 mm is ${mm30.toFixed(0)} px`);

  const body = await page.$$eval('[data-testid="timeline"] blockquote p', (p) => p.map((n) => parseFloat(getComputedStyle(n).fontSize)));
  check('4  passage text is at least 24 px', Math.min(...body) >= 24, `${Math.min(...body)} px`);

  const nav = await page.$$eval('nav button', (b) => b.map((n) => n.getAttribute('aria-label')).filter((l) => /^(Back|Home|Forward)$/.test(l ?? '')));
  check('6  exactly three navigation affordances on the wall', nav.length === 3, nav.join(', '));
  const help = await page.$$eval('button, a', (b) => b.filter((n) => /\bhelp\b|\?$/i.test(n.textContent ?? '')).length);
  check('7  zero help buttons on the wall', help === 0, `${help}`);

  // Contrast of the words on a card, measured from the rendered colours.
  const ratio = await page.evaluate(() => {
    const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const p = document.querySelector('[data-testid="timeline-card"] blockquote p');
    const card = document.querySelector('[data-testid="timeline-card"]');
    const a = lum(rgb(getComputedStyle(p).color));
    const b = lum(rgb(getComputedStyle(card).backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  check('11 passage text on a card is at least 7:1', ratio >= 7, `${ratio.toFixed(2)}:1`);
  // Touch feedback: the pressed state is seen and heard.
  const close = await page.$('[data-testid="timeline-close"]');
  const box = await close.boundingBox();
  const before = await close.evaluate((n) => getComputedStyle(n).transform);
  const heard0 = await page.evaluate(() => window.__sounds);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await wait(60);
  const during = await close.evaluate((n) => getComputedStyle(n).transform);
  const heard = (await page.evaluate(() => window.__sounds)) - heard0;
  await page.mouse.up();
  check('9  a press is seen and heard', before !== during && heard === 1, `transform ${before} to ${during}, ${heard} sound`);
  info('10 idle decay at 45, 90 and 120 s', 'held by the state machine\'s unit tests with exact timestamps (npm test)');

  await page.close();

  // 12: reduced motion, from the system setting.
  const calm = await open(context, '/kiosk/dev-04/', { width: 1920, height: 1080 });
  await calm.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await calm.page.waitForSelector('[data-testid="timeline-story"]');
  const motion = await calm.page.evaluate(() => {
    const s = (n) => getComputedStyle(n);
    const card = document.querySelector('[data-testid="timeline-story"]');
    const track = document.querySelector('[data-testid="timeline-axis"] ol');
    return { card: parseFloat(s(card).animationDuration), track: parseFloat(s(track).transitionDuration) };
  });
  check('12 with reduced motion the wall cuts instead of moving', motion.card <= 0.01 && motion.track <= 0.01, `card ${motion.card}s, rail ${motion.track}s`);
  await calm.page.close();

  // 5: the wall's own attract loop, read from 3 m on the 2.8 m panel.
  const scale = (WALL_PPI / 96).toFixed(4);
  const far = await open(context, `/kiosk/dev-04/?sensor=sim&scale=${scale}`, { width: 1920, height: 1200 });
  await far.page.keyboard.press('0');
  await far.page.waitForSelector('[data-testid="kiosk-ambient"] [data-testid="timeline-ambient"]');
  await wait(900);
  const px = await far.page.$eval('[data-testid="kiosk-ambient"] h1', (n) => parseFloat(getComputedStyle(n).fontSize));
  const capMm = px * CAP * (25.4 / WALL_PPI);
  check('5  the wall\'s name reads at 3 m, over its own story', capMm >= ADA_3M_MM, `capital ${capMm.toFixed(1)} mm, minimum at 3 m ${ADA_3M_MM.toFixed(1)} mm`);
  const told = await citedOnScreen(far.page, '[data-testid="kiosk-ambient"]');
  check('   the story told from across the hall is cited', told.shown > 0 && told.cited === told.shown, `${told.cited} of ${told.shown}`);
  await far.page.close();

  // 8: two reading columns, with a translation served as a fixture for
  // whichever page opens, since the translation cache stays empty until step 9.
  const twin = await open(context, '/kiosk/dev-02/', { width: 1920, height: 1080 });
  const manifest = JSON.parse(fs.readFileSync('apps/web/out/archive/manifest.json', 'utf8'));
  manifest.translations = { mr: manifest.works.flatMap((w) => w.pages) };
  twin.page.removeAllListeners('request');
  twin.page.on('request', (r) => {
    const u = r.url();
    if (u.endsWith('/archive/manifest.json')) {
      return r.respond({ contentType: 'application/json', body: JSON.stringify(manifest) });
    }
    const t = /\/archive\/translations\/mr\/([^/]+)\.json$/.exec(u);
    if (t !== null) {
      const raw = JSON.parse(fs.readFileSync(`apps/web/out/archive/pages/${t[1]}.json`, 'utf8'));
      return r.respond({
        contentType: 'application/json',
        body: JSON.stringify({ language: 'mr', source: 'fixture', blocks: raw.blocks.map((b, i) => ({ text: `अनुवाद ${i + 1}. ${b.text}` })) }),
      });
    }
    return u.startsWith(BASE) ? r.continue() : r.abort();
  });
  await twin.page.reload({ waitUntil: 'networkidle0' });
  await search(twin.page, 'Annihilation of Caste');
  await twin.page.click('[data-testid="reading-hit"]');
  const dual = await twin.page
    .waitForSelector('[data-testid="reading-translation"]', { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (dual) {
    const cols = await twin.page.evaluate(() => {
      const a = document.querySelector('[data-testid="reading-page"]').getBoundingClientRect();
      const b = document.querySelector('[data-testid="reading-translation"]').getBoundingClientRect();
      return { side: b.left >= a.right - 1 && Math.abs(a.top - b.top) < 4, a: a.width, b: b.width };
    });
    const locked = await twin.page.evaluate(async () => {
      const a = document.querySelector('[data-testid="reading-page"]');
      const b = document.querySelector('[data-testid="reading-translation"]');
      a.scrollTop = a.scrollHeight / 2;
      a.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 300));
      return b.scrollTop > 0;
    });
    // The page's citation, in the running head, stands over both columns; the
    // translation's own pane says who translated it.
    const marked = await twin.page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-translation"]');
      const cite = document.querySelector('[data-testid="reading-document"] header cite');
      return pane.lang === 'mr' && /fixture/.test(pane.firstElementChild?.textContent ?? '') && cite !== null && cite.getBoundingClientRect().height > 0;
    });
    check('8  two reading columns side by side, original and translation', cols.side, `${cols.a.toFixed(0)} and ${cols.b.toFixed(0)} px wide`);
    check('   the columns scroll together', locked);
    check('   the translation names its translator, under the page\'s citation', marked);
  } else {
    check('8  two reading columns side by side, original and translation', false, `no translation pane opened for ${pageId}`);
  }
  await twin.page.close();
  info('8  four wall touch points', 'see the Timeline Wall checks above');
  await context.close();
}

// ---- 6. 200% type and high contrast ----
{
  console.log('\n  At 200% type and high contrast');
  const context = await browser.createBrowserContext();
  for (const path of ['/kiosk/dev-04/', '/kiosk/dev-01/', '/kiosk/dev-13/']) {
    const { page } = await open(context, path, { width: 1920, height: 1080 });
    await page.click('[data-testid="kiosk-visitor"]');
    await page.waitForSelector('dialog[open]');
    await page.click('[data-testid="kiosk-text-largest"]');
    await page.click('[data-testid="kiosk-contrast-high"]');
    await page.keyboard.press('Escape');
    await wait(500);
    if (path === '/kiosk/dev-04/') {
      await page.click('[data-testid="timeline-story-open"]');
      await page.waitForSelector('[data-testid="timeline-card"]');
      const big = await page.$$eval('[data-testid="timeline"] blockquote p', (p) => Math.min(...p.map((n) => parseFloat(getComputedStyle(n).fontSize))));
      check('passage text doubles to 48 px', big >= 48, `${big} px`);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    // Audit what a visitor reads, not a card halfway through fading in.
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .every((a) => a.playState !== 'running'),
    );
    await page.evaluate(axeSource);
    const r = await page.evaluate(async () =>
      // eslint-disable-next-line no-undef
      await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }),
    );
    check(`${path} has no sideways scroll and no accessibility violations`, !overflow && r.violations.length === 0, r.violations.map((v) => `${v.id}(${v.nodes.length})`).join(', ') || (overflow ? 'overflows' : ''));
    await page.screenshot({ path: `tools/shots/largest-${path.split('/')[2]}.png` });
    await page.close();
  }
  await context.close();
}

await browser.close();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
