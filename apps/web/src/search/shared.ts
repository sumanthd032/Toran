'use client';

/**
 * One search engine per page.
 *
 * The model is 118 MB and takes seconds of CPU to become ready. Each kiosk
 * opened in the Twin creating its own would load it again every time, and
 * loading it while the camera flew in cost the flight a third of its frames.
 * It is created once, on first real use, and kept for the life of the page, so
 * every Reading Room after the first answers immediately.
 */

import { createSearchClient, type SearchClient } from './client';

let shared: SearchClient | null = null;

/** Whether the engine has been asked for yet. Asking is what starts the load. */
export const searchStarted = (): boolean => shared !== null;

export function sharedSearch(): SearchClient {
  if (shared === null) {
    shared = createSearchClient();
    const t = window.__toranTwin;
    if (t !== undefined) t.searchStarted = performance.now();
    shared.ready
      .then(() => {
        if (t !== undefined) t.searchReady = performance.now();
      })
      .catch(() => undefined);
  }
  return shared;
}
