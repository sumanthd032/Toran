/**
 * The citation gate. Run with `npm test`.
 *
 * Every test here is a way a language model fails in front of a jury. They are
 * written as the failure, not as the feature, because "the assistant refuses
 * when the corpus does not support an answer" is only worth what its refusals
 * are worth.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gate,
  GateError,
  INSUFFICIENT,
  questionKey,
  readReply,
  refusal,
  writeReply,
  type Answer,
} from './assistant.ts';
import { articleLocator, citation, citedPassage, paragraphLocator } from './citation.ts';

const article17 = citedPassage({
  text: '"Untouchability" is abolished and its practice in any form is forbidden. The enforcement of any disability arising out of "Untouchability" shall be an offence punishable in accordance with law.',
  citation: citation({
    corpus: 'constitution',
    workId: 'coi',
    pageId: 'coi-art17-a17',
    // The Constitution is cited by article, not by page. A fixture that cited
    // it by page would also be hiding the fact that "Article 17" is checkable
    // against the locator rather than against the article's own words.
    locator: articleLocator('17'),
  }),
  language: 'en',
});

const debate = citedPassage({
  text: 'The Untouchables want the same benefits, and they want to be treated as part and parcel of Hindu society.',
  citation: citation({
    corpus: 'cad',
    workId: 'cad-v7',
    pageId: 'cad-v7-62-131-para-98638',
    locator: paragraphLocator({
      volume: 7,
      sitting: 62,
      paragraph: 131,
      date: '1948-11-29',
    }),
  }),
  language: 'en',
  speaker: 'B. R. Ambedkar',
});

const found = [article17, debate];
const ENGINE = 'groq openai/gpt-oss-120b';
const ask = (raw: string, retrieved = found): Answer =>
  gate(raw, retrieved, 'What does Article 17 do?', ENGINE);

const because = (raw: string, retrieved = found): string => {
  try {
    ask(raw, retrieved);
    return 'no refusal';
  } catch (error) {
    return error instanceof GateError ? error.because : 'wrong error type';
  }
};

test('a cited answer passes, and carries the passages it rested on', () => {
  const answer = ask(
    'Article 17 abolishes untouchability and forbids its practice in any form [1]. ' +
      'Enforcing a disability arising out of it is an offence [1]. ' +
      'The Assembly debated it in November 1948 [2].',
  );
  assert.equal(answer.kind, 'answer');
  assert.equal(answer.segments.length, 3);
  assert.equal(answer.segments[0]?.support[0]?.citation.pageId, 'coi-art17-a17');
  assert.equal(answer.segments[2]?.support[0]?.speaker, 'B. R. Ambedkar');
  assert.equal(answer.engine, ENGINE);
  assert.equal(answer.language, 'en');
});

test('a sentence added after the last citation fails the whole answer', () => {
  // The most common real failure: the model cites its way through and then
  // writes a closing line of its own.
  assert.equal(
    because('Article 17 abolishes untouchability [1]. It was finally enforced in 1955.'),
    'ungrounded',
  );
});

test('an answer that cites nothing at all fails', () => {
  assert.equal(because('Article 17 abolishes untouchability.'), 'ungrounded');
});

test('a citation pointing past the passages it was given fails', () => {
  // A model inventing [7] looks exactly like a model citing correctly, which
  // is why this is checked rather than trusted.
  assert.equal(because('Article 17 abolishes untouchability [7].'), 'ungrounded');
});

test('a fabricated quotation fails, even when the marker is valid', () => {
  assert.equal(
    because('Dr. Ambedkar called it "the very soul of the Constitution" [2].'),
    'ungrounded',
  );
});

test('a real quotation passes, through different punctuation and case', () => {
  const answer = ask(
    'The Assembly heard that the Untouchables "want to be treated as part and parcel of Hindu society" [2].',
  );
  assert.equal(answer.segments.length, 1);
});

test('the refusal sentinel is a refusal, not an answer that says INSUFFICIENT', () => {
  assert.equal(because(INSUFFICIENT), 'not-in-corpus');
  assert.equal(
    because(`${INSUFFICIENT}. The passages do not cover this.`),
    'not-in-corpus',
  );
});

test('with nothing retrieved there is nothing to cite, and it says so', () => {
  assert.equal(
    because('Article 17 abolishes untouchability [1].', []),
    'nothing-retrieved',
  );
  assert.equal(because('', []), 'ungrounded');
});

test('two markers on one claim keep both passages, without repeating one', () => {
  const answer = ask('Untouchability was abolished and then debated [1][2][1].');
  assert.equal(answer.segments.length, 1);
  assert.equal(answer.segments[0]?.support.length, 2);
});

test('a claim marked with a list of passages resolves each of them', () => {
  const answer = ask('Untouchability was abolished and then debated [1, 2].');
  assert.equal(answer.segments[0]?.support.length, 2);
});

test('an answer opening with a citation and no claim fails', () => {
  assert.equal(because('[1] Article 17 abolishes untouchability.'), 'ungrounded');
});

test('a reply survives the wire, and one with an uncited segment does not', () => {
  const answer = ask('Article 17 abolishes untouchability [1].');
  const back = readReply(writeReply(answer));
  assert.equal(back.kind, 'answer');
  assert.equal(
    back.kind === 'answer' ? back.segments[0]?.support[0]?.citation.pageId : null,
    'coi-art17-a17',
  );

  const stripped = writeReply(answer);
  (stripped['segments'] as { support: unknown[] }[])[0]!.support = [];
  assert.throws(() => readReply(stripped), /cites nothing/);
});

test('a refusal survives the wire with the passages search did find', () => {
  const back = readReply(
    writeReply(
      refusal({
        question: 'When did Dr. Ambedkar visit Japan?',
        because: 'not-in-corpus',
        nearest: [debate],
        engine: ENGINE,
      }),
    ),
  );
  assert.equal(back.kind, 'refusal');
  assert.equal(back.kind === 'refusal' ? back.because : null, 'not-in-corpus');
  assert.equal(back.kind === 'refusal' ? back.nearest.length : 0, 1);
});

test('a cached question is found however a visitor spaces and cases it', () => {
  assert.equal(
    questionKey('  What does Article 17 DO? '),
    questionKey('what does article 17 do'),
  );
  // A near miss must miss, or the kiosk answers a question nobody asked.
  assert.notEqual(
    questionKey('what does article 17 do'),
    questionKey('what does article 15 do'),
  );
});
