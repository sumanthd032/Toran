/**
 * Verifies the Toran palette against the contrast contract in CLAUDE.md section 10:
 * body text 7:1 (exceeds WCAG AAA), set for the over-65 visitor.
 * Reads the real token values out of tokens.css so this cannot drift from the source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'apps/web/src/design/tokens.css'), 'utf8');

const materials = Object.fromEntries(
  [...css.matchAll(/--(m-[a-z-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]),
);

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgb(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [label, foreground, background, required]
const BODY = 7;
// Non-text UI (borders, focus rings, icons) needs 3:1 under WCAG 1.4.11.
// We hold it to 4.5 anyway.
const UI = 4.5;
const checks = [
  ['body on page', 'm-ink', 'm-paper', BODY],
  ['body on raised card', 'm-ink', 'm-vellum', BODY],
  ['secondary on page', 'm-ink-soft', 'm-paper', BODY],
  ['accent TEXT on page', 'm-brass-deep', 'm-paper', BODY],
  ['section TEXT on page', 'm-sandstone-deep', 'm-paper', BODY],
  ['danger text on page', 'm-correction', 'm-paper', BODY],
  ['confirmed text on page', 'm-verdigris', 'm-paper', BODY],
  ['accent UI on page', 'm-brass', 'm-paper', UI],
  ['section mark on page', 'm-sandstone', 'm-paper', UI],
  ['body on hall', 'm-light', 'm-hall', BODY],
  ['body on slab', 'm-light', 'm-slab', BODY],
  ['accent text on hall', 'm-brass-lit', 'm-hall', BODY],
];

let failed = 0;
console.log('Toran contrast audit\n');
for (const [label, fg, bg, need] of checks) {
  const r = ratio(materials[fg], materials[bg]);
  const ok = r >= need;
  if (!ok) failed++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(24)} ${materials[fg]} on ${materials[bg]}  ` +
      `${r.toFixed(2)}:1  (need ${need}:1)`,
  );
}
console.log(
  failed === 0
    ? `\nAll ${checks.length} pairs meet contract.`
    : `\n${failed} of ${checks.length} FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
