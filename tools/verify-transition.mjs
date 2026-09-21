/**
 * Step 5 transition verification on the real GPU (AMD Radeon 680M, which is
 * not the tablet). No screenshots during a measured move: capturing stalls the
 * page and would put its own spikes into the frame times.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const GPU = ['--no-sandbox', '--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'];
const W = 1280;
const H = 800;
const FILL = 0.86;

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (f) => {
  const s = [...f].sort((a, b) => a - b);
  return { n: s.length, p95: s[Math.floor(s.length * 0.95)] ?? 0, worst: s[s.length - 1] ?? 0 };
};

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: GPU });

async function hall(query = '', reduced = false) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__toranTwin?.entryEnd != null, { timeout: 30000 });
  await wait(700);
  return { page, errors };
}

const phase = (page) => page.evaluate(() => window.__toranTwin?.transitionPhase);
const openFromSheet = async (page, deviceId) => {
  for (const b of await page.$$('button')) {
    if (/13 devices/.test(await b.evaluate((n) => n.textContent ?? ''))) { await b.click(); break; }
  }
  await page.waitForSelector('dialog[open]');
  for (const b of await page.$$('dialog[open] li button')) {
    if ((await b.evaluate((n) => n.textContent ?? '')).includes(deviceId)) { await b.click(); break; }
  }
};

console.log('\nToran step 5 transition verification  (AMD Radeon 680M, not the tablet)\n');

// ---- the first open, before the engine has loaded ----
// A visitor who clicks a device straight after entering. The hall has not
// warmed the engine yet, and the Reading Room waits until the flight is over
// before it starts the load, so the flight has the machine to itself.
{
  const { page } = await hall('?quality=high');
  await page.evaluate(() => {
    const watch = () => {
      if (window.__toranTwin.transitionPhase === 'open') window.__openAt = performance.now();
      else requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  await openFromSheet(page, 'dev-01');
  await page.waitForFunction(() => window.__openAt !== undefined, { timeout: 10000 });
  const first = stats(await page.evaluate(() => window.__toranTwin.transitionFrames));
  check('the first fly in holds 60fps, before the engine loads', first.p95 < 20, `${first.n} frames, p95 ${first.p95.toFixed(1)} ms, worst ${first.worst.toFixed(1)} ms`);
  await page.waitForFunction(() => window.__toranTwin.searchStarted !== null, { timeout: 5000 });
  /*
    Against the Director's own stamp, not the rAF watcher above, which sighted
    the phase change up to two frames late under load and made this check fail
    about one run in four on a build that was behaving correctly.

    One frame of tolerance remains, and it is structural rather than slack.
    Both the engine and the Director react to the same phase change, but the
    Director runs inside the React Three Fiber reconciler, which commits a
    frame after the DOM tree the Reading Room lives in. The engine therefore
    stamps first by design. What this check protects is that the 118 MB model
    does not load while the camera is flying, which cost the flight a third of
    its frames when it did; the fly-in frame check above is the other half of
    that guard.
  */
  const lead = await page.evaluate(
    () => window.__toranTwin.searchStarted - window.__toranTwin.openedAt,
  );
  check('the engine starts loading only once the application covers the hall', lead > -20, `${Math.round(lead)} ms after the application covered the hall`);
  await page.waitForFunction(() => window.__toranTwin.searchReady != null, { timeout: 60000 });
  const waited = await page.evaluate(() => window.__toranTwin.searchReady - window.__openAt);
  console.log(`  INFO  the first Reading Room waits ${Math.round(waited)} ms for the engine on this machine`);
  await page.close();
}

// ---- the steady state, graded: engine loaded, hall at rest ----
// What a jury sees with the demo open before they arrive, and what a kiosk
// sees, having warmed at boot. Graded on the pooled frames of three flights.
// On this machine about one high tier flight in five stalls on the GPU for a
// few frames: SwapBuffers blocks while the CPU work is unchanged, with or
// without the engine loaded. A single flight gate fails at random, so every
// flight is printed and a bad one stays visible. DECISIONS.md D-068.
{
  const { page, errors } = await hall('?quality=high');
  await page.waitForFunction(() => window.__toranTwin?.searchReady != null, { timeout: 60000 });
  await wait(2000);
  const before = await page.evaluate(() => window.__toranTwin.framesDrawn);
  await openFromSheet(page, 'dev-01');
  await page.waitForFunction(() => window.__toranTwin.transitionPhase === 'open', { timeout: 10000 });
  const flightsIn = [await page.evaluate(() => window.__toranTwin.transitionFrames)];
  const arrival = await page.evaluate(() => window.__toranTwin.arrivalRect);

  const cx = arrival.x + arrival.w / 2;
  const cy = arrival.y + arrival.h / 2;
  const fill = Math.max(arrival.w / W, arrival.h / H);
  check('the screen arrives centred', Math.abs(cx - W / 2) < 2 && Math.abs(cy - H / 2) < 2, `centre ${cx.toFixed(1)}, ${cy.toFixed(1)}`);
  check('the screen arrives at the planned size', Math.abs(fill - FILL) < 0.01, `${(fill * 100).toFixed(1)}% of the frame`);

  const opened = await page.evaluate(() => window.__toranTwin.framesDrawn);
  await wait(1500);
  const idle = (await page.evaluate(() => window.__toranTwin.framesDrawn)) - opened;
  check('the hall stops drawing while an application covers it', idle === 0, `${idle} frames drawn in 1.5 s`);
  const url = await page.evaluate(() => location.search);
  check('opening a device is a navigation', url.includes('device=dev-01'), url);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__toranTwin.transitionPhase === 'hall', { timeout: 10000 });
  const flightsOut = [await page.evaluate(() => window.__toranTwin.transitionFrames)];
  const t = await page.evaluate(() => window.__toranTwin);
  const drift = Math.max(...t.poseBeforeOpen.map((v, i) => Math.abs(v - t.poseAfterClose[i])));
  check('Escape returns to the exact prior camera state', drift < 1e-6, `largest difference ${drift.toExponential(1)}`);
  check('closing restores the URL', !(await page.evaluate(() => location.search)).includes('device='), await page.evaluate(() => location.search));
  check('no console errors across a full transition', errors.length === 0, errors.slice(0, 2).join(' | '));
  check('the hall drew while in the hall', opened > before, `${opened - before} frames`);

  for (let i = 0; i < 2; i++) {
    await wait(1500);
    await openFromSheet(page, 'dev-01');
    await page.waitForFunction(() => window.__toranTwin.transitionPhase === 'open', { timeout: 10000 });
    flightsIn.push(await page.evaluate(() => window.__toranTwin.transitionFrames));
    await wait(800);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__toranTwin.transitionPhase === 'hall', { timeout: 10000 });
    flightsOut.push(await page.evaluate(() => window.__toranTwin.transitionFrames));
  }
  for (const [label, flights] of [['fly in', flightsIn], ['fly out', flightsOut]]) {
    const each = flights.map(stats).map((f) => `p95 ${f.p95.toFixed(1)} worst ${f.worst.toFixed(1)}`);
    console.log(`  INFO  ${label}, each flight  ${each.join('  |  ')}`);
    const pooled = stats(flights.flat());
    check(`${label} holds 60fps`, pooled.p95 < 20, `${pooled.n} frames over three flights, p95 ${pooled.p95.toFixed(1)} ms, ${flights.flat().filter((f) => f > 20).length} over 20 ms`);
  }
  await page.close();
}

