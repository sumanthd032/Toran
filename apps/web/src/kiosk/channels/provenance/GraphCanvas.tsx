'use client';

/**
 * The graph itself: links drawn in SVG, documents as buttons over them.
 *
 * A document is a real button at its full touch size however far the graph is
 * spread: spreading moves documents apart and never shrinks them, because a
 * 30 mm target that shrank with a pinch would stop being one. A graph wider
 * than the screen is dragged sideways. Every link takes its look from
 * edgeLook, set as SVG attributes, and no style rule here touches a dash.
 */

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { ProvenanceGraph } from '@toran/contracts';
import { useTouchFeedback } from '@/design/feedback/useTouchFeedback';
import { useI18n } from '@/i18n';
import { formatYear } from '../timeline/model';
import { edgeLook, type Layout } from './model';
import { nodeTitle } from './names';
import styles from './provenance.module.css';

export interface GraphCanvasProps {
  readonly graph: ProvenanceGraph;
  readonly layout: Layout;
  /** The document whose links are shown. */
  readonly selected: string | null;
  /** Links a walk has passed along, and the one it is on. */
  readonly walked: ReadonlySet<string>;
  readonly current: string | null;
  /** Documents to keep in view: the selection, or the walk's latest hop. */
  readonly focus: readonly string[];
  /** 1 to 2: how far apart documents are set. */
  readonly spread: number;
  readonly onSpread: (spread: number) => void;
  readonly onSelect: (id: string) => void;
}

const GAP_X = 1.3;
const GAP_Y = 1.18;
const AXIS = 44;
const DRAG = 8;

