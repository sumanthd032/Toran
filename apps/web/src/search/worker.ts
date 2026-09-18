/// <reference lib="webworker" />

/**
 * Search worker.
 *
 * Everything here runs on the device with no network call. The index is a
 * static file the kiosk already holds, the model runs locally, and no query
 * leaves the machine. That is what lets search keep working when the hall
 * loses its connection, and it is why the two second contract in CLAUDE.md
 * section 10 is achievable with room to spare.
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { readChunk } from '@toran/contracts';
import type { CitedPassage } from '@toran/contracts';
import { scoreBm25, tokenise, type LexicalIndex } from '@toran/indexer/bm25';
import { reciprocalRankFusion } from './fuse';
import type {
  IndexManifest,
  RawChunkMeta,
  SearchHit,
  SearchResponse,
  WorkerRequest,
  WorkerResponse,
} from './types';

declare const self: DedicatedWorkerGlobalScope;

/**
 * transformers.js types `pipeline` as a large overload union keyed on literal
 * task and model names. The model id and dtype here come from the index
 * manifest rather than from literals, so that they stay tied to whatever built
 * the vectors, and widening them makes the union too big for the compiler to
 * represent. This alias states the one signature actually used.
 */
type FeatureExtractionFactory = (
  task: 'feature-extraction',
  model: string,
  options: { dtype: string },
) => Promise<FeatureExtractionPipeline>;

const loadExtractor = pipeline as unknown as FeatureExtractionFactory;

const DENSE_CANDIDATES = 60;
const LEXICAL_CANDIDATES = 60;

let manifest: IndexManifest | null = null;
let vectors: Int8Array | null = null;
/**
 * Passages are validated through the contract factory once, when the index
 * loads, rather than on every query. A record that cannot produce a citation
 * never enters this array, so no search result can lack one.
 */
let passages: CitedPassage[] = [];
let chunkIds: string[] = [];
let lexical: LexicalIndex | null = null;
let extractor: FeatureExtractionPipeline | null = null;

function post(message: WorkerResponse): void {
  self.postMessage(message);
}

async function loadJson<T>(url: string, stage: string): Promise<T> {
  post({ type: 'progress', stage });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return (await response.json()) as T;
}

async function init(): Promise<void> {
  const started = performance.now();

  /*
    The model is served from this origin, not from a content delivery network.
    A cold kiosk that cannot reach the internet must still be able to search,
    and a citizen's query must not depend on a foreign host being reachable.
    The files are put in place by packages/indexer/src/vendor-model.mjs.
  */
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = '/models/';
  // ONNX Runtime fetches its WebAssembly from a CDN unless told otherwise.
  // Without this the model is local but inference still needs the internet.
  const wasm = env.backends?.onnx?.wasm;
  if (wasm === undefined) {
    throw new Error(
      'onnxruntime wasm backend is unavailable, cannot pin it to this origin',
    );
  }
  wasm.wasmPaths = '/ort/';

  manifest = await loadJson<IndexManifest>('/index/manifest.json', 'manifest');

  post({ type: 'progress', stage: 'vectors' });
  const vectorResponse = await fetch('/index/vectors.bin');
  if (!vectorResponse.ok)
    throw new Error(`vectors.bin responded ${vectorResponse.status}`);
  vectors = new Int8Array(await vectorResponse.arrayBuffer());

  const meta = await loadJson<RawChunkMeta[]>('/index/meta.json', 'metadata');
  const texts = await loadJson<string[]>('/index/text.json', 'text');
  lexical = await loadJson<LexicalIndex>('/index/lexical.json', 'lexical');

  post({ type: 'progress', stage: 'validating' });
  passages = meta.map((m, i) =>
    readChunk({
      chunkId: m.chunkId,
      pageId: m.pageId,
      workId: m.workId,
      corpus: m.corpus,
      locator: m.locator,
      language: m.language,
      speaker: m.speaker,
      text: texts[i] ?? '',
    }),
  );
  chunkIds = meta.map((m) => m.chunkId);

  const expected = manifest.count * manifest.dims;
  if (vectors.length !== expected) {
    throw new Error(`index mismatch: ${vectors.length} components, expected ${expected}`);
  }

  post({ type: 'progress', stage: 'model' });
  extractor = await loadExtractor('feature-extraction', manifest.model, {
    dtype: manifest.dtype,
  });

  post({ type: 'ready', manifest, loadMs: Math.round(performance.now() - started) });
}

/** Cosine over the quantised index. Stored and query vectors are both L2 normalised. */
function denseSearch(
  query: Float32Array,
  limit: number,
): { id: number; score: number }[] {
  if (vectors === null || manifest === null) return [];
  const { dims, count, quantisation } = manifest;
  const scale = quantisation.scale;
  const scored: { id: number; score: number }[] = [];

  for (let doc = 0; doc < count; doc++) {
    const base = doc * dims;
    let dot = 0;
    for (let d = 0; d < dims; d++) {
      dot += (vectors[base + d] as number) * (query[d] as number);
    }
    scored.push({ id: doc, score: dot / scale });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Character offsets of query terms, for highlighting the matched span. */
function findSpans(text: string, terms: readonly string[]): [number, number][] {
  if (terms.length === 0) return [];
  const spans: [number, number][] = [];
  const lower = text.toLowerCase();
  for (const term of new Set(terms)) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(term, from);
      if (at === -1) break;
      const before = at === 0 ? '' : (lower[at - 1] ?? '');
      const after = lower[at + term.length] ?? '';
      const boundary = !/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after);
      if (boundary) spans.push([at, at + term.length]);
      from = at + term.length;
      if (spans.length > 40) return spans;
    }
  }
  return spans.sort((a, b) => a[0] - b[0]);
}

async function search(query: string, limit: number): Promise<SearchResponse> {
  if (extractor === null || manifest === null || lexical === null) {
    throw new Error('worker is not ready');
  }
  const started = performance.now();

  // e5 wants the query prefix. The prefix used at build time is carried in the
  // manifest so the two can never drift apart.
  const embedStarted = performance.now();
  const output = await extractor([manifest.queryPrefix + query], {
    pooling: 'mean',
    normalize: true,
  });
  const embedMs = performance.now() - embedStarted;
  const vector = Float32Array.from(output.data as Float32Array);

  const dense = denseSearch(vector, DENSE_CANDIDATES);

  const terms = tokenise(query);
  const lexicalScores = scoreBm25(lexical, terms);
  const lexicalTop = [...lexicalScores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, LEXICAL_CANDIDATES);

  const fused = reciprocalRankFusion(dense, lexicalTop).slice(0, limit);

  const hits: SearchHit[] = fused.map((f) => {
    const passage = passages[f.id] as CitedPassage;
    return {
      chunkId: chunkIds[f.id] as string,
      passage,
      score: f.score,
      dense: f.dense,
      lexical: f.lexical,
      spans: findSpans(passage.text, terms),
    };
  });

  return {
    query,
    hits,
    tookMs: Math.round(performance.now() - started),
    embedMs: Math.round(embedMs),
  };
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  void (async () => {
    try {
      if (message.type === 'init') {
        await init();
      } else if (message.type === 'search') {
        const response = await search(message.query, message.limit ?? 10);
        post({ type: 'result', id: message.id, response });
      }
    } catch (error) {
      post({
        type: 'error',
        ...(message.type === 'search' ? { id: message.id } : {}),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});