// ---- every device, every form: each one frames correctly ----
{
  const { page } = await hall('?quality=low');
  const devices = ['dev-13', 'dev-01', 'dev-02', 'dev-03', 'dev-07', 'dev-04', 'dev-05', 'dev-06', 'dev-11', 'dev-08', 'dev-09', 'dev-10', 'dev-12'];
  const bad = [];
  for (const id of devices) {
    await openFromSheet(page, id);
    await page.waitForFunction(() => window.__toranTwin.transitionPhase === 'open', { timeout: 10000 });
    const r = await page.evaluate(() => window.__toranTwin.arrivalRect);
    const kiosk = await page.$eval('[data-testid="kiosk"]', (n) => n.getAttribute('data-device'));
    const centred = Math.abs(r.x + r.w / 2 - W / 2) < 2 && Math.abs(r.y + r.h / 2 - H / 2) < 2;
    const fill = Math.max(r.w / W, r.h / H);
    if (!centred || Math.abs(fill - FILL) > 0.01 || kiosk !== id) bad.push(`${id} fill ${(fill * 100).toFixed(0)}% ${kiosk}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__toranTwin.transitionPhase === 'hall', { timeout: 10000 });
    await wait(150);
  }
  check('all thirteen devices open centred, at size, on the right application', bad.length === 0, bad.join('; ') || '13 of 13');
  await page.close();
}

// ---- deep link ----
{
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/?device=dev-07&quality=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="kiosk"][data-device="dev-07"]', { timeout: 20000 });
  await page.waitForFunction(() => window.__toranTwin?.transitionPhase === 'open', { timeout: 10000 });
  const flew = await page.evaluate(() => window.__toranTwin.entryEnd - window.__toranTwin.entryStart);
  check('a deep link opens the device directly, skipping the hall', flew < 50, `entry took ${Math.round(flew)} ms`);
  const opacity = await page.$eval('[data-testid="bezel"]', (n) => getComputedStyle(n).opacity);
  check('the deep linked application is fully shown', opacity === '1', `opacity ${opacity}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__toranTwin.transitionPhase === 'hall', { timeout: 10000 });
  check('Back from a deep link returns to the hall', (await phase(page)) === 'hall');
  await page.close();
}

// ---- browser back ----
{
  const { page } = await hall('?quality=low');
  await openFromSheet(page, 'dev-03');
  await page.waitForFunction(() => window.__toranTwin.transitionPhase === 'open', { timeout: 10000 });
  await page.goBack();
  await page.waitForFunction(() => window.__toranTwin.transitionPhase === 'hall', { timeout: 10000 });
  check('the browser back button closes the device', (await phase(page)) === 'hall');
  await page.close();
}

// ---- reduced motion ----
{
  const { page } = await hall('?quality=low', true);
  const t0 = Date.now();
  await openFromSheet(page, 'dev-01');
  await page.waitForFunction(() => window.__toranTwin.transitionPhase === 'open', { timeout: 5000 });
  const openMs = Date.now() - t0;
  const frames = await page.evaluate(() => window.__toranTwin.transitionFrames.length);
  check('reduced motion opens with an instant cut', frames === 0, `${frames} animated frames, open in ${openMs} ms`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__toranTwin.transitionPhase === 'hall', { timeout: 5000 });
  const t = await page.evaluate(() => window.__toranTwin);
  const drift = Math.max(...t.poseBeforeOpen.map((v, i) => Math.abs(v - t.poseAfterClose[i])));
  check('reduced motion closes to the exact prior pose', drift < 1e-6, `largest difference ${drift.toExponential(1)}`);
  await page.close();
}

await browser.close();
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
