/**
 * Transcribes the AV Archive's recordings, once, at build time.
 *
 * Run:  npm run transcribe [-- --force]
 *
 * The result is cached into the archive exactly as translations and narration
 * are, for the same reason: a kiosk in a hall with no network still has to be
 * able to search inside a film. Nothing here runs at visit time.
 *
 * Speech is Hindi in both recordings the manifest holds, and the corpus they
 * are searched beside is mostly English. That is the point rather than a
 * complication: a visitor typing in either language finds the moment in the
 * film and the page in the book, because the cues are embedded into the same
 * vector space as the text. Whisper returns Devanagari, which is what the
 * reading face is vendored for.
 *
 * The engine is recorded on every recording and printed under the player.
 * D-127 made that rule for narration and it is the same rule: a machine
 * reading of what somebody said is not the same thing as what they said.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const AIP = path.join(ROOT, 'data/aip/media');
const DIP = path.join(ROOT, 'data/dip/media');
const OUT = path.join(DIP, 'transcripts.json');

if (fs.existsSync(path.join(ROOT, '.env.local'))) {
  process.loadEnvFile(path.join(ROOT, '.env.local'));
}

/**
 * The speech model this account is served. Groq's catalogue has moved twice
 * during this project (D-113, D-134), so this is checked rather than assumed:
 * `GET /openai/v1/models` lists whisper-large-v3 and whisper-large-v3-turbo.
 * The full model rather than turbo, because a transcript is written once and
 * read by everyone who uses the kiosk afterwards.
 */
const MODEL = 'whisper-large-v3';
const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

/** Groq's free tier refuses an upload larger than this. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Cues shorter than this are merged into the one before them.
 *
 * Whisper sometimes emits a fragment of half a second holding one word. As a
 * line of a transcript that is unreadable, and as a unit of the search index it
 * is noise: a chunk of one word matches nothing and dilutes everything.
 */
const MIN_CUE_SECONDS = 1.2;

/** And a cue longer than this is a paragraph, which loses the point of a cue. */
const MAX_CUE_SECONDS = 30;

const key = (process.env.GROQ_API_KEY ?? '').trim();
if (key === '') {
  console.error(
    'No GROQ_API_KEY. Copy .env.example to .env.local and put a key in it.\n' +
      'A free key, no card, is at https://console.groq.com/keys\n' +
      'Without it the AV Archive has the recordings but no transcript, and the\n' +
      'player says so rather than pretending the film is unsearchable by nature.',
  );
  process.exit(1);
}

const force = process.argv.includes('--force');
const manifest = path.join(DIP, 'recordings.json');
if (!fs.existsSync(manifest)) {
  console.error(
    'No recordings to transcribe. Run: npm run media\n' +
      'That fetches what pipeline/media.json lists, checks each licence permits a\n' +
      'transcript, and extracts the speech track this reads.',
  );
  process.exit(1);
}
const recordings = JSON.parse(fs.readFileSync(manifest, 'utf8'));

/**
 * A cue has to contain a word.
 *
 * Over the musical passages of a dramatised documentary, Whisper emits
 * segments holding nothing but a danda: 46 minutes of episode 4 produced
 * several whose entire text was "।". As a line of transcript that is a lie
 * about what was said, and as a unit of the search index it is a chunk that
 * matches everything and means nothing.
 */
const hasWords = (text) => /\p{L}/u.test(text);

/** Whisper's segments, tidied into cues a person can read and an index can hold. */
function cuesFrom(segments) {
  const cues = [];
  for (const segment of segments) {
    const text = String(segment.text ?? '').trim();
    if (!hasWords(text)) continue;
    const from = Number(segment.start);
    const to = Number(segment.end);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;

    const last = cues[cues.length - 1];
    const tooShort = to - from < MIN_CUE_SECONDS;
    const wouldFit = last !== undefined && to - last.from <= MAX_CUE_SECONDS;
    if (tooShort && last !== undefined && wouldFit) {
      last.text = `${last.text} ${text}`;
      last.to = to;
      continue;
    }
    cues.push({ from, to, text });
  }
  return cues;
}

async function transcribe(file) {
  const bytes = fs.statSync(file).size;
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new Error(
      `${path.basename(file)} is ${(bytes / 1e6).toFixed(1)} MB and the limit is ` +
        `${String(MAX_UPLOAD_BYTES / 1e6)} MB. Lower AUDIO_BITRATE in pipeline/media.py.`,
    );
  }
  const form = new FormData();
  form.set('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  form.set('model', MODEL);
  // Segment timestamps are the whole point: without them a transcript is a
  // wall of text and "land at the second it is spoken" is not a feature.
  form.set('response_format', 'verbose_json');
  form.set('timestamp_granularities[]', 'segment');

  const started = Date.now();
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`groq returned ${String(response.status)} for ${path.basename(file)}`);
  }
  const body = await response.json();
  return {
    language: body.language ?? null,
    segments: body.segments ?? [],
    ms: Date.now() - started,
  };
}

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const transcripts = { ...existing };

for (const recording of recordings) {
  if (!force && transcripts[recording.id] !== undefined) {
    const held = transcripts[recording.id].cues.length;
    console.log(`  ${recording.id}  ${String(held)} cues already, skipping`);
    continue;
  }
  const audio = path.join(AIP, recording.audio);
  if (!fs.existsSync(audio)) {
    console.log(`  ${recording.id}  no speech track, run npm run media first`);
    continue;
  }
  const size = fs.statSync(audio).size;
  process.stdout.write(
    `  ${recording.id}  ${(recording.durationSeconds / 60).toFixed(0)} min, ` +
      `${(size / 1e6).toFixed(1)} MB  ...`,
  );
  const { language, segments, ms } = await transcribe(audio);
  const cues = cuesFrom(segments);
  transcripts[recording.id] = {
    engine: `groq ${MODEL}`,
    // The language the publisher states, not the one the model guessed. Whisper
    // returns a language name rather than a tag, so it cannot be a BCP-47 code
    // anyway, and on episode 4 it answered "Sanskrit" because the film opens on
    // the Nasadiya Sukta before the Hindi narration begins. Doordarshan's own
    // metadata says Hindi. The guess is kept beside it as what it is.
    language: recording.language,
    detected: language,
    transcribedAt: new Date().toISOString(),
    cues,
  };
  const spoken = cues.reduce((n, c) => n + (c.to - c.from), 0);
  const dropped = segments.length - cues.length;
  console.log(
    `\r  ${recording.id}  ${String(cues.length)} cues, ` +
      `${(spoken / 60).toFixed(0)} min of speech, ` +
      `${String(dropped)} wordless segments dropped, ` +
      `model heard ${language ?? '?'}, in ${(ms / 1000).toFixed(1)}s   `,
  );
}

fs.mkdirSync(DIP, { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(transcripts, null, 1)}\n`);
const total = Object.values(transcripts).reduce((n, t) => n + t.cues.length, 0);
console.log(
  `\n${String(Object.keys(transcripts).length)} transcript(s), ${String(total)} cues`,
);
console.log(`${path.relative(ROOT, OUT)}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
console.log('Next: npm run build:media, then npm run build:index');
