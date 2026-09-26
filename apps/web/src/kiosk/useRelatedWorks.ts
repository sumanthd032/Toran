'use client';

/**
 * The works a drift reaches: the one being read nearby and the works the
 * Provenance Graph's confirmed links tie to it, nearest first. Null while
 * nothing nearby is being read. Shared by the attract loop and the Timeline
 * Wall, which has a loop of its own, so both drift by the same rule.
 *
 * Only confirmed links count, because a drift is a claim that two works
 * belong together, and CLAUDE.md section 12 does not let an unconfirmed link
 * be presented as established anywhere. D-155.
 */

import { useEffect, useState } from 'react';
import { edgeStatus, relatedWorks, type WorkLink } from '@toran/contracts';
import { provenance } from '@/archive/client';

async function confirmedLinks(): Promise<readonly WorkLink[]> {
  try {
    const g = await provenance();
    const workOf = new Map(g.nodes.map((n) => [n.id, n.anchor[0].citation.workId]));
    return g.edges.flatMap((e) => {
      const from = workOf.get(e.from);
      const to = workOf.get(e.to);
      return edgeStatus(e) === 'confirmed' &&
        from !== undefined &&
        to !== undefined &&
        from !== to
        ? [{ from, to }]
        : [];
    });
  } catch {
    // No graph means the drift reaches the work itself and no further.
    return [];
  }
}

export function useRelatedWorks(drift: string | null): readonly string[] | null {
  const [links, setLinks] = useState<readonly WorkLink[] | null>(null);
  useEffect(() => {
    if (drift === null || links !== null) return;
    let live = true;
    void confirmedLinks().then((found) => {
      if (live) setLinks(found);
    });
    return () => {
      live = false;
    };
  }, [drift, links]);
  if (drift === null) return null;
  return relatedWorks(drift, links ?? []);
}
