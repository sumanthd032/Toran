/**
 * The Bhashini ULCA client. Translation, narration and speech recognition
 * through the Government of India's own language platform. See D-008.
 *
 * Bhashini is a two-call API and the shape is not obvious, so it is worth
 * stating plainly. The first call asks a pipeline which model serves a given
 * task for a given language pair; it answers with a serviceId and, for a
 * caller who authenticated, with the inference endpoint and the key that
 * endpoint wants. The second call does the work, at that endpoint, naming that
 * serviceId. Configuration is stable, so this module makes the first call once
 * per task set per run and reuses the answer.
 *
 * This module never runs in a browser. The credentials cannot ship to a kiosk,
 * so translation and narration are fetched at build time and cached into the
 * archive, and the kiosk reads the cache with no network at all.
 */
import { credentials } from './credentials.mjs';

export const CONFIG_URL =
  'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';

/**
 * MeitY's own pipeline. Published, and the only one a hackathon key is granted
 * against. Overridable because ULCA hands institutional users their own.
 */
export const PIPELINE_ID = '64392f96daac500b55c543cd';

export class BhashiniError extends Error {
  constructor(message, { status = null, body = null, task = null } = {}) {
    super(message);
    this.name = 'BhashiniError';
    this.status = status;
    this.body = body;
    this.task = task;
  }
}

const isRetryable = (status) => status === 429 || status === 408 || status >= 500;

async function post(url, headers, body, { attempts = 4, timeoutMs = 60_000 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      last = new BhashiniError(`${url} did not answer: ${cause.message}`);
      await sleep(backoff(i));
      continue;
    }
    const text = await response.text();
    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch {
        throw new BhashiniError(`${url} answered with something that is not JSON`, {
          status: response.status,
          body: text.slice(0, 400),
        });
      }
    }
    last = new BhashiniError(`${url} answered ${response.status}`, {
      status: response.status,
      body: text.slice(0, 400),
    });
    if (!isRetryable(response.status)) throw last;
    await sleep(backoff(i));
  }
  throw last;
}

// Bhashini's free tier is shared and its GPU workers queue, so a retry waits
// noticeably longer each time rather than hammering a service under load.
const backoff = (attempt) => 2000 * 2 ** attempt;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads a configuration response into the two things a compute call needs:
 * which service answers each task, and where to send the work.
 *
 * Split out from the call itself so it can be tested against recorded
 * responses, which is the only part of this file that can be verified without
 * a key. `endpoint` is null for an unauthenticated response, which still
 * carries the service list.
 */
export function readConfig(raw) {
  const tasks = raw?.pipelineResponseConfig;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new BhashiniError('configuration carried no pipelineResponseConfig', { body: raw });
  }
  const services = new Map();
  for (const task of tasks) {
    const first = Array.isArray(task.config) ? task.config[0] : undefined;
    if (first?.serviceId === undefined) {
      throw new BhashiniError(`no service answers ${task.taskType}`, { task: task.taskType });
    }
    services.set(task.taskType, {
      serviceId: first.serviceId,
      modelId: first.modelId ?? null,
      language: first.language ?? null,
    });
  }
  const end = raw.pipelineInferenceAPIEndPoint;
  const endpoint =
    end?.callbackUrl === undefined
      ? null
      : {
          url: end.callbackUrl,
          header: end.inferenceApiKey?.name ?? 'Authorization',
          key: end.inferenceApiKey?.value ?? null,
        };
  return { services, endpoint };
}

/**
 * The first call. `tasks` are ULCA task descriptors, for example
 * `[{ taskType: 'translation', config: { language: { sourceLanguage: 'en',
 * targetLanguage: 'mr' } } }]`.
 */
export async function configure(tasks, { pipelineId = PIPELINE_ID } = {}) {
  const { userId, ulcaApiKey, inferenceApiKey } = credentials();
  const raw = await post(
    CONFIG_URL,
    { userID: userId, ulcaApiKey },
    { pipelineTasks: tasks, pipelineRequestConfig: { pipelineId } },
  );
  const config = readConfig(raw);
  if (config.endpoint === null) {
    throw new BhashiniError(
      'the configuration call answered without an inference endpoint, which means ' +
        'the credentials were not accepted. Check BHASHINI_USER_ID and BHASHINI_ULCA_API_KEY.',
    );
  }
  // An explicitly pinned key wins, for a deployment that holds one directly.
  if (inferenceApiKey !== null) config.endpoint.key = inferenceApiKey;
  if (config.endpoint.key === null) {
    throw new BhashiniError('the configuration call named no inference key');
  }
  return config;
}

/** The second call. Returns the raw pipelineResponse, one entry per task. */
export async function compute(endpoint, tasks, inputData) {
  const raw = await post(endpoint.url, { [endpoint.header]: endpoint.key }, {
    pipelineTasks: tasks,
    inputData,
  });
  const out = raw?.pipelineResponse;
  if (!Array.isArray(out) || out.length === 0) {
    throw new BhashiniError('compute answered with no pipelineResponse', { body: raw });
  }
  return out;
}

/**
 * A session bound to one task set: configure once, then compute many times.
 * Translation of a whole volume is thousands of short calls against one
 * configuration, so re-configuring per call would double the request count for
 * no reason.
 */
export async function session(tasks, options) {
  const { services, endpoint } = await configure(tasks, options);
  return {
    services,
    endpoint,
    /** Run the same task set against fresh input. */
    run: (withService, inputData) => compute(endpoint, withService(services), inputData),
  };
}
