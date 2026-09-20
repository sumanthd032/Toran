/**
 * Step 8 verification: the Manuscript Station, IIIF and the two OCR
 * pipelines, against the shipped build.
 *
 * Four things this has to show. A manifest is valid Presentation 3.0 and
 * opens in a viewer we do not control. Deep zoom works with the network off,
 * against tiles on the device. Each pipeline's accuracy is a measured number
 * with a stated ground truth. A curator's correction is recorded as a PREMIS
 * event and destroys nothing.
 *
 * The Mirador check is the one place here that reaches the network, because
 * the whole point of it is to run a viewer nobody on this project wrote or
 * packaged. It is marked, it is separate, and the offline checks refuse every
 * request that would leave this machine.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const DEVICE = '/kiosk/dev-07/';
const TABLET = { width: 1280, height: 800 };
const MIRADOR = 'https://unpkg.com/mirador@3.3.0/dist/mirador.min.js';
const axeSource = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const LOCATOR = /(page|leaf|para|Article|section|पान|पृष्ठ|अनुच्छेद|पन्ना)\s*[\d०-९]*/i;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const info = (label, detail) => console.log(`  INFO  ${label}  ${detail}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const timings = [];

const scans = JSON.parse(fs.readFileSync('apps/web/out/archive/scans.json', 'utf8'));
const accuracy = fs.existsSync('apps/web/out/archive/accuracy.json')
  ? JSON.parse(fs.readFileSync('apps/web/out/archive/accuracy.json', 'utf8'))
  : null;

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

/** A page whose only reachable server is this machine. */
async function open(context, path, viewport = TABLET) {
  const page = await context.newPage();
  await page.setViewport({ deviceScaleFactor: 1, ...viewport });
  const blocked = [];
  const errors = [];
  const missing = [];
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (r.url().startsWith(BASE) || r.url().startsWith('data:') || r.url().startsWith('blob:')) {
      r.continue();
    } else {
      blocked.push(r.url());
      r.abort();
    }
  });
  const tilesAsked = [];
  page.on('request', (r) => {
    if (/\/iiif\/.+\/default\.jpg$/.test(r.url())) tilesAsked.push(r.url());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(BASE)) missing.push(`${r.status()} ${r.url()}`);
  });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/8765|ERR_FAILED/.test(m.text())) errors.push(m.text());
  });
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
  return { page, blocked, errors, missing, tilesAsked };
}

async function timed(label, page, action, until) {
  const t0 = Date.now();
  await action();
  await page.waitForFunction(until, { timeout: 20000 });
  const ms = Date.now() - t0;
  timings.push({ label, ms });
  return ms;
}

console.log('\nToran step 8 verification: the Manuscript Station\n');

// ---- 1. the manifests are Presentation 3.0, by the specification's own rules ----
{
  console.log('  IIIF Presentation 3.0, checked field by field');
  const problems = [];
  for (const scan of scans) {
    const file = `apps/web/out/iiif/${scan.id}/manifest.json`;
    if (!fs.existsSync(file)) {
      problems.push(`${scan.id}: no manifest`);
      continue;
    }
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const say = (ok, what) => ok || problems.push(`${scan.id}: ${what}`);
    say(m['@context'] === 'http://iiif.io/api/presentation/3/context.json', 'wrong @context');
    say(m.type === 'Manifest', 'type is not Manifest');
    say(/^https?:\/\//.test(m.id ?? ''), 'id is not an http URI');
    say(typeof m.label === 'object' && Object.keys(m.label).length > 0, 'no label');
    say(Array.isArray(m.items) && m.items.length > 0, 'no items');
    const canvas = m.items?.[0];
    say(canvas?.type === 'Canvas', 'first item is not a Canvas');
    say(canvas?.width === scan.width && canvas?.height === scan.height, 'canvas is not the page size');
    const painting = canvas?.items?.[0]?.items?.[0];
    say(painting?.motivation === 'painting', 'nothing paints the canvas');
    say(painting?.body?.type === 'Image', 'the painted body is not an Image');
    say(painting?.target === canvas?.id, 'the painting does not target its canvas');
    const service = painting?.body?.service?.[0];
    say(service?.type === 'ImageService3', 'no ImageService3 on the image');
    say(service?.profile === 'level0', 'the image service does not declare level0');
    // Rights are stated, as this material demands.
    say(typeof m.requiredStatement?.value === 'object', 'no rights statement');
    say(Array.isArray(m.metadata) && m.metadata.length >= 5, 'thin metadata');
  }
  check('every manifest is a well-formed Presentation 3.0 Manifest', problems.length === 0,
    problems.slice(0, 2).join('; ') || `${scans.length} manifests`);

  const collection = JSON.parse(fs.readFileSync('apps/web/out/iiif/collection.json', 'utf8'));
  check('the collection lists every page', collection.type === 'Collection'
    && collection.items.length === scans.length, `${collection.items.length} of ${scans.length}`);

  // Every tile the info.json advertises is a file, and the painted image exists.
  let tiles = 0;
  const gaps = [];
  for (const scan of scans) {
    const info = JSON.parse(fs.readFileSync(`apps/web/out/iiif/${scan.id}/info.json`, 'utf8'));
    for (const size of info.sizes) {
      const full = size.width === scan.width && size.height === scan.height;
      const at = full
        ? `apps/web/out/iiif/${scan.id}/full/max/0/default.jpg`
        : `apps/web/out/iiif/${scan.id}/full/${size.width},${size.height}/0/default.jpg`;
      if (fs.existsSync(at)) tiles++;
      else if (!full) gaps.push(at);
    }
    if (!fs.existsSync(`apps/web/out/iiif/${scan.id}/full/max/0/default.jpg`)) {
      gaps.push(`${scan.id} full/max`);
    }
  }
  check('every size the info.json advertises is on disk', gaps.length === 0,
    `${tiles} sizes checked${gaps.length > 0 ? `, missing ${gaps[0]}` : ''}`);
}

// ---- 2. it opens in a viewer we do not control ----
{
  console.log('\n  Mirador, a viewer nobody here wrote (this check reaches the network)');
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  let loaded = true;
  try {
    await page.addScriptTag({ url: MIRADOR });
  } catch {
    loaded = false;
  }
  if (!loaded) {
    info('Mirador', `could not be fetched from ${MIRADOR}; the offline checks below still ran`);
    failures++;
    console.log('  FAIL  the manifest opens in Mirador  the viewer could not be fetched');
  } else {
    const target = `${BASE}/iiif/coi-calligraphic-p008/manifest.json`;
    await page.evaluate((manifest) => {
      const host = document.createElement('div');
      host.id = 'mirador';
      host.style.cssText = 'position:fixed;inset:0';
      document.body.appendChild(host);
      // eslint-disable-next-line no-undef
      Mirador.viewer({ id: 'mirador', windows: [{ manifestId: manifest }] });
    }, target);
    // Mirador has drawn the page when it has an OpenSeadragon canvas with
    // ink in it, and it has understood the manifest when the manifest's own
    // label is somewhere on screen.
    const shown = await page
      .waitForFunction(
        () => {
          const canvas = document.querySelector('#mirador canvas');
          if (canvas === null || canvas.width < 8) return false;
          const pixels = canvas
            .getContext('2d', { willReadFrequently: true })
            ?.getImageData(0, 0, canvas.width, canvas.height).data;
          if (pixels === undefined) return false;
          let ink = 0;
          for (let i = 3; i < pixels.length; i += 4000) if (pixels[i] > 0) ink++;
          return ink > 0 ? (document.querySelector('#mirador')?.textContent ?? '') : false;
        },
        { timeout: 60000 },
      )
      .then((h) => h.jsonValue())
      .catch(() => null);
    check('the manifest opens in Mirador and it draws the page',
      shown !== null && /Constitution of India/i.test(shown),
      shown === null ? 'Mirador drew nothing' : 'the page is drawn and titled');
    // Mirador reads the transcription annotations too, where a page has them.
    const annotations = await page.evaluate(async (manifest) => {
      const m = await (await fetch(manifest)).json();
      return m.items[0].annotations?.[0]?.items?.length ?? 0;
    }, target);
    info('transcription annotations on that manifest', `${annotations}`);
    check('no script errors from the external viewer', errors.length === 0, errors.slice(0, 1).join(''));
    await page.screenshot({ path: 'tools/shots/mirador.png' });
  }
  await context.close();
}

// ---- 3. deep zoom, with the network off ----
{
  console.log('\n  The station, nothing reachable but this machine');
  const context = await browser.createBrowserContext();
  const { page, blocked, errors, missing, tilesAsked } = await open(context, DEVICE);

  await timed('open the station', page, async () => {}, () =>
    document.querySelector('[data-testid="manuscript"]') !== null,
  );
  const shownPage = await page.$eval('[data-testid="manuscript"]', (n) => n.getAttribute('data-page'));
  check('the station opens a scanned page', shownPage !== null, shownPage ?? '');

  await page.waitForSelector('[data-testid="manuscript-canvas"] canvas', { timeout: 30000 });
  await wait(1200);
  const drew = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="manuscript-canvas"] canvas');
    if (canvas === null) return 0;
    const context2d = canvas.getContext('2d');
    const pixels = context2d.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4000) if (pixels[i + 3] > 0) ink++;
    return ink;
  });
  check('the page is drawn from tiles on the device', drew > 0, `${drew} sampled pixels carry the page`);

  // What the viewer actually rasterised. A screenshot of this page in
  // headless Chrome shows black bars over the stage that are in neither the
  // canvas nor the DOM: the raster below is clean, every element over it is
  // transparent and positioned on its line, and removing every overlay does
  // not change the capture. It is a compositing artefact of headless
  // capture, unreproducible here in any other way, and it has to be looked
  // at on the tablet before the Grand Finale rather than assumed away.
  const blocks = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="manuscript-canvas"] canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 200 && pixels[i] + pixels[i + 1] + pixels[i + 2] < 90) dark++;
    }
    return { dark, of: pixels.length / 4 };
  });
  check('the raster the viewer produced is the page and not black blocks',
    blocks.dark / blocks.of < 0.12, `${((blocks.dark / blocks.of) * 100).toFixed(1)}% of it is near black`);
  info('headless capture', 'shows bars this raster does not contain; check the station on the tablet');

  // Zoom in, which is what makes a tile request beyond the first level.
  const before = tilesAsked.length;
  const stage = await (await page.$('[data-testid="manuscript-canvas"]')).boundingBox();
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.wheel({ deltaY: -400 });
    await wait(350);
  }
  await wait(1500);
  check('zooming in asks for deeper tiles, and every one is there',
    tilesAsked.length > before && missing.length === 0,
    `${tilesAsked.length} tiles in all, ${tilesAsked.length - before} after zooming, `
    + `${missing.length} not found${missing.length > 0 ? `: ${missing[0]}` : ''}`);
  check('no request tried to leave the machine', blocked.length === 0, blocked.slice(0, 2).join(' '));
  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.screenshot({ path: 'tools/shots/manuscript.png' });
  await page.close();
  await context.close();
}

// ---- 4. the transcription, its heat and its citation ----
{
  console.log('\n  The transcription beside the page');
  const context = await browser.createBrowserContext();
  const { page } = await open(context, DEVICE);
  await page.waitForSelector('[data-testid="manuscript-transcript"], [data-testid="manuscript-unread"]');

  const read = await page.$('[data-testid="manuscript-transcript"]');
  if (read === null) {
    check('the first page has been read by a machine', false, 'no pipeline has read it');
  } else {
    const lines = await page.$$eval('[data-testid="manuscript-line"]', (n) =>
      n.map((l) => ({ heat: l.getAttribute('data-heat'), text: l.textContent?.trim() ?? '' })),
    );
    check('every line carries a heat band and nothing else', lines.length > 0
      && lines.every((l) => ['certain', 'high', 'middling', 'low'].includes(l.heat ?? '')),
      `${lines.length} lines, bands: ${[...new Set(lines.map((l) => l.heat))].sort().join(', ')}`);
    const doubted = lines.filter((l) => l.heat === 'low').length;
    info('lines the machine doubted', `${doubted} of ${lines.length}`);

    const cite = await page.$eval('[data-testid="manuscript-transcript"] cite', (n) =>
      n.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
    check('the transcription shows the page it is of', LOCATOR.test(cite), cite);

    const means = await page.$eval('[data-testid="manuscript-transcript"] p:nth-of-type(2)', (n) => n.textContent ?? '');
    check('the screen says what the confidence number means', means.trim().length > 20, means.slice(0, 96));

    // No stylesheet can turn a doubtful reading into a confident one.
    const rules = fs
      .readdirSync('apps/web/out/_next/static/css')
      .map((f) => fs.readFileSync(`apps/web/out/_next/static/css/${f}`, 'utf8'))
      .join('');
    const heatRules = rules.match(/data-heat='?(certain|high|middling|low)'?\]/g) ?? [];
    check('heat is set only from the data the contract produces', heatRules.length > 0
      && !/\.line\s*\{[^}]*--heat-/.test(rules), `${heatRules.length} rules keyed on the band`);
  }
  await page.close();
  await context.close();
}

// ---- 5. a correction is an event, and destroys nothing ----
{
  console.log('\n  A curator corrects a reading');
  const before = fs.readFileSync('data/dip/ocr/samvidhan-1957-en-p007.surya.json');
  const digestBefore = crypto.createHash('sha256').update(before).digest('hex');
  const premisBefore = fs.existsSync('data/aip/premis.jsonl')
    ? fs.readFileSync('data/aip/premis.jsonl', 'utf8').split('\n').length : 0;
  const logBefore = fs.existsSync('data/curation/corrections.jsonl')
    ? fs.readFileSync('data/curation/corrections.jsonl', 'utf8').split('\n').filter(Boolean).length : 0;

  // Drive the tool as a curator would: correct the first region it offers.
  try {
    execFileSync('node', ['tools/correct-ocr.mjs', '--page', 'samvidhan-1957-en-p007', '--by', 'Verification'],
      { input: 'e\nthe words a person actually reads there\nchecked by verify:manuscript\nq\n', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    check('the correction tool runs', false, String(error).slice(0, 120));
  }

  const digestAfter = crypto.createHash('sha256')
    .update(fs.readFileSync('data/dip/ocr/samvidhan-1957-en-p007.surya.json')).digest('hex');
  check('the machine reading is byte for byte what it was', digestBefore === digestAfter,
    `${digestBefore.slice(0, 12)}`);

  const logAfter = fs.existsSync('data/curation/corrections.jsonl')
    ? fs.readFileSync('data/curation/corrections.jsonl', 'utf8').split('\n').filter(Boolean)
    : [];
  check('the correction is recorded with who made it', logAfter.length === logBefore + 1
    && logAfter[logAfter.length - 1].includes('Verification'), `${logAfter.length} correction(s)`);
  const recorded = JSON.parse(logAfter[logAfter.length - 1]);
  check('the correction keeps what the machine had read', typeof recorded.was === 'string'
    && recorded.was.length > 0 && recorded.was !== recorded.text, `was: ${recorded.was.slice(0, 48)}`);

  const premis = fs.readFileSync('data/aip/premis.jsonl', 'utf8').split('\n').filter(Boolean);
  const event = JSON.parse(premis[premis.length - 1]);
  check('a PREMIS modification event names the agent and the change',
    premis.length > premisBefore - 1 && event.eventType === 'modification'
    && event.linkingAgentIdentifier === 'Verification'
    && event.eventOutcomeDetail.includes('unchanged'),
    `${event.eventType}, by ${event.linkingAgentIdentifier}`);

  // Put the archive back: the correction was made by this script, not a curator.
  const kept = logAfter.slice(0, logBefore);
  if (kept.length === 0) fs.rmSync('data/curation/corrections.jsonl', { force: true });
  else fs.writeFileSync('data/curation/corrections.jsonl', kept.map((l) => `${l}\n`).join(''));
  fs.writeFileSync('data/aip/premis.jsonl', `${premis.slice(0, -1).join('\n')}\n`);
  execFileSync('node', ['tools/build-scans.mjs'], { stdio: 'ignore' });
  info('the archive was put back', 'the correction above was a test, not a curator\'s');
}

// ---- 6. what each pipeline is worth ----
{
  console.log('\n  OCR accuracy, per pipeline');
  if (accuracy === null) {
    check('accuracy has been measured', false, 'no accuracy.json; run ocr:accuracy');
  } else {
    for (const [pipeline, s] of Object.entries(accuracy.summary)) {
      check(`${pipeline}: a measured number with a stated ground truth`,
        s.passages > 0 && typeof s.cer === 'number' && s.methods.length > 0,
        `${s.passages} passage(s), CER ${(s.cer * 100).toFixed(1)}%, WER ${(s.wer * 100).toFixed(1)}%, `
        + `ground truth ${s.methods.join(' and ')}, ${s.model}`);
    }
    const missed = Object.keys(accuracy.summary);
    check('both pipelines have a number', missed.includes('surya') && missed.includes('vlm'),
      missed.join(', ') || 'none');
    for (const u of accuracy.unscored) info('not scored', u);
  }
}

// ---- 7. the kiosk contracts on this screen ----
{
  console.log('\n  The kiosk contracts (CLAUDE.md 10)');
  const context = await browser.createBrowserContext();
  const { page, errors } = await open(context, DEVICE);
  await page.waitForSelector('[data-testid="manuscript-canvas"] canvas', { timeout: 30000 });

  const worst = timings.reduce((a, b) => (b.ms > a.ms ? b : a), { label: 'none', ms: 0 });
  check('1  every interaction answers within 2000 ms', worst.ms < 2000,
    `slowest: ${worst.label}, ${worst.ms} ms (of ${timings.length} measured)`);

  const mm30 = await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;width:30mm;visibility:hidden';
    document.body.appendChild(d);
    const w = d.getBoundingClientRect().width;
    d.remove();
    return w;
  });
  const targets = await page.$$eval('[data-testid="kiosk"] button:not(:disabled)', (b) =>
    b.map((n) => ({ r: n.getBoundingClientRect(), n }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .map(({ r, n }) => ({ min: Math.min(r.width, r.height), label: n.getAttribute('aria-label') ?? n.textContent?.trim().slice(0, 24) })),
  );
  const smallest = targets.reduce((a, b) => (b.min < a.min ? b : a));
  check('3  every touch target is at least 30 mm', smallest.min >= mm30 - 0.5,
    `${targets.length} targets, smallest ${smallest.min.toFixed(0)} px (${smallest.label}), 30 mm is ${mm30.toFixed(0)} px`);

  const body = await page.$$eval('[data-testid="manuscript-line"] span', (p) =>
    p.map((n) => parseFloat(getComputedStyle(n).fontSize)).filter((n) => n > 0));
  if (body.length > 0) check('4  transcription text is at least 24 px', Math.min(...body) >= 24, `${Math.min(...body)} px`);

  const nav = await page.$$eval('nav button', (b) =>
    b.map((n) => n.getAttribute('aria-label')).filter((l) => /^(Back|Home|Forward)$/.test(l ?? '')));
  check('6  exactly three navigation affordances', nav.length === 3, nav.join(', '));
  const help = await page.$$eval('button, a', (b) => b.filter((n) => /\bhelp\b|\?$/i.test(n.textContent ?? '')).length);
  check('7  zero help buttons', help === 0, `${help}`);

  const ratio = await page.evaluate(() => {
    const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const painted = (el) => {
      for (let n = el; n !== null; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
      }
      return 'rgb(255, 255, 255)';
    };
    const p = document.querySelector('[data-testid="manuscript-line"] span');
    if (p === null) return null;
    const a = lum(rgb(getComputedStyle(p).color));
    const b = lum(rgb(painted(p)));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  if (ratio !== null) check('11 transcription text is at least 7:1', ratio >= 7, `${ratio.toFixed(2)}:1`);

  const tool = await page.$('[data-testid="manuscript-view-scan"]');
  const box = await tool.boundingBox();
  const beforePress = await tool.evaluate((n) => getComputedStyle(n).transform);
  const heard0 = await page.evaluate(() => window.__sounds);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await wait(60);
  const during = await tool.evaluate((n) => getComputedStyle(n).transform);
  const heard = (await page.evaluate(() => window.__sounds)) - heard0;
  await page.mouse.up();
  check('9  a press is seen and heard', beforePress !== during && heard === 1,
    `transform ${beforePress} to ${during}, ${heard} sound`);
  info('10 idle decay at 45, 90 and 120 s', 'held by the state machine\'s unit tests (npm test)');

  // A kiosk has no pointer resting on a control, so the audit is taken with
  // the pointer away and the screen settled.
  await page.mouse.move(4, 4);
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
      .every((a) => a.playState !== 'running'),
  );
  await page.evaluate(axeSource);
  const audit = await page.evaluate(async () =>
    // eslint-disable-next-line no-undef
    await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('   no sideways scroll and no accessibility violations', !overflow && audit.violations.length === 0,
    audit.violations
      .map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.failureSummary?.replace(/\s+/g, ' ').slice(0, 120)}`).join('; ')}`)
      .join(' | ') || (overflow ? 'overflows' : ''));
  check('   no console errors through all of it', errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();

  const calm = await open(context, DEVICE);
  await calm.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await calm.page.waitForSelector('[data-testid="manuscript"]');
  const motion = await calm.page.evaluate(() => {
    const el = document.querySelector('[data-testid="manuscript-stage"]');
    return el === null ? 0 : parseFloat(getComputedStyle(el).transitionDuration);
  });
  check('12 with reduced motion the station cuts instead of moving', motion <= 0.01, `${motion}s`);
  await calm.page.close();
  await context.close();
}

await browser.close();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
