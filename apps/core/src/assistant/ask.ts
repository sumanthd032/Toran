/**
 * Asking a question of the corpus.
 *
 * Retrieval already happened, on the device. The kiosk searched its own index
 * and sends the passages it found, so Core needs no corpus of its own and the
 * search stays offline. What Core adds is the one thing a static export cannot
 * do: hold an API key.
 *
 * The prompt asks for the refusal, and the gate enforces it. Both, because a
 * prompt is a request and a gate is a rule. D-007 recorded the provider
 * abstraction; CLAUDE.md section 12 recorded that the refusal is validated on
 * the response rather than hoped for in the instruction.
 */

import {
  gate,
  GateError,
  INSUFFICIENT,
  readChunk,
  refusal,
  type AssistantReply,
  type CitedPassage,
  type RawChunk,
} from '@toran/contracts';
import { ProviderError, type Provider } from './provider.ts';

/**
 * How many passages go in front of the model.
 *
 * Six, because the binding limit is 8,000 tokens a minute across the whole key
 * and a printed page runs to 400 tokens. Six passages plus the instruction is
 * roughly 2,000 tokens, which is four questions a minute for the whole hall.
 * More passages would be better retrieval and fewer questions.
 */
export const RETRIEVE = 6;

/** Enough for four or five cited units. A standing visitor does not read an essay. */
const MAX_TOKENS = 700;

export const SYSTEM = [
  'You answer questions about the writings of Dr. B. R. Ambedkar, the Constituent',
  'Assembly Debates and the Constitution of India, using only the numbered passages',
  'given to you. Each passage is headed by its source, which you may use: the date of',
  'a sitting, the number of an article, the year of an Act, the speaker.',
  '',
  'Rules, all of which are checked on your output before anyone sees it:',
  '1. End every sentence with the number of the passage it comes from, in square',
  '   brackets, like this [2]. A sentence without one rejects the whole answer.',
  '2. Never write a sentence after your last bracket. The answer must end on a citation.',
  '3. Never cite a number you were not given.',
  '4. Quote only words that appear verbatim in the passage you cite.',
  '5. Never give a number, a date or a year that is not in the passage you cite or in',
  '   its source line. Moving a punishment or a date from one passage to another',
  '   rejects the answer.',
  '6. Say only what a passage says. Do not explain what it implies, do not generalise',
  '   from it, and do not add a sentence that restates it in other words. A sentence',
  '   that shares no words with the passage it cites rejects the answer.',
  '7. Never make the same point twice.',
  '8. Do not use knowledge from outside the passages, however certain you are of it.',
  `9. If the passages do not answer the question, reply with the single word ${INSUFFICIENT}`,
  '   and nothing else. This is the right answer when the archive does not hold one,',
  '   and it is always better than a plausible sentence.',
  '',
  // "Fewer is better" is load-bearing and was measured. Asking instead for
  // breadth across passages cost two correct answers out of ten and gained
  // nothing: the model reached for a second source, could not ground the
  // reach, and refused the whole question rather than the sentence.
  'One to four short sentences. Fewer is better. No preamble, heading or summary.',
].join('\n');

/** A second attempt says what went wrong, which is often enough to fix it. */
const RETRY_NOTE = (why: string): string =>
  [
    '',
    `Your previous answer was rejected: ${why}`,
    'Answer again, following every rule. If you cannot, reply with the single word',
    `${INSUFFICIENT}.`,
  ].join('\n');

/**
 * What a passage is, in words the model can use and the gate can check.
 *
 * Without this the model cannot answer "when did the Assembly debate this",
 * because the date of a sitting is in the citation and not in the words that
 * were spoken. It was refusing that question as out of corpus, which was wrong:
 * the archive holds the date, it just was not on the page. The line is built
 * from the same facts `checkable` in the contract validates a claim against, so
 * what the model is shown and what it is judged on are the same set.
 */
