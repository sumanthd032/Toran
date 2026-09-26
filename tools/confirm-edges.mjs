/**
 * The confirmation queue for the Provenance Graph. STEPS.md step 7.
 *
 * Shows a curator each link that nobody has confirmed, with its evidence in
 * full and cited, and records their decision: confirmed, rejected, or left
 * for later. A decision is appended to data/curation/edges.jsonl with the
 * curator's name, the time, a note, and the digest of the evidence they were
 * shown, so it holds for that evidence and no other. Nothing is ever edited
 * or removed from that file; a later decision on the same evidence wins. A
 * PREMIS event records who decided. The Curator Console writes through the
 * same function.
 *
 *   node tools/confirm-edges.mjs --by "Name"    review the links awaiting a decision
 *   node tools/confirm-edges.mjs --list         every link and where it stands
 *
 * The graph is rebuilt afterwards, so a confirmed link is drawn solid at once.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { decideEdge } from '../apps/core/src/curation/edges.ts';
import { ArchiveFiles } from '../apps/core/src/curation/files.ts';

const GRAPH = 'apps/web/public/archive/graph.json';
const LOG = 'data/curation/edges.jsonl';

const args = process.argv.slice(2);
const by = args.includes('--by') ? args[args.indexOf('--by') + 1]?.trim() : undefined;
const list = args.includes('--list');

if (!fs.existsSync(GRAPH)) {
  console.error('No graph yet. Run npm run build:graph first.');
  process.exit(1);
}
const graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
const works = new Map(
  JSON.parse(fs.readFileSync('data/dip/works.json', 'utf8')).map((w) => [w.id, w]),
);
const nodes = new Map(graph.nodes.map((n) => [n.id, n]));

function cite(p) {
  const l = p.locator;
  switch (l.kind) {
    case 'page':
      return `${works.get(p.workId)?.title ?? p.workId}, page ${l.page}${l.observed ? '' : ' (inferred)'}`;
    case 'plate':
      return `${works.get(p.workId)?.title ?? p.workId}, ${l.plate}`;
    case 'paragraph':
      return `Constituent Assembly Debates, volume ${l.volume}, sitting ${l.sitting}, paragraph ${l.paragraph}${l.procedural ? ' (the record after it)' : ''}, ${l.date}`;
    case 'article':
      return l.version === undefined || l.version === null
        ? `Constitution of India, Article ${l.article}`
        : l.version.draft
          ? `Draft Article ${l.version.article} of ${l.version.year}, now Article ${l.article} (constitutionofindia.net)`
          : `Constitution of India, Article ${l.article}, text of ${l.version.year}`;
    case 'section':
      return `${l.act}, ${l.year}, ${l.section === 'title' ? 'long title' : `section ${l.section}`}`;
    default:
      return JSON.stringify(l);
  }
}

const label = (id) => {
  const n = nodes.get(id);
  return n === undefined ? id : `${n.title} (${n.date})`;
};

const wrap = (text, indent) =>
  text
    .split(/\s+/)
    .reduce(
      (lines, word) => {
        const last = lines[lines.length - 1];
        if (last.length + word.length + 1 > 88 - indent) lines.push(word);
        else lines[lines.length - 1] = last === '' ? word : `${last} ${word}`;
        return lines;
      },
      [''],
    )
    .map((l) => ' '.repeat(indent) + l)
    .join('\n');

function show(e, i, total) {
  console.log(`\n[${i}/${total}] ${label(e.from)}  ${e.assertion}  ${label(e.to)}`);
  const how = {
    record: 'recorded by the source itself',
    citation: 'the later text cites the earlier one',
    reading: 'proposed from reading the two texts',
    semantic: `proposed only because the passages are close in meaning (cosine ${e.score})`,
  }[e.method];
  console.log(`       ${how}${e.assertedBy ? `: ${e.assertedBy}` : ''}`);
  e.evidence.forEach((p, n) => {
    console.log(`\n  ${n + 1}. ${cite(p)}${p.speaker ? `, ${p.speaker}` : ''}`);
    console.log(wrap(p.text, 5));
  });
}

if (list) {
  for (const e of graph.edges) {
    const c = e.confirmation;
    const state =
      c === null
        ? 'awaiting a curator'
        : `${c.decision} by ${c.by}, ${c.at.slice(0, 10)}`;
    console.log(`${e.id.padEnd(36)} ${e.method.padEnd(9)} ${state}`);
  }
  process.exit(0);
}

if (by === undefined || by === '' || by.startsWith('--')) {
  console.error('Say who is deciding: node tools/confirm-edges.mjs --by "Your name"');
  process.exit(1);
}

const pending = graph.edges.filter((e) => e.confirmation === null);
if (pending.length === 0) {
  console.log('Every link has a decision.');
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
// The same writer the Curator Console uses, so a decision made here and one
// made there are the same record, with the same PREMIS event.
const files = new ArchiveFiles(process.cwd());
let decided = 0;
for (const [i, e] of pending.entries()) {
  show(e, i + 1, pending.length);
  const answer = (
    await rl.question('\nIs this link right? [c]onfirm  [r]eject  [s]kip  [q]uit: ')
  )
    .trim()
    .toLowerCase();
  if (answer === 'q') break;
  if (answer !== 'c' && answer !== 'r') continue;
  const note = (
    await rl.question(
      answer === 'r' ? 'Why is it wrong? ' : 'A note, if any (Enter for none): ',
    )
  ).trim();
  const record = decideEdge(files, {
    edge: e.id,
    digest: e.digest,
    decision: answer === 'c' ? 'confirmed' : 'rejected',
    by,
    note: note === '' ? null : note,
  });
  decided++;
  console.log(`       ${record.decision}.`);
}
rl.close();

if (decided > 0) {
  console.log(
    `\n${decided} decision${decided === 1 ? '' : 's'} recorded in ${LOG}. Rebuilding the graph.`,
  );
  const r = spawnSync('node', ['tools/build-graph.mjs'], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
