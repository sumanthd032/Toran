/**
 * Vendors the reading faces for the Indic scripts the archive is translated
 * into, so nothing is fetched from a font host at runtime.
 *
 * Step 1 shipped Latin and Devanagari. A Bengali, Tamil or Telugu translation
 * needs its own face whether or not the interface is in that language, because
 * the dual pane can show a Bengali translation beside an English original while
 * the visitor reads in Marathi. Fonts are therefore vendored per script, not
 * per interface language.
 *
 * Google Fonts serves one @font-face per subset with the unicode-range that
 * makes the browser fetch only what a page actually needs. This keeps that
 * split rather than flattening it, so a page with no Tamil on it downloads no
 * Tamil.
 *
 * Idempotent: a family already in the manifest is left alone. Run once.
 * Run: node tools/fetch-fonts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'apps/web/public/fonts';
const MANIFEST = path.join(OUT, 'manifest.json');
const CSS = 'apps/web/src/design/fonts.css';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * The weights match the Devanagari face vendored in step 1: 400 for reading,
 * 600 for the headings the kiosk sets in the reading face. A variable range
 * carries both in one file.
 */
const FAMILIES = [
  { key: 'notoSerifBengali', family: 'Noto Serif Bengali', slug: 'noto-serif-bn', weights: '400..600', scripts: ['bengali'] },
  { key: 'notoSerifTamil', family: 'Noto Serif Tamil', slug: 'noto-serif-ta', weights: '400..600', scripts: ['tamil'] },
  { key: 'notoSerifTelugu', family: 'Noto Serif Telugu', slug: 'noto-serif-te', weights: '400..600', scripts: ['telugu'] },
];

async function get(url, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return res;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

/** Splits the served stylesheet into one record per subset. */
function faces(css) {
  const out = [];
  const blocks = css.split('@font-face').slice(1);
  for (const block of blocks) {
    const subset = /\/\*\s*([a-z0-9-]+)\s*\*\//.exec(css.slice(0, css.indexOf(block)).lastIndexOf('/*') === -1 ? '' : '');
    const url = /src:\s*url\((https:[^)]+)\)/.exec(block)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1].trim();
    const weight = /font-weight:\s*([^;]+);/.exec(block)?.[1].trim();
    if (url === undefined || range === undefined) continue;
    out.push({ url, range, weight: weight ?? '400', subset: null });
    void subset;
  }
  // Google writes the subset name in a comment immediately before each block.
  const names = [...css.matchAll(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face/g)].map((m) => m[1]);
  out.forEach((f, i) => {
    f.subset = names[i] ?? `subset-${i}`;
  });
  return out;
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let added = 0;

for (const spec of FAMILIES) {
  if (manifest[spec.key] !== undefined) {
    console.log(`  ${spec.family}: already vendored, skipped`);
    continue;
  }
  const url =
    `https://fonts.googleapis.com/css2?family=${spec.family.replace(/ /g, '+')}:wght@${spec.weights}&display=swap`;
  const css = await (await get(url)).text();
  const found = faces(css);
  if (found.length === 0) throw new Error(`no faces returned for ${spec.family}`);
  const entries = [];
  for (const face of found) {
    const file = `${spec.slug}-${face.subset}-400-600-normal.woff2`;
    const bytes = Buffer.from(await (await get(face.url)).arrayBuffer());
    fs.writeFileSync(path.join(OUT, file), bytes);
    entries.push({
      file,
      subset: face.subset,
      style: 'normal',
      weight: '400 600',
      range: face.range,
      size: bytes.length,
    });
    console.log(`  ${String(bytes.length).padStart(7)} bytes  ${spec.family}  ${face.subset}`);
  }
  manifest[spec.key] = entries;
  added += entries.length;
}

if (added === 0) {
  console.log('fonts: nothing to do');
  process.exit(0);
}

fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

// Append the new faces. The file says it is generated from the manifest, and
// this is the generator for the families it adds; the ones step 1 vendored are
// left exactly as they are.
const blocks = [];
for (const spec of FAMILIES) {
  const entries = manifest[spec.key];
  if (entries === undefined) continue;
  if (fs.readFileSync(CSS, 'utf8').includes(`font-family: '${spec.family}'`)) continue;
  blocks.push(`/* ${spec.family} */`);
  for (const e of entries) {
    blocks.push(
      `@font-face {\n` +
        `  font-family: '${spec.family}';\n` +
        `  font-style: ${e.style};\n` +
        `  font-weight: ${e.weight};\n` +
        `  font-display: swap;\n` +
        `  src: url('/fonts/${e.file}') format('woff2');\n` +
        `  unicode-range:\n    ${e.range.replace(/,\s*/g, ', ')};\n` +
        `}`,
    );
  }
}
if (blocks.length > 0) {
  fs.appendFileSync(CSS, `\n${blocks.join('\n')}\n`);
}

const total = Object.values(manifest).flat().reduce((n, e) => n + e.size, 0);
console.log(`fonts: ${added} faces added, ${(total / 1024).toFixed(0)} KB vendored in all`);
