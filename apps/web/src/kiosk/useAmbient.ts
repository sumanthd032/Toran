'use client';

/**
 * The curated attract loop passages, read through the same contract as
 * search results. A passage that cannot produce a citation is never shown.
 */

import { useEffect, useState } from 'react';
import { readChunks, type CitedPassage, type RawChunk } from '@toran/contracts';

export function useAmbient(): readonly CitedPassage[] {
  const [passages, setPassages] = useState<readonly CitedPassage[]>([]);
  useEffect(() => {
    let live = true;
    fetch('/kiosk/ambient.json')
      .then((r) => (r.ok ? (r.json() as Promise<RawChunk[]>) : []))
      .then((rows) => {
        if (live) setPassages(readChunks(rows).passages);
      })
      .catch(() => {
        // No passages means the attract loop shows the channel alone. It does not fail.
      });
    return () => {
      live = false;
    };
  }, []);
  return passages;
}