function sourceLine(passage: CitedPassage): string {
  const c = passage.citation;
  const l = c.locator;
  const parts: string[] = [];
  switch (l.kind) {
    case 'article':
      parts.push(`Constitution of India, Article ${l.article}`);
      if (l.version !== null) {
        parts.push(`as Article ${l.version.article} of ${String(l.version.year)}`);
      }
      break;
    case 'paragraph':
      parts.push(
        `Constituent Assembly Debates, volume ${String(l.volume)}, sitting of ${longDate(l.date)}`,
      );
      break;
    case 'section':
      parts.push(`${l.act} ${String(l.year)}, section ${l.section}`);
      break;
    case 'page':
      parts.push(
        l.volume === null
          ? `page ${String(l.page)}`
          : `volume ${String(l.volume)}, page ${String(l.page)}`,
      );
      break;
    case 'folio':
      parts.push(
        `manuscript ${l.manuscript}${l.folio === null ? '' : `, leaf ${l.folio}`}`,
      );
      break;
    case 'plate':
      parts.push(l.plate);
      break;
  }
  if (passage.speaker !== null) parts.push(passage.speaker);
  return parts.join(', ');
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const longDate = (iso: string): string => {
  const [year, month, day] = iso.split('-');
  const name = MONTHS[Number.parseInt(month ?? '0', 10) - 1];
  return name === undefined ? iso : `${Number(day)} ${name} ${year ?? ''}`.trim();
};

function userPrompt(question: string, passages: readonly CitedPassage[]): string {
  const numbered = passages
    .map((p, i) => {
      const n = String(i + 1);
      return `[${n}] Source: ${sourceLine(p)}\n[${n}] ${p.text.replace(/\s+/g, ' ').trim()}`;
    })
    .join('\n\n');
  return `Passages:\n${numbered}\n\nQuestion: ${question}`;
}

export interface AskInput {
  readonly question: string;
  /** Raw chunks from the device's search, read through the contract here. */
  readonly passages: readonly RawChunk[];
}

export interface AskResult {
  readonly reply: AssistantReply;
  /** For the log and for the decision record. Never shown to a visitor. */
  readonly attempts: number;
  readonly ms: number;
  readonly tokens: number;
}

/**
 * Reads the request, asks the provider, and gates the answer.
 *
 * One retry, and only when the gate refused rather than the model. A model
 * that read the passages and said the archive does not hold an answer is
 * right, and asking it twice is asking it to change its mind.
 */
export async function ask(provider: Provider, input: AskInput): Promise<AskResult> {
  const started = Date.now();
  const question = input.question.trim();
  const passages = input.passages.slice(0, RETRIEVE).map((row) => readChunk(row));

  if (passages.length === 0) {
    return {
      reply: refusal({ question, because: 'nothing-retrieved', engine: provider.engine }),
      attempts: 0,
      ms: Date.now() - started,
      tokens: 0,
    };
  }

  const user = userPrompt(question, passages);
  let tokens = 0;
  let lastWhy = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    let generated;
    try {
      generated = await provider.generate({
        system: attempt === 1 ? SYSTEM : SYSTEM + RETRY_NOTE(lastWhy),
        user,
        maxTokens: MAX_TOKENS,
      });
    } catch (error) {
      const because =
        error instanceof ProviderError && /rate limit/.test(error.message)
          ? 'rate-limited'
          : 'unavailable';
      return {
        reply: refusal({ question, because, nearest: passages, engine: provider.engine }),
        attempts: attempt,
        ms: Date.now() - started,
        tokens,
      };
    }

    tokens += generated.promptTokens + generated.completionTokens;
    try {
      return {
        reply: gate(generated.text, passages, question, provider.engine),
        attempts: attempt,
        ms: Date.now() - started,
        tokens,
      };
    } catch (error) {
      if (!(error instanceof GateError)) throw error;
      // The model read the passages and said they do not answer. That is the
      // feature working, not a failure to retry.
      if (error.because !== 'ungrounded') {
        return {
          reply: refusal({
            question,
            because: error.because,
            nearest: passages,
            engine: provider.engine,
          }),
          attempts: attempt,
          ms: Date.now() - started,
          tokens,
        };
      }
      lastWhy = error.message;
    }
  }

  return {
    reply: refusal({
      question,
      because: 'ungrounded',
      nearest: passages,
      engine: provider.engine,
    }),
    attempts: 2,
    ms: Date.now() - started,
    tokens,
  };
}
