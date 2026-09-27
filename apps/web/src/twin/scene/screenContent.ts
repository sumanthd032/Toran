'use client';

/**
 * What each screen in the hall shows, from the archive itself. D-168.
 *
 * The screens were drawings: grey bars for text, three circles marked 1936,
 * 1948 and 1950. Seen from across the hall that was enough; walking up to a
 * kiosk it read as a mock-up. Now a Reading Room screen carries a real
 * passage with its volume and page, the Provenance kiosk a real chain from
 * the graph, the Timeline Wall real years, the AV kiosk a real film, the
 * Research Assistant a question it has answered, the Manuscript Station the
 * page it holds, and the curator's desk the fleet as Core reports it. Each
 * turns to its next item every so often, out of step with its neighbours.
 *
 * Every passage drawn here is cited through `citationParts`, the same words
 * the Citation element prints, because a screen in the hall is still a place
 * a claim appears. CLAUDE.md section 12.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  edgeStatus,
  readChunks,
  type CitedPassage,
  type RawChunk,
} from '@toran/contracts';
import { provenance, recordings, scans, timeline } from '@/archive/client';
import { citationParts } from '@/design/primitives';
import type { HallDevice } from '@/fleet/devices';
import { useFleet } from '@/fleet/FleetProvider';
import { useI18n, type MessageKey } from '@/i18n';

export type ScreenContent =
  | { readonly kind: 'passage'; readonly text: string; readonly cite: string }
  | { readonly kind: 'chain'; readonly nodes: readonly { title: string; year: string }[] }
  | { readonly kind: 'years'; readonly years: readonly string[]; readonly title: string }
  | { readonly kind: 'caption'; readonly heading: string; readonly sub: string }
  | { readonly kind: 'fleet'; readonly lines: readonly string[] };

interface Pool {
  readonly passages: readonly CitedPassage[];
  readonly chains: readonly { title: string; year: string }[][];
  readonly years: readonly { year: string; title: string }[];
  readonly films: readonly { title: string; sub: string }[];
  readonly pages: readonly { heading: string; sub: string }[];
  readonly questions: readonly string[];
}

const EMPTY: Pool = {
  passages: [],
  chains: [],
  years: [],
  films: [],
  pages: [],
  questions: [],
};

/** How long a screen holds one item. Long enough to read a passage from nearby. */
const TURN_MS = 18_000;

async function loadPool(eventTitle: (id: string) => string): Promise<Pool> {
  const [ambient, graph, line, films, pages, answers] = await Promise.all([
    fetch('/kiosk/ambient.json')
      .then((r) => (r.ok ? (r.json() as Promise<RawChunk[]>) : []))
      .then((rows) => readChunks(rows).passages)
      .catch(() => [] as CitedPassage[]),
    provenance().catch(() => null),
    timeline().catch(() => null),
    recordings().catch(() => []),
    scans().catch(() => []),
    fetch('/archive/assistant.json')
      .then((r) => (r.ok ? (r.json() as Promise<{ question?: unknown }[]>) : []))
      .catch(() => [] as { question?: unknown }[]),
  ]);

  // Three documents joined by confirmed links, read forward: a writing, the
  // draft it argued for, the Article it became.
  const chains: { title: string; year: string }[][] = [];
  if (graph !== null) {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const next = new Map<string, string>();
    for (const e of graph.edges)
      if (edgeStatus(e) === 'confirmed') next.set(e.from, e.to);
    for (const start of graph.nodes) {
      const ids = [start.id];
      while (ids.length < 3 && next.has(ids[ids.length - 1]!))
        ids.push(next.get(ids[ids.length - 1]!)!);
      if (ids.length === 3) {
        chains.push(
          ids.map((id) => {
            const n = byId.get(id)!;
            return { title: n.title, year: String(n.date.year) };
          }),
        );
      }
    }
  }

  const events = line?.events ?? [];
  return {
    passages: [...ambient, ...events.flatMap((e) => e.passages)].filter(
      (p) => p.text.length < 260,
    ),
    chains,
    years: events.map((e) => ({ year: String(e.date.year), title: eventTitle(e.id) })),
    films: films.map((f) => ({ title: f.title, sub: f.series ?? '' })),
    pages: pages.map((s) => ({ heading: s.heading, sub: s.title })),
    questions: answers.flatMap((a) =>
      typeof a.question === 'string' ? [a.question] : [],
    ),
  };
}

export function useScreenContent(): (
  device: HallDevice,
  index: number,
) => ScreenContent | null {
  const { t } = useI18n();
  const { health, drift, devices } = useFleet();
  const [pool, setPool] = useState<Pool>(EMPTY);
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    let live = true;
    void loadPool((id) => t(`timeline.event.${id}` as MessageKey)).then(
      (p) => live && setPool(p),
    );
    const timer = window.setInterval(() => setTurn((n) => n + 1), TURN_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
    // The pool is the archive's, and loads once; the language of event titles
    // is the hall's first, which is enough for a screen seen in passing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reporting = health.size;
  const simulated = [...health.values()].filter((h) => h.simulated).length;

  return useMemo(() => {
    const pick = <T>(xs: readonly T[], index: number): T | undefined =>
      xs.length === 0 ? undefined : xs[(turn + index * 5) % xs.length];

    return (device, index) => {
      switch (device.channel) {
        case 'reading':
        case 'audio': {
          const p = pick(pool.passages, index);
          if (p === undefined) return null;
          const { corpus, parts } = citationParts(p.citation, t);
          return {
            kind: 'passage',
            text: p.text,
            cite: `${corpus} · ${parts.join(', ')}`,
          };
        }
        case 'provenance': {
          const chain = pick(pool.chains, index);
          return chain === undefined ? null : { kind: 'chain', nodes: chain };
        }
        case 'timeline': {
          if (pool.years.length === 0) return null;
          const from = (turn + index * 3) % pool.years.length;
          const shown = Array.from(
            { length: 6 },
            (_, i) => pool.years[(from + i) % pool.years.length]!,
          );
          const sorted = [...new Set(shown.map((y) => y.year))].sort();
          return { kind: 'years', years: sorted, title: shown[0]!.title };
        }
        case 'av': {
          const f = pick(pool.films, index);
          return f === undefined
            ? null
            : { kind: 'caption', heading: f.title, sub: f.sub };
        }
        case 'manuscript': {
          const page = pick(pool.pages, index);
          return page === undefined
            ? null
            : { kind: 'caption', heading: page.heading, sub: page.sub };
        }
        case 'assistant': {
          const q = pick(pool.questions, index);
          return q === undefined
            ? null
            : { kind: 'caption', heading: q, sub: t('twin.screen.cited') };
        }
        case 'curator':
          return {
            kind: 'fleet',
            lines: [
              t('twin.screen.reporting', { count: reporting, total: devices.length }),
              t('twin.screen.simulated', { count: simulated }),
              t('twin.screen.drifting', { count: drift.size }),
            ],
          };
        default:
          return null;
      }
    };
  }, [pool, turn, t, reporting, simulated, drift.size, devices.length]);
}
