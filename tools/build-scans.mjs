/**
 * Publishes the Manuscript Station's records for the kiosks: the scanned
 * pages, what each OCR pipeline read from them, the curator corrections and
 * the accuracy report.
 *
 * The page images themselves are not copied here. They ship as IIIF tiles,
 * which build-iiif.mjs writes, so the station reads a page the same way an
 * outside researcher does.
 *
 * Run after build:archive, which clears the directory this writes into.
 *
 * Output: apps/web/public/archive/{scans.json,ocr/,corrections.json,accuracy.json}
 */
import fs from 'node:fs';
import path from 'node:path';

const DIP = 'data/dip';
const CURATION = 'data/curation';
const OUT = 'apps/web/public/archive';

if (!fs.existsSync(`${DIP}/scans.json`)) {
  console.error('No scans yet. Run npm run scans first.');
  process.exit(1);
}

const scans = JSON.parse(fs.readFileSync(`${DIP}/scans.json`, 'utf8'));
fs.mkdirSync(`${OUT}/ocr`, { recursive: true });

// Every reading of every page, named by the pipeline that produced it, so a
// station can show two machines' readings of one page side by side.
const readings = {};
let regions = 0;
if (fs.existsSync(`${DIP}/ocr`)) {
  for (const file of fs.readdirSync(`${DIP}/ocr`).sort()) {
    const match = /^(.+)\.(surya|vlm)\.json$/.exec(file);
    if (match === null) continue;
    const [, pageId, pipeline] = match;
    const payload = JSON.parse(fs.readFileSync(path.join(DIP, 'ocr', file), 'utf8'));
    fs.writeFileSync(`${OUT}/ocr/${file}`, JSON.stringify(payload));
    (readings[pageId] ??= []).push(pipeline);
    regions += payload.regions.length;
  }
}

// The index says which pipelines have read each page, so a kiosk asks for a
// reading that exists instead of probing for one that does not and taking a
// 404 for an answer.
for (const scan of scans) scan.readBy = (readings[scan.id] ?? []).sort();
fs.writeFileSync(`${OUT}/scans.json`, JSON.stringify(scans));

/** A curator's corrections. Kept in the repository, because nobody can rebuild them. */
const corrections = fs.existsSync(`${CURATION}/corrections.jsonl`)
  ? fs
      .readFileSync(`${CURATION}/corrections.jsonl`, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l))
  : [];
fs.writeFileSync(`${OUT}/corrections.json`, JSON.stringify(corrections));

const accuracy = fs.existsSync(`${DIP}/ocr/accuracy.json`)
  ? JSON.parse(fs.readFileSync(`${DIP}/ocr/accuracy.json`, 'utf8'))
  : null;
if (accuracy !== null) fs.writeFileSync(`${OUT}/accuracy.json`, JSON.stringify(accuracy));

for (const scan of scans) {
  const read = readings[scan.id] ?? [];
  console.log(
    `  ${scan.id.padEnd(28)} ${scan.kind.padEnd(11)} ${scan.script.padEnd(10)} `
    + `${read.length === 0 ? 'not read yet' : `read by ${read.join(' and ')}`}`,
  );
}
console.log(
  `scans: ${scans.length} pages, ${Object.values(readings).flat().length} readings, `
  + `${regions} regions, ${corrections.length} corrections, `
  + `accuracy ${accuracy === null ? 'not measured' : 'measured'}`,
);
