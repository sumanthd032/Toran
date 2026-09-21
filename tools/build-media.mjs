/**
 * Builds the AV Archive's shipping copy.
 *
 * Takes the recordings the pipeline ingested and the transcripts the speech
 * model wrote, joins them, and writes three things: the archive file the kiosk
 * reads, the video files it plays, and a chunk file the search index picks up.
 *
 * That last one is the claim in PROJECT.md 7.6 made real. A cue goes into the
 * same chunks the books and the debates go into, is embedded by the same model
 * into the same space, and is scored by the same fusion. One query therefore
 * spans a printed page, a sitting of the Assembly and a minute of film, not
 * because anything special was written for it but because a transcript cue is
 * just another cited passage.
 *
 * Every recording passes `readRecording` here, so a recording that lost its
 * licence or a cue that lost its timecode fails the build rather than reaching
 * a kiosk.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readRecording, timecode } from '@toran/contracts';

const ROOT = process.cwd();
const DIP = path.join(ROOT, 'data/dip/media');
const PUBLIC = path.join(ROOT, 'apps/web/public');
const OUT_JSON = path.join(PUBLIC, 'archive/media.json');
const OUT_MEDIA = path.join(PUBLIC, 'media');
const OUT_CHUNKS = path.join(ROOT, 'data/dip/media-chunks.jsonl');

const recordings = JSON.parse(
  fs.readFileSync(path.join(DIP, 'recordings.json'), 'utf8'),
);
const transcriptsPath = path.join(DIP, 'transcripts.json');
const transcripts = fs.existsSync(transcriptsPath)
  ? JSON.parse(fs.readFileSync(transcriptsPath, 'utf8'))
  : {};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.mkdirSync(OUT_MEDIA, { recursive: true });

const built = [];
const chunks = [];

for (const recording of recordings) {
  const transcript = transcripts[recording.id];
  const cues = transcript?.cues ?? [];

  const record = {
    ...recording,
    transcribedBy: transcript?.engine ?? null,
    cues: cues.map((c) => ({ from: c.from, to: c.to, text: c.text })),
  };

  // Through the contract. A recording the kiosk could not lawfully show, or a
  // cue nobody could play, stops the build here rather than at a kiosk.
  const checked = readRecording(record);
  built.push(record);

  for (const cue of checked.cues) {
    chunks.push({
      chunkId: cue.id,
      pageId: cue.passage.citation.pageId,
      workId: cue.passage.citation.workId,
      corpus: 'media',
      locator: cue.passage.citation.locator,
      language: cue.passage.language,
      speaker: cue.passage.speaker,
      text: cue.passage.text,
    });
  }

  const from = path.join(DIP, recording.file);
  const to = path.join(OUT_MEDIA, recording.file);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, to);
  }

  const minutes = (recording.durationSeconds / 60).toFixed(0);
  console.log(
    `  ${recording.id.padEnd(24)} ${minutes.padStart(3)} min  ` +
      `${String(checked.cues.length).padStart(5)} cues  ` +
      `${transcript === undefined ? 'NO TRANSCRIPT' : transcript.engine}`,
  );
  if (checked.cues.length > 0) {
    const last = checked.cues[checked.cues.length - 1];
    console.log(
      `  ${''.padEnd(24)} first cue at ${timecode(checked.cues[0].from)}, ` +
        `last at ${timecode(last.from)}`,
    );
  }
}

fs.writeFileSync(OUT_JSON, `${JSON.stringify(built)}\n`);
fs.writeFileSync(
  OUT_CHUNKS,
  chunks.map((c) => JSON.stringify(c)).join('\n') + (chunks.length > 0 ? '\n' : ''),
);

const video = built.reduce((n, r) => {
  const file = path.join(OUT_MEDIA, r.file);
  return n + (fs.existsSync(file) ? fs.statSync(file).size : 0);
}, 0);

console.log(
  `\n${String(built.length)} recording(s), ${String(chunks.length)} cues into the index`,
);
console.log(`  ${path.relative(ROOT, OUT_JSON)}  ${(fs.statSync(OUT_JSON).size / 1024).toFixed(0)} KB`);
console.log(`  ${path.relative(ROOT, OUT_MEDIA)}  ${(video / 1e6).toFixed(0)} MB of video`);
console.log(`  ${path.relative(ROOT, OUT_CHUNKS)}  picked up by npm run build:index`);
