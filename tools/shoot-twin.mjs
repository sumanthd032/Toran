/**
 * Captures the Twin at points through the entry sequence, on the real GPU.
 * Used to look at the hall, not to pass or fail it.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const tier = process.argv[2] ?? 'high';
const GPU = [
  '--no-sandbox',
  '--use-angle=vulkan',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
];

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: GPU,
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning')
    errors.push(`[${m.type()}] ${m.text()}`);
});

await page.goto(`${BASE}/?quality=${tier}&perf`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__toranTwin?.entryStart != null, {
  timeout: 60000,
});
const t0 = Date.now();
const shots = [
  [150, 'a-forecourt'],
  [1500, 'b-gate'],
  [2700, 'c-threshold'],
];
for (const [at, name] of shots) {
  const wait = at - (Date.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  await page.screenshot({ path: `tools/shots/twin-${tier}-${name}.png` });
}
await page.waitForFunction(() => window.__toranTwin?.entryEnd != null, {
  timeout: 20000,
});
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `tools/shots/twin-${tier}-d-nave.png` });
const tele = await page.evaluate(() => window.__toranTwin);
console.log(
  JSON.stringify(
    {
      tier: tele.tier,
      renderer: tele.renderer,
      firstFrameMs: Math.round(tele.firstFrame),
      entryMs: Math.round(tele.entryEnd - tele.entryStart),
      entryFrames: (() => {
        const f = [...tele.entryFrames].sort((a, b) => a - b);
        const q = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))];
        return {
          count: f.length,
          p50: +q(0.5).toFixed(1),
          p95: +q(0.95).toFixed(1),
          max: +f[f.length - 1].toFixed(1),
          over25ms: f.filter((x) => x > 25).length,
        };
      })(),
      texturesMs: tele.texturesMs,
      frame: {
        fps: +tele.frame.fps.toFixed(1),
        ms: +tele.frame.ms.toFixed(2),
        calls: tele.frame.calls,
        triangles: tele.frame.triangles,
        geometries: tele.frame.geometries,
        textures: tele.frame.textures,
      },
    },
    null,
    2,
  ),
);
if (errors.length) console.log('console:', errors.slice(0, 6).join('\n  '));
await browser.close();
