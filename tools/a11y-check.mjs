/**
 * Accessibility audit of /system in both themes, using axe-core, which is the
 * engine behind Lighthouse's accessibility score. Runs against the built
 * static export, not the dev server.
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const axe = fs.readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox'],
});

let total = 0;
for (const theme of ['light', 'dark']) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/system/`, { waitUntil: 'networkidle0' });
  await page.evaluate(
    (t) => document.documentElement.setAttribute('data-theme', t),
    theme,
  );
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(axe);

  const results = await page.evaluate(
    async () =>
      // eslint-disable-next-line no-undef
      await axe.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
        },
      }),
  );

  console.log(`\n${theme === 'light' ? 'Page (light)' : 'Hall (dark)'}`);
  console.log(
    `  passes: ${results.passes.length}   violations: ${results.violations.length}`,
  );
  for (const v of results.violations) {
    total++;
    console.log(`  ${v.impact?.toUpperCase() ?? 'UNKNOWN'}  ${v.id}: ${v.help}`);
    for (const n of v.nodes.slice(0, 3)) {
      console.log(`      ${n.target.join(' ')}`);
      if (n.failureSummary) {
        console.log(`      ${n.failureSummary.split('\n').slice(0, 2).join(' ')}`);
      }
    }
  }
  await page.close();
}

await browser.close();
console.log(total === 0 ? '\nNo accessibility violations.' : `\n${total} violation(s).`);
process.exit(total === 0 ? 0 : 1);
