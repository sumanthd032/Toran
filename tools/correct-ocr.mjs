/**
 * The curator's correction path for OCR. STEPS.md step 8.
 *
 *   node tools/correct-ocr.mjs --page ID --by "Name"   walk a page's readings
 *   node tools/correct-ocr.mjs --list                  what has been corrected
 *
 * Shows each region a machine read, with the confidence it reported and its
 * citation, lowest confidence first, because that is where a curator's time
 * is worth most. A correction is appended to data/curation/corrections.jsonl
 * and a PREMIS event is appended to the preservation log. Neither file is
 * ever edited.
 *
 * The machine's output is not touched. It stays in data/dip/ocr exactly as
 * the model produced it, and the station shows the correction as a change
 * from it rather than in place of it. That is the difference between an
 * archive and a database, and it is why the event log exists.
 *
 * The Curator Console makes the same correction through Toran Core, with the
 * same writer. A visitor's kiosk never can: it holds no curator key. D-118.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { ArchiveFiles } from '../apps/core/src/curation/files.ts';
import { correctOcr } from '../apps/core/src/curation/ocr.ts';

const DIP = 'data/dip';
const LOG = 'data/curation/corrections.jsonl';
const PREMIS = 'data/aip/premis.jsonl';
// The same writer the Curator Console uses, so a correction made here and one
// made there are the same record with the same PREMIS event.
const files = new ArchiveFiles(process.cwd());

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1]?.trim();
};

if (!fs.existsSync(`${DIP}/scans.json`)) {
  console.error('No scans yet. Run npm run scans first.');
  process.exit(1);
}
const scans = JSON.parse(fs.readFileSync(`${DIP}/scans.json`, 'utf8'));
const corrections = fs.existsSync(LOG)
  ? fs
      .readFileSync(LOG, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l))
  : [];

if (args.includes('--list')) {
  if (corrections.length === 0) {
    console.log('No corrections yet.');
  }
  for (const c of corrections) {
    console.log(
      `${c.pageId}  ${c.regionId.padEnd(6)} ${c.corrects.padEnd(6)} ` +
        `${c.by}, ${c.at.slice(0, 10)}`,
    );
    console.log(`   was: ${c.was}`);
    console.log(`   now: ${c.text}`);
  }
  process.exit(0);
}

const pageId = flag('page');
const by = flag('by');
if (pageId === undefined || by === undefined || by === '' || by.startsWith('--')) {
  console.error(
    'Say which page and who is correcting:\n' +
      '  node tools/correct-ocr.mjs --page samvidhan-1957-en-p007 --by "Your name"',
  );
  process.exit(1);
}
const scan = scans.find((s) => s.id === pageId);
if (scan === undefined) {
  console.error(`No scan called ${pageId}. There are:`);
  for (const s of scans) console.error(`  ${s.id}`);
  process.exit(1);
}

const readings = fs
  .readdirSync(`${DIP}/ocr`)
  .filter((f) => f.startsWith(`${pageId}.`) && /\.(surya|vlm)\.json$/.test(f))
  .map((f) => JSON.parse(fs.readFileSync(`${DIP}/ocr/${f}`, 'utf8')));
if (readings.length === 0) {
  console.error(`Nothing has read ${pageId} yet. Run ocr:printed or ocr:handwriting.`);
  process.exit(1);
}

const cite = (s) => {
  const l = s.locator;
  if (l.kind === 'page') return `${s.title}, page ${l.page}`;
  if (l.kind === 'folio') {
    return l.folio === null
      ? `${l.manuscript}, a leaf${l.printed ? `; printed at ${l.printed}` : ''}`
      : `${l.manuscript}, leaf ${l.folio}${l.printed ? `; printed at ${l.printed}` : ''}`;
  }
  return s.title;
};

/**
 * Asking a question. A curator answers at a terminal; a script pipes its
 * answers in, and a closed pipe never resolves a readline question, so the
 * piped case reads everything first and answers from the queue.
 */
const interactive = process.stdin.isTTY === true;
const queued = interactive
  ? []
  : (
      await new Promise((resolve) => {
        let input = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => (input += chunk));
        process.stdin.on('end', () => resolve(input));
      })
    ).split('\n');
const rl = interactive
  ? readline.createInterface({ input: process.stdin, output: process.stdout })
  : null;
const ask = async (prompt) => {
  if (rl !== null) return rl.question(prompt);
  const answer = queued.shift() ?? 'q';
  process.stdout.write(`${prompt}${answer}\n`);
  return answer;
};

let made = 0;

console.log(`\n${scan.heading}`);
console.log(`${cite(scan)}\n`);

for (const reading of readings) {
  const already = new Set(
    corrections
      .filter((c) => c.pageId === pageId && c.corrects === reading.pipeline)
      .map((c) => c.regionId),
  );
  // Lowest confidence first: the machine has already said where to look.
  const queue = [...reading.regions]
    .filter((r) => !already.has(r.id))
    .sort((a, b) => a.confidence - b.confidence);
  console.log(`\n${reading.model}`);
  console.log(
    `confidence here means: ${reading.confidenceIs ?? "the model's own probability"}`,
  );
  console.log(`${queue.length} region(s) not yet corrected, least confident first.\n`);

  for (const [i, region] of queue.entries()) {
    console.log(
      `[${i + 1}/${queue.length}] ${region.id}  confidence ${region.confidence.toFixed(3)}`,
    );
    console.log(`   ${region.text}`);
    const answer = (await ask('\n  [Enter] it is right  [e] correct it  [q] stop: '))
      .trim()
      .toLowerCase();
    if (answer === 'q') break;
    if (answer !== 'e') continue;
    const text = (await ask('  What it actually says: ')).trim();
    if (text === '') {
      console.log('  nothing entered, left as it was.');
      continue;
    }
    const note = (await ask('  A note, if any: ')).trim();
    correctOcr(files, {
      pageId,
      regionId: region.id,
      pipeline: reading.pipeline,
      text,
      by,
      note: note === '' ? null : note,
    });
    made++;
    console.log('  recorded.\n');
  }
}
rl?.close();

if (made > 0) {
  console.log(
    `\n${made} correction(s) in ${LOG}, ${made} event(s) in ${PREMIS}. Republishing.`,
  );
  const r = spawnSync('node', ['tools/build-scans.mjs'], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
console.log('\nNothing corrected.');
