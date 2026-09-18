'use client';

/**
 * Main thread interface to the search worker.
 *
 * Search runs off the main thread because embedding a query is tens of
 * milliseconds of compute and a kiosk must never drop a frame while someone
 * is typing.
 */

import type {
  IndexManifest,
  SearchResponse,
  WorkerRequest,
  WorkerResponse,
} from './types';

export interface SearchClient {
  ready: Promise<IndexManifest>;
  search: (query: string, limit?: number) => Promise<SearchResponse>;
  onProgress: (listener: (stage: string) => void) => () => void;
  dispose: () => void;
}

export function createSearchClient(): SearchClient {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (r: SearchResponse) => void; reject: (e: Error) => void }
  >();
  const progressListeners = new Set<(stage: string) => void>();

  let resolveReady!: (m: IndexManifest) => void;
  let rejectReady!: (e: Error) => void;
  const ready = new Promise<IndexManifest>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    switch (message.type) {
      case 'ready':
        resolveReady(message.manifest);
        break;
      case 'progress':
        for (const listener of progressListeners) listener(message.stage);
        break;
      case 'result': {
        pending.get(message.id)?.resolve(message.response);
        pending.delete(message.id);
        break;
      }
      case 'error': {
        const error = new Error(message.message);
        if (message.id === undefined) {
          rejectReady(error);
        } else {
          pending.get(message.id)?.reject(error);
          pending.delete(message.id);
        }
        break;
      }
    }
  });

  const send = (request: WorkerRequest) => worker.postMessage(request);
  send({ type: 'init' });

  return {
    ready,
    search(query, limit = 10) {
      const id = nextId++;
      return new Promise<SearchResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ type: 'search', id, query, limit });
      });
    },
    onProgress(listener) {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
    dispose() {
      worker.terminate();
      pending.clear();
      progressListeners.clear();
    },
  };
}
