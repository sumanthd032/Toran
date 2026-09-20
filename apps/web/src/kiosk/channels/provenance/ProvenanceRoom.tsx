'use client';

/**
 * The Provenance Graph, device 3. PROJECT.md 7.2, D-006.
 *
 * Writings, the draft articles the Constituent Assembly adopted, the articles
 * they became and a later Act, set left to right in time, with the links
 * between them. Touch a document to see its own words and its links; touch a
 * link to read its evidence at volume and page. Walk back from any document
 * and the graph steps backward through time along the links the records and
 * readings support, one hop every few seconds.
 *
 * A link nobody has confirmed is dashed, and nothing on this screen can make
 * it otherwise: its look comes from edgeLook alone, and the only way to
 * confirm a link is the curator's queue, not a button here.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ProvenanceGraph } from '@toran/contracts';
import { provenance } from '@/archive/client';
import { Button } from '@/design/primitives';
import { useI18n } from '@/i18n';
import { ICON, Icon } from '../../icons';
import { useChannelNav } from '../../nav';
import { ReachTools } from '../../reach';
import { GraphCanvas } from './GraphCanvas';
import { layout, walkBack } from './model';
import { Panel, type PanelView } from './Panel';
import styles from './provenance.module.css';

/** How long a walk holds each hop, long enough to read the sentence and see the line. */
export const WALK_STEP_MS = 3200;
const SPREAD_STEP = 0.25;

export function ProvenanceRoom() {
  const { t } = useI18n();
  const [graph, setGraph] = useState<ProvenanceGraph | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<PanelView>({ kind: 'overview' });
  const [spread, setSpread] = useState(1);

  useEffect(() => {
    let current = true;
    provenance().then(
      (g) => current && setGraph(g),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, []);

  const placed = useMemo(() => (graph === null ? null : layout(graph)), [graph]);
  const selected =
    view.kind === 'node'
      ? view.id
      : view.kind === 'edge'
        ? view.from
        : view.kind === 'walk'
          ? view.start
          : null;
  const hops = useMemo(
    () => (graph === null || selected === null ? [] : walkBack(graph, selected)),
    [graph, selected],
  );

  // The walk steps on by itself; Stop, Back or Home ends it.
  useEffect(() => {
    if (view.kind !== 'walk' || view.step >= hops.length) return;
    const id = window.setTimeout(
      () => setView({ ...view, step: view.step + 1 }),
      view.step === 0 ? WALK_STEP_MS / 2 : WALK_STEP_MS,
    );
    return () => window.clearTimeout(id);
  }, [view, hops.length]);

  useChannelNav({
    back: () => {
      if (view.kind === 'edge') setView({ kind: 'node', id: view.from });
      else if (view.kind === 'walk') setView({ kind: 'node', id: view.start });
      else if (view.kind === 'node') setView({ kind: 'overview' });
      else return false;
      return true;
    },
    home: () => {
      setView({ kind: 'overview' });
      setSpread(1);
    },
    forward: () => false,
    canForward: false,
  });

  if (failed) return <p className={styles.status}>{t('provenance.failed')}</p>;
  if (graph === null || placed === null) {
    return (
      <p className={styles.status} aria-busy="true">
        {t('provenance.loading')}
      </p>
    );
  }

  const walking = view.kind === 'walk';
  const walked = new Set(walking ? hops.slice(0, view.step).map((h) => h.edge.id) : []);
  const current =
    walking && view.step > 0 ? (hops[view.step - 1]?.edge.id ?? null) : null;
  const focus =
    walking && view.step > 0
      ? [hops[view.step - 1]!.node.id, hops[view.step - 1]!.edge.to]
      : selected === null
        ? []
        : [
            selected,
            ...graph.edges.flatMap((e) =>
              e.from === selected ? [e.to] : e.to === selected ? [e.from] : [],
            ),
          ];

  return (
    <div className={styles.room} data-testid="provenance" data-view={view.kind}>
      <GraphCanvas
        graph={graph}
        layout={placed}
        selected={selected}
        walked={walked}
        current={current}
        focus={focus}
        spread={spread}
        onSpread={setSpread}
        onSelect={(id) => setView({ kind: 'node', id })}
      />
      <Panel
        graph={graph}
        view={view}
        hops={hops}
        onOpenEdge={(id, from) => setView({ kind: 'edge', id, from })}
      />
      <ReachTools>
        <Button
          variant={walking ? 'primary' : 'secondary'}
          icon={<Icon d={ICON.walk} />}
          disabled={selected === null || hops.length === 0}
          aria-pressed={walking}
          onClick={() =>
            selected !== null &&
            setView(
              walking
                ? { kind: 'node', id: selected }
                : { kind: 'walk', start: selected, step: 0 },
            )
          }
          data-testid="provenance-walk"
        >
          <span className={styles.label}>
            {walking ? t('provenance.walk.stop') : t('provenance.walk')}
          </span>
        </Button>
        <Button
          variant="secondary"
          icon={<Icon d={ICON.gather} />}
          aria-label={t('provenance.zoomOut')}
          disabled={spread <= 1}
          onClick={() => setSpread((s) => Math.max(1, s - SPREAD_STEP))}
          data-testid="provenance-gather"
        />
        <Button
          variant="secondary"
          icon={<Icon d={ICON.spread} />}
          aria-label={t('provenance.zoomIn')}
          disabled={spread >= 2}
          onClick={() => setSpread((s) => Math.min(2, s + SPREAD_STEP))}
          data-testid="provenance-spread"
        />
      </ReachTools>
    </div>
  );
}
