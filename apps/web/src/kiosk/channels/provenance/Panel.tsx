'use client';

/**
 * Beside the graph: what is selected, in words, with its sources.
 *
 * With nothing selected it says what the lines mean. A document shows its own
 * words, cited, and its links. A link shows how it was proposed, whether a
 * named curator has confirmed it, and its evidence in full, every passage at
 * its volume and page. A walk shows the step it is on.
 */

import {
  edgeStatus,
  type ProvenanceEdge,
  type ProvenanceGraph,
  type ProvenanceNode,
} from '@toran/contracts';
import { Badge, Button, Citation } from '@/design/primitives';
import { useI18n } from '@/i18n';
import { formatDate } from '../timeline/model';
import type { Hop } from './model';
import { nodeTitle } from './names';
import styles from './provenance.module.css';

export type PanelView =
  | { readonly kind: 'overview' }
  | { readonly kind: 'node'; readonly id: string }
  | { readonly kind: 'edge'; readonly id: string; readonly from: string }
  | { readonly kind: 'walk'; readonly start: string; readonly step: number };

function useSentence(graph: ProvenanceGraph) {
  const { t } = useI18n();
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return (e: ProvenanceEdge) =>
    t(`provenance.edge.${e.assertion}`, {
      from: nodeTitle(byId.get(e.from)!, t),
      to: nodeTitle(byId.get(e.to)!, t),
    });
}

function Status({ edge }: { edge: ProvenanceEdge }) {
  const { t } = useI18n();
  return edgeStatus(edge) === 'confirmed' ? (
    <Badge tone="confirmed">{t('provenance.confirmed')}</Badge>
  ) : (
    <Badge tone="unconfirmed">{t('provenance.unconfirmed')}</Badge>
  );
}

function Passages({ passages }: { passages: ProvenanceNode['anchor'] }) {
  return (
    <>
      {passages.map((p, i) => (
        <blockquote key={i} className={styles.passage} lang={p.language}>
          <p>{p.text}</p>
          {p.speaker !== null && <span className={styles.speaker}>{p.speaker}</span>}
          <Citation citation={p.citation} block />
        </blockquote>
      ))}
    </>
  );
}

function EdgeDetail({ graph, edge }: { graph: ProvenanceGraph; edge: ProvenanceEdge }) {
  const { t, lang } = useI18n();
  const sentence = useSentence(graph);
  const c = edge.confirmation;
  return (
    <div className={styles.detail} data-testid="provenance-evidence" data-edge={edge.id}>
      <p className={styles.sentence}>{sentence(edge)}</p>
      <Status edge={edge} />
      <p className={styles.method}>
        {edge.method === 'semantic'
          ? t('provenance.method.semantic', { score: (edge.score ?? 0).toFixed(3) })
          : t(`provenance.method.${edge.method}`)}
        {edge.assertedBy !== null && (
          <>
            {' '}
            <span className={styles.source}>
              {t('provenance.assertedBy', { source: edge.assertedBy })}
            </span>
          </>
        )}
      </p>
      <p className={styles.method}>
        {c !== null && c.decision === 'confirmed'
          ? t('provenance.confirmedBy', {
              by: c.by,
              date: formatDate(
                {
                  year: Number(c.at.slice(0, 4)),
                  month: Number(c.at.slice(5, 7)),
                  day: Number(c.at.slice(8, 10)),
                },
                lang,
              ),
            })
          : t('provenance.awaiting')}
      </p>
      <h4 className={styles.heading}>{t('provenance.evidence')}</h4>
      <Passages passages={edge.evidence} />
    </div>
  );
}

export interface PanelProps {
  readonly graph: ProvenanceGraph;
  readonly view: PanelView;
  readonly hops: readonly Hop[];
  readonly onOpenEdge: (edgeId: string, from: string) => void;
}

