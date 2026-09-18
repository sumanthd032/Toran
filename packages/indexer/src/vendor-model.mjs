/**
 * Copy the embedding model into the web app so it is served from the same
 * origin as everything else.
 *
 * Fetching it from a CDN at runtime would put a network dependency, and a
 * foreign one, into the part of the system that is supposed to work with the
 * hall unplugged. It would also mean a cold kiosk cannot search until it can
 * reach the internet, which is the failure this whole design exists to avoid.
 *
 * The files are large and reproducible, so they are gitignored and produced
 * by this script.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CACHE = path.join(ROOT, 'node_modules/@huggingface/transformers/.cache', MODEL);
const DEST = path.join(ROOT, 'apps/web/public/models', MODEL);

// ONNX Runtime's WebAssembly binaries. transformers.js loads these from a CDN
// by default, which would mean a kiosk with no internet cannot run inference
// at all, however local the model itself is.
const ORT_SRC = path.join(ROOT, 'node_modules/@huggingface/transformers/dist');
const ORT_DEST = path.join(ROOT, 'apps/web/public/ort');
const ORT_FILES = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];

if (!fs.existsSync(CACHE)) {
  console.error(`model not in cache: ${CACHE}`);
  console.error('run the index build first, which downloads it');
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(CACHE, DEST, { recursive: true });

let total = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else {
      const size = fs.statSync(full).size;
      total += size;
      console.log(`  ${(size / 1e6).toFixed(1).padStart(7)} MB  ${path.relative(DEST, full)}`);
    }
  }
};
walk(DEST);

fs.mkdirSync(ORT_DEST, { recursive: true });
for (const name of ORT_FILES) {
  const from = path.join(ORT_SRC, name);
  if (!fs.existsSync(from)) {
    console.error(`missing onnxruntime asset: ${from}`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(ORT_DEST, name));
  const size = fs.statSync(from).size;
  total += size;
  console.log(`  ${(size / 1e6).toFixed(1).padStart(7)} MB  ort/${name}`);
}

console.log(`  ${(total / 1e6).toFixed(1).padStart(7)} MB  total, served from this origin`);
