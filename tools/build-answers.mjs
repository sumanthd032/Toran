/**
 * Prepares the Research Assistant's offline answers.
 *
 * The degradation matrix says the assistant falls back to a cached demo path
 * with no internet and with no Core. This is what fills it: a small set of
 * questions asked once, here, with the answers written to the device so the
 * kiosk can answer them with the network off and in front of a jury.
 *
 * It does not cache everything, and it is not a warm cache for live traffic.
 * It is the scripted path, and a question a visitor invents still needs Core.
 * Saying that plainly is better than a cache that quietly answers a question
 * close to the one asked.
 *
 *   npm run build:answers            prepare every question below
 *   npm run build:answers -- --list  show what is prepared, ask nothing
 *
 * Needs GROQ_API_KEY. Retrieval runs against the built index the same way the
 * kiosk does, so a prepared answer rests on the passages the kiosk would have
 * found rather than on passages chosen by hand.
 */

import fs from 'node:fs';
import path from 'node:path';
import { questionKey, writeReply } from '@toran/contracts';
import { ask, RETRIEVE } from '../apps/core/src/assistant/ask.ts';
import { groqProvider } from '../apps/core/src/assistant/provider.ts';
import { search } from '../packages/indexer/src/query.mjs';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'apps/web/public/archive/assistant.json');

if (fs.existsSync(path.join(ROOT, '.env.local'))) {
  process.loadEnvFile(path.join(ROOT, '.env.local'));
}

/**
 * The scripted path.
 *
 * Chosen from what the index actually returns, not from what the archive ought
 * to hold. Five questions were dropped across two runs because the passages
 * retrieved for them did not support an answer. "What does Article 15 forbid"
 * retrieves clauses (4) and (6), which are the exceptions rather than the
 * prohibition. "Caste being a wall" does not bring back the page with the wall
 * on it. "What punishment does the law set for keeping someone out of a temple"
 * retrieves Brahmanic law from volume 7 rather than the Act of 1955. The model
 * refused all of them, correctly. Writing questions this corpus can answer is
 * the honest fix; widening the gate to let those through would not have been.
 *
 * The last one has no answer in this corpus and is here on purpose. A prepared
 * refusal is the only way the demo can show the refusal with the network off,
 * and the refusal is the part of this application worth showing.
 */
const QUESTIONS = [
  'What does Article 17 of the Constitution do?',
  'Was untouchability defined in the Constitution?',
  'What is the Protection of Civil Rights Act?',
  'What happened at Mahad?',
  'Who were the Shudras?',
  'What did Dr. Ambedkar say in reply to the Mahatma?',
  'What did Dr. Ambedkar say about cricket?',
];

if (process.argv.includes('--list')) {
  for (const q of QUESTIONS) console.log(`${questionKey(q)}\n  ${q}`);
  process.exit(0);
}

const key = (process.env.GROQ_API_KEY ?? '').trim();
if (key === '') {
  console.error(
    'No GROQ_API_KEY. Copy .env.example to .env.local and put a key in it.\n' +
      'A free key, no card, is at https://console.groq.com/keys\n' +
      'Without it the kiosk has no prepared answers and every question needs Core.',
  );
  process.exit(1);
}

const provider = groqProvider(key);
const prepared = [];
let refusals = 0;
let retries = 0;

/**
 * Stays under the provider's token ceiling.
 *
 * Measured at 8,000 tokens a minute on the whole key, and a question with six
 * passages costs about 1,000, or 2,000 when the gate sends it back once. A
 * fixed pause between questions was not enough: the seventh and eighth of the
 * first run came back rate limited, so this counts what has been spent in the
 * last minute and waits until there is room.
 */
const TOKENS_PER_MINUTE = 8000;
const spent = [];

async function room(expected) {
  for (;;) {
    const now = Date.now();
    while (spent.length > 0 && now - spent[0].at > 60_000) spent.shift();
    const used = spent.reduce((n, s) => n + s.tokens, 0);
    if (used + expected <= TOKENS_PER_MINUTE * 0.8) return;
    const wait = 60_000 - (now - spent[0].at) + 500;
    console.log(`   waiting ${String(Math.round(wait / 1000))}s for the token window`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

for (const question of QUESTIONS) {
  const hits = await search(question, RETRIEVE);
  // Budget for a retry, because one is allowed and it is the expensive case.
  await room(2200);
  const result = await ask(provider, { question, passages: hits });
  spent.push({ at: Date.now(), tokens: result.tokens });
  if (result.attempts > 1) retries++;
  if (result.reply.kind === 'refusal') refusals++;

  // A prepared answer says it was prepared, so the screen can tell a visitor
  // it came off the device rather than from the server a moment ago.
  const reply =
    result.reply.kind === 'answer' ? { ...result.reply, cached: true } : result.reply;
  prepared.push(writeReply(reply));

  const shape =
    result.reply.kind === 'answer'
      ? `${String(result.reply.segments.length)} cited claim(s)`
      : `refused: ${result.reply.because}`;
  console.log(
    `${String(result.ms).padStart(5)}ms  ${String(result.tokens).padStart(5)}t  ${shape}  ${question}`,
  );
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(prepared, null, 1)}\n`);

const bytes = fs.statSync(OUT).size;
console.log(
  `\n${String(prepared.length)} prepared, ${String(refusals)} of them refusals, ` +
    `${String(retries)} needed a second attempt.`,
);
console.log(`${path.relative(ROOT, OUT)}, ${String(Math.round(bytes / 1024))} KB`);
