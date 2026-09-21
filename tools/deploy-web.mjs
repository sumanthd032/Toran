/**
 * Prepares the public web deployment.
 *
 * Run:  npm run deploy:web        prepare and check
 *       npm run deploy:web -- --push   prepare, check, and upload
 *
 * The kiosk build and the public web build are the same artifact. What differs
 * is what each one carries. A kiosk holds the embedding model and the films on
 * its own disk, because it has to work with the network off. Cloudflare Pages
 * refuses any single file over 25 MiB, and three of ours are far over it:
 *
 *   models/…/model_quantized.onnx   113 MB
 *   media/bek-45-mahatma-phule.mp4  115 MB
 *   media/bek-04-caste-formation.mp4 100 MB
 *
 * So this mirrors `out/` without them. The application already expects that:
 * the search worker asks whether this device has a model and fetches one from
 * the Hugging Face CDN when it does not, and the AV player falls back to the
 * Internet Archive copy the pipeline downloaded, which serves range requests
 * with an open CORS header. Neither is a second build and neither is a stub.
 *
 * The mirror is made of hard links, so it costs no disk and takes no time.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'apps/web/out');
const WEB = path.join(ROOT, 'apps/web/out-web');

/** Cloudflare Pages refuses a single asset larger than this. */
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

/** And refuses a deployment with more files than this on the free plan. */
const MAX_FILES = 20_000;

/**
 * What the web deployment does not carry, and what carries it instead.
 * Each one must have a fallback the application actually takes, or leaving it
 * out is not a deployment decision but a broken page.
 */
const LEFT_BEHIND = [
  {
    dir: 'models',
    instead: 'the Hugging Face CDN, chosen by the search worker at run time',
  },
  {
    dir: 'media',
    instead: 'the Internet Archive, chosen by the AV player when a file 404s',
  },
];

if (!fs.existsSync(OUT)) {
  console.error('No build to deploy. Run: npm run build');
  process.exit(1);
}

fs.rmSync(WEB, { recursive: true, force: true });
fs.mkdirSync(WEB, { recursive: true });

const skip = new Set(LEFT_BEHIND.map((l) => l.dir));
let files = 0;
let bytes = 0;

/** Hard links, so a 200 MB mirror costs nothing and is instant. */
function mirror(from, to, top = true) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (top && skip.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      mirror(source, target, false);
    } else {
      fs.linkSync(source, target);
      files++;
      bytes += fs.statSync(source).size;
    }
  }
}

mirror(OUT, WEB);

/** Anything Pages would refuse, found here rather than halfway through an upload. */
const oversized = [];
function measure(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      measure(full);
      continue;
    }
    const size = fs.statSync(full).size;
    if (size > MAX_ASSET_BYTES) {
      oversized.push({ path: path.relative(WEB, full), size });
    }
  }
}
measure(WEB);

console.log(`Prepared ${path.relative(ROOT, WEB)}`);
console.log(`  ${String(files)} files, ${(bytes / 1e6).toFixed(0)} MB`);
for (const { dir, instead } of LEFT_BEHIND) {
  const held = path.join(OUT, dir);
  const held_mb = fs.existsSync(held)
    ? (
        fs
          .readdirSync(held, { recursive: true })
          .map((f) => path.join(held, String(f)))
          .filter((f) => fs.statSync(f).isFile())
          .reduce((n, f) => n + fs.statSync(f).size, 0) / 1e6
      ).toFixed(0)
    : '0';
  console.log(`  left behind  ${dir}/  ${held_mb} MB, served instead by ${instead}`);
}

let failed = false;
if (oversized.length > 0) {
  failed = true;
  console.error(`\n${String(oversized.length)} file(s) over the 25 MiB Pages limit:`);
  for (const f of oversized) {
    console.error(`  ${(f.size / 1e6).toFixed(1)} MB  ${f.path}`);
  }
  console.error('Each needs somewhere else to be served from, and a fallback the');
  console.error('application takes, before it can be left out of the upload.');
}
if (files > MAX_FILES) {
  failed = true;
  console.error(`\n${String(files)} files, and the free plan allows ${String(MAX_FILES)}.`);
}
if (failed) process.exit(1);

console.log('\nNothing exceeds 25 MiB. Ready to upload.');

if (!process.argv.includes('--push')) {
  console.log('\nTo upload:');
  console.log('  npx wrangler login              once, opens a browser');
  console.log('  npm run deploy:web -- --push');
  process.exit(0);
}

/*
 * The Pages project. Not "toran": that name is taken across Cloudflare, so the
 * first deploy created "toran-as2" instead, and passing "toran" again would try
 * to create a second project rather than deploy to the first. Set
 * TORAN_PAGES_PROJECT to deploy somewhere else.
 */
const project = process.env.TORAN_PAGES_PROJECT ?? 'toran-as2';
console.log(`\nUploading to Cloudflare Pages project "${project}"`);
const result = spawnSync(
  'npx',
  ['--yes', 'wrangler@4', 'pages', 'deploy', WEB, '--project-name', project],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
