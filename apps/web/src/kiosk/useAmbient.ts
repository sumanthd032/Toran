'use client';

/**
 * The attract loop passages, read through the same contract as search
 * results. A passage that cannot produce a citation is never shown.
 *
 * When Core says a work is being read at a device nearby, the loop drifts:
 * it shows the passages of the works that drift reaches, drawn from the
 * attract loop and the Timeline Wall, and says that it is doing so. With
 * nothing related to show it keeps its own loop. D-155.
 */

import { useEffect, useState } from 'react';
import {
  driftPassages,
  readChunks,
  type CitedPassage,
  type RawChunk,
} from '@toran/contracts';
import { timeline } from '@/archive/client';
import { useRelatedWorks } from './useRelatedWorks';

export function useAmbient(drift: string | null = null): {
  readonly passages: readonly CitedPassage[];
  /** True when the loop is showing what is being read nearby. */
  readonly nearby: boolean;
} {
  const [own, setOwn] = useState<readonly CitedPassage[]>([]);
  const [wider, setWider] = useState<readonly CitedPassage[] | null>(null);
  const related = useRelatedWorks(drift);

  useEffect(() => {
    let live = true;
    fetch('/kiosk/ambient.json')
      .then((r) => (r.ok ? (r.json() as Promise<RawChunk[]>) : []))
      .then((rows) => {
        if (live) setOwn(readChunks(rows).passages);
      })
      .catch(() => {
        // No passages means the attract loop shows the channel alone. It does not fail.
      });
    return () => {
      live = false;
    };
  }, []);

  // The Timeline Wall's passages widen the pool, fetched only once something
  // nearby is being read.
  useEffect(() => {
    if (drift === null || wider !== null) return;
    let live = true;
    timeline().then(
      (t) => live && setWider(t.events.flatMap((e) => e.passages)),
      () => live && setWider([]),
    );
    return () => {
      live = false;
    };
  }, [drift, wider]);

  if (related === null) return { passages: own, nearby: false };
  const picked = driftPassages([...own, ...(wider ?? [])], related);
  return picked.length === 0
    ? { passages: own, nearby: false }
    : { passages: picked, nearby: true };
}