export function Panel({ graph, view, hops, onOpenEdge }: PanelProps) {
  const { t, lang } = useI18n();
  const sentence = useSentence(graph);

  if (view.kind === 'overview') {
    const confirmed = graph.edges.filter((e) => edgeStatus(e) === 'confirmed').length;
    return (
      <aside className={styles.bar} data-testid="provenance-panel" data-view="overview">
        <p className={styles.hint}>{t('provenance.hint')}</p>
        <ul className={styles.legend}>
          {(['writing', 'draft', 'article', 'act'] as const).map((kind) => (
            <li key={kind}>
              <span className={styles.swatch} data-kind={kind} aria-hidden="true" />
              {t(`provenance.kind.${kind}`)}
            </li>
          ))}
          <li>
            <svg viewBox="0 0 48 8" aria-hidden="true" className={styles.sample}>
              <line
                x1="0"
                y1="4"
                x2="48"
                y2="4"
                className={styles.link}
                data-status="confirmed"
              />
            </svg>
            {t('provenance.legend.confirmed')}
          </li>
          <li>
            <svg viewBox="0 0 48 8" aria-hidden="true" className={styles.sample}>
              <line
                x1="0"
                y1="4"
                x2="48"
                y2="4"
                className={styles.link}
                data-status="candidate"
                strokeDasharray="7 6"
              />
            </svg>
            {t('provenance.legend.candidate')}
          </li>
        </ul>
        <p className={styles.count}>
          {t('provenance.count', {
            nodes: graph.nodes.length,
            edges: graph.edges.length,
            confirmed,
          })}
        </p>
      </aside>
    );
  }

  if (view.kind === 'edge') {
    const edge = graph.edges.find((e) => e.id === view.id);
    return (
      <aside className={styles.panel} data-testid="provenance-panel" data-view="edge">
        {edge !== undefined && <EdgeDetail graph={graph} edge={edge} />}
      </aside>
    );
  }

  if (view.kind === 'walk') {
    const hop = view.step > 0 ? hops[view.step - 1] : undefined;
    const start = graph.nodes.find((n) => n.id === view.start)!;
    return (
      <aside
        className={styles.panel}
        data-testid="provenance-panel"
        data-view="walk"
        data-step={view.step}
      >
        <p className={styles.step}>
          {t('provenance.walk.step', { step: view.step, steps: hops.length })}
        </p>
        {hop === undefined ? (
          <div className={styles.detail}>
            <p className={styles.kind}>{t(`provenance.kind.${start.kind}`)}</p>
            <h3 className={styles.title}>{nodeTitle(start, t)}</h3>
            <p className={styles.date}>{formatDate(start.date, lang)}</p>
            <Passages passages={start.anchor} />
          </div>
        ) : (
          <EdgeDetail graph={graph} edge={hop.edge} />
        )}
      </aside>
    );
  }

  const node = graph.nodes.find((n) => n.id === view.id);
  if (node === undefined) return null;
  const links = graph.edges
    .filter((e) => e.from === node.id || e.to === node.id)
    .sort(
      (a, b) =>
        (a.to === node.id ? 0 : 1) - (b.to === node.id ? 0 : 1) ||
        a.id.localeCompare(b.id),
    );
  return (
    <aside
      className={styles.panel}
      data-testid="provenance-panel"
      data-view="node"
      data-node={node.id}
    >
      <div className={styles.detail}>
        <p className={styles.kind}>{t(`provenance.kind.${node.kind}`)}</p>
        <h3 className={styles.title}>{nodeTitle(node, t)}</h3>
        <p className={styles.date}>{formatDate(node.date, lang)}</p>
        <Passages passages={node.anchor} />
        <h4 className={styles.heading}>{t('provenance.links')}</h4>
        <ul className={styles.links_}>
          {links.map((e) => (
            <li key={e.id}>
              <Button
                variant="secondary"
                className={styles.linkButton}
                onClick={() => onOpenEdge(e.id, node.id)}
                data-testid="provenance-link"
                data-edge={e.id}
              >
                <span className={styles.linkText}>
                  <span>{sentence(e)}</span>
                  <Status edge={e} />
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