export function GraphCanvas({
  graph,
  layout,
  selected,
  walked,
  current,
  focus,
  spread,
  onSpread,
  onSelect,
}: GraphCanvasProps) {
  const { t, lang } = useI18n();
  const feedback = useTouchFeedback('light');
  const box = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, nodeW: 0, nodeH: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number; moved: boolean }>());
  const grab = useRef<{
    id: number;
    x: number;
    y: number;
    pan: { x: number; y: number };
  } | null>(null);
  const pinch = useRef<{ distance: number; spread: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    const node = probe.current;
    if (el === null || node === null) return;
    const measure = () => {
      const r = node.getBoundingClientRect();
      setSize({ w: el.clientWidth, h: el.clientHeight, nodeW: r.width, nodeH: r.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const colW = size.nodeW * GAP_X * spread;
  const rowH = size.nodeH * GAP_Y * spread;
  const contentW = layout.years.length * colW;
  const contentH = AXIS + layout.rows * rowH;

  const clamp = (p: { x: number; y: number }) => {
    const fit = (content: number, view: number, v: number) =>
      content <= view ? (view - content) / 2 : Math.min(0, Math.max(view - content, v));
    return { x: fit(contentW, size.w, p.x), y: fit(contentH, size.h, p.y) };
  };

  const at = (id: string) => {
    const p = layout.placed.get(id)!;
    return {
      x: pan.x + p.column * colW + colW / 2,
      y: pan.y + AXIS + p.row * rowH + rowH / 2,
    };
  };

  // Keep what matters in view: the selection and its neighbours, or the
  // walk's newest hop. Otherwise stay where the visitor put the graph.
  const focusKey = focus.join(' ');
  useEffect(() => {
    if (size.w === 0) return;
    if (focus.length === 0) {
      // A graph taller than the stage opens on its middle rows, not its top
      // edge, and on its latest years, which is where a walk back begins.
      setPan((p) =>
        clamp(
          p.x === 0 && p.y === 0
            ? { x: size.w - contentW, y: (size.h - contentH) / 2 }
            : p,
        ),
      );
      return;
    }
    const xs = focus.map((id) => layout.placed.get(id)!.column * colW + colW / 2);
    const ys = focus.map((id) => AXIS + layout.placed.get(id)!.row * rowH + rowH / 2);
    // The whole of what matters if it fits, else centred on the first of it.
    const fits = Math.max(...xs) - Math.min(...xs) + colW <= size.w;
    const cx = fits ? (Math.min(...xs) + Math.max(...xs)) / 2 : xs[0]!;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    setPan(clamp({ x: size.w / 2 - cx, y: size.h / 2 - cy }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, size.w, size.h, colW, rowH]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), spread };
      grab.current = null;
      return;
    }
    if ((e.target as HTMLElement).closest('[data-node]') !== null) return;
    grab.current = { id: e.pointerId, x: e.clientX, y: e.clientY, pan };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = pointers.current.get(e.pointerId);
    if (p === undefined) return;
    pointers.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      moved: p.moved || Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG,
    });
    if (pinch.current !== null && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      onSpread(
        Math.min(2, Math.max(1, (pinch.current.spread * d) / pinch.current.distance)),
      );
      return;
    }
    const g = grab.current;
    if (g === null || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!dragging && Math.hypot(dx, dy) > DRAG) setDragging(true);
    setPan(clamp({ x: g.pan.x + dx, y: g.pan.y + dy }));
  };

  const release = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (grab.current?.id === e.pointerId) {
      grab.current = null;
      setDragging(false);
    }
  };

  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const touching = (id: string) =>
    selected !== null &&
    graph.edges.some((e) => e.id === id && (e.from === selected || e.to === selected));
  const ready = size.nodeW > 0;
  const first = layout.years[0] ?? 0;
  const last = layout.years[layout.years.length - 1] ?? 0;

  return (
    <div
      ref={box}
      className={styles.canvas}
      data-dragging={dragging || undefined}
      data-testid="provenance-canvas"
      role="group"
      aria-label={t('provenance.graph', {
        first: formatYear(first, lang),
        last: formatYear(last, lang),
      })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span ref={probe} className={`${styles.node} ${styles.probe}`} aria-hidden="true">
        <span className={styles.nodeTitle}>{t('provenance.title.rtc-1930')}</span>
        <span className={styles.nodeYear}>1930</span>
      </span>
      {ready && (
        <>
          <svg className={styles.links} width={size.w} height={size.h} aria-hidden="true">
            <defs>
              {(['confirmed', 'candidate'] as const).map((status) => (
                <marker
                  key={status}
                  id={`arrow-${status}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M0 0L10 5L0 10z"
                    className={styles.arrow}
                    data-status={status}
                  />
                </marker>
              ))}
            </defs>
            {graph.edges.map((e) => {
              const look = edgeLook(e);
              const a = at(e.from);
              const b = at(e.to);
              const x1 = a.x + size.nodeW / 2;
              const x2 = b.x - size.nodeW / 2 - 6;
              const bend = Math.max(40, (x2 - x1) / 2);
              return (
                <path
                  key={e.id}
                  d={`M${x1} ${a.y} C${x1 + bend} ${a.y} ${x2 - bend} ${b.y} ${x2} ${b.y}`}
                  className={styles.link}
                  data-edge={e.id}
                  data-status={look.status}
                  data-active={touching(e.id) || undefined}
                  data-dim={
                    selected !== null && !touching(e.id) && !walked.has(e.id)
                      ? true
                      : undefined
                  }
                  data-walked={walked.has(e.id) || undefined}
                  data-current={current === e.id || undefined}
                  strokeDasharray={look.dash ?? undefined}
                  markerEnd={`url(#arrow-${look.status})`}
                />
              );
            })}
          </svg>
          {/* The years stay at the top of the stage however the graph is
              dragged, so a column never loses its date. */}
          {layout.years.map((year, i) => (
            <span
              key={year}
              className={styles.year}
              style={{ left: pan.x + i * colW + colW / 2, top: 6 }}
              aria-hidden="true"
            >
              {formatYear(year, lang)}
            </span>
          ))}
          {graph.nodes.map((n) => {
            const p = at(n.id);
            const walkedTo = [...walked].some(
              (id) => graph.edges.find((e) => e.id === id)?.from === n.id,
            );
            return (
              <button
                key={n.id}
                type="button"
                className={styles.node}
                data-node={n.id}
                data-kind={n.kind}
                data-walked={walkedTo || undefined}
                aria-pressed={selected === n.id}
                style={{ left: p.x - size.nodeW / 2, top: p.y - size.nodeH / 2 }}
                onPointerDown={feedback}
                onClick={() => onSelect(n.id)}
              >
                <span className={styles.nodeTitle}>{nodeTitle(nodes.get(n.id)!, t)}</span>
                <span className={styles.nodeYear}>{formatYear(n.date.year, lang)}</span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
