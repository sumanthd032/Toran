/**
 * What the Research Assistant talks to, behind one interface.
 *
 * D-007 chose Groq and the abstraction in the same breath, for a reason the
 * project has now been given twice: the catalogue moves. D-113 found that the
 * Llama 4 vision model the plan assumed was gone, and D-134 found that Llama
 * 3.3 70B, the model D-007 named, is gone too. A provider that is one file
 * behind one interface is a provider that can be replaced in an afternoon.
 *
 * A provider's only job is to turn a prompt into text. It does not decide
 * whether that text may be shown. The gate does, in the contract, on both
 * sides of the wire.
 */

export interface Prompt {
  readonly system: string;
  readonly user: string;
  /** A ceiling, because the free tier meters output tokens per minute. */
  readonly maxTokens: number;
}

export interface Generation {
  readonly text: string;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly ms: number;
}

export interface Provider {
  /** Shown on screen beside every answer, so a visitor knows what wrote it. */
  readonly engine: string;
  generate: (prompt: Prompt) => Promise<Generation>;
}

export class ProviderError extends Error {
  public override readonly name = 'ProviderError';
  /** True when the provider said to come back later rather than that we were wrong. */
  public readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

/**
 * Groq. Free tier, no card, measured at 1,000 requests a day and 8,000 tokens
 * a minute on this account. D-134.
 *
 * The model is a constant rather than an environment variable on purpose. A
 * model that changes without a decision entry is a model nobody checked the
 * refusal behaviour of, and the refusal is the whole feature.
 */
export const GROQ_MODEL = 'openai/gpt-oss-120b';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/** A request that has not answered by now will not answer usefully. */
const GROQ_TIMEOUT_MS = 12_000;

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string };
}

/**
 * How much of the token budget the model may spend thinking before it writes.
 *
 * Low, measured. The gpt-oss models bill reasoning tokens against
 * `max_completion_tokens`, and at the default effort a question about a single
 * section of an Act spent the entire 700-token budget reasoning and returned
 * empty content. The same question at low effort spent 12 reasoning tokens and
 * answered correctly. Quoting a passage and numbering it is extraction, not
 * deduction, and the ceiling that binds is 8,000 tokens a minute for the whole
 * hall, so thinking eleven times longer buys nothing and costs questions.
 */
const REASONING_EFFORT = 'low';

export function groqProvider(apiKey: string): Provider {
  return {
    engine: `groq ${GROQ_MODEL}`,
    async generate(prompt) {
      const started = Date.now();
      let response: Response;
      try {
        response = await fetch(GROQ_ENDPOINT, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            reasoning_effort: REASONING_EFFORT,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
            // The answer must be the same every time a jury asks the same
            // question, and a citation is not a place for sampling.
            temperature: 0,
            max_completion_tokens: prompt.maxTokens,
          }),
          signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
        });
      } catch (error) {
        throw new ProviderError(
          `groq did not answer: ${error instanceof Error ? error.message : 'unknown'}`,
          true,
        );
      }

      if (response.status === 429) {
        throw new ProviderError('groq rate limit reached', true);
      }
      if (!response.ok) {
        // The body may name the problem, and it may name the key. Only the
        // status goes into a log.
        throw new ProviderError(
          `groq returned ${String(response.status)}`,
          response.status >= 500,
        );
      }

      const body = (await response.json()) as ChatResponse;
      const text = body.choices?.[0]?.message?.content ?? '';
      const reasoned = body.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
      if (text.trim() === '') {
        // Empty content with tokens spent means the model thought until it ran
        // out of budget. Saying which it was is the difference between an hour
        // of debugging and a minute of it.
        throw new ProviderError(
          reasoned > 0
            ? `groq spent its ${String(prompt.maxTokens)} token budget reasoning and wrote nothing`
            : 'groq returned an empty completion',
          true,
        );
      }
      return {
        text,
        model: GROQ_MODEL,
        promptTokens: body.usage?.prompt_tokens ?? 0,
        completionTokens: body.usage?.completion_tokens ?? 0,
        ms: Date.now() - started,
      };
    },
  };
}
