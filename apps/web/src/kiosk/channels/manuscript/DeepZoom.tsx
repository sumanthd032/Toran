'use client';

/**
 * Deep zoom into a scanned page, OpenSeadragon over the static IIIF tiles
 * build-iiif.mjs writes. Nothing here reaches the network: every tile is a
 * file in the bundle on the device.
 *
 * The published info.json carries an absolute identifier, as the IIIF
 * specification requires. A kiosk may be serving those same bytes from any
 * origin, and offline, so the identifier is rewritten to this origin as the
 * viewer loads it. The tiles are unchanged; only the address is local.
 *
 * The boxes the machine drew are registered with the viewer rather than
 * painted over it, so they stay on their words through a pan and a pinch. An
 * overlay drawn in the stage's own coordinates lines up only until the first
 * gesture, which is worse than none.
 */

import { useEffect, useRef, useState } from 'react';
import type { Scan } from '@toran/contracts';
import { useI18n } from '@/i18n';
import styles from './manuscript.module.css';

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DeepZoomProps {
  readonly scan: Scan;
  /** Boxes drawn over the page, the machine's regions. */
  readonly regions: readonly { id: string; box: Box; heat: string }[];
  readonly selected: string | null;
  /** True while the visitor is reading the transcription rather than the page. */
  readonly dim: boolean;
  /** A long press on the page asks what is written there. */
  readonly onAsk: (x: number, y: number) => void;
  readonly onReady: (ok: boolean) => void;
}

/** The part of OpenSeadragon this file uses. Its own types do not cover it. */
interface OsdViewer {
  destroy: () => void;
  addHandler: (event: string, handler: () => void) => void;
  isOpen: () => boolean;
  clearOverlays: () => void;
  addOverlay: (options: { element: HTMLElement; location: unknown }) => void;
}

const LONG_PRESS_MS = 550;
/** A press that travels this far is a drag, not a question. */
const SLOP = 12;

export function DeepZoom({
  scan,
  regions,
  selected,
  dim,
  onAsk,
  onReady,
}: DeepZoomProps) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<OsdViewer | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const makeRect = useRef<
    ((x: number, y: number, w: number, h: number) => unknown) | null
  >(null);
  const ask = useRef(onAsk);
  ask.current = onAsk;

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    let live = true;
    let instance: { destroy: () => void } | null = null;

    void (async () => {
      const OpenSeadragon = (await import('openseadragon')).default;
      const response = await fetch(`/iiif/${scan.id}/info.json`);
      if (!response.ok) {
        if (live) {
          setFailed(true);
          onReady(false);
        }
        return;
      }
      const info = (await response.json()) as { id: string };
      if (!live) return;
      const created = OpenSeadragon({
        element,
        // Every control is in the reach zone, drawn by the station.
        showNavigationControl: false,
        showNavigator: false,
        // Every flag stated. A partial gesture object loses the defaults it
        // leaves out, and the one that matters here is pinch to zoom.
        gestureSettingsTouch: {
          dragToPan: true,
          pinchToZoom: true,
          pinchRotate: false,
          flickEnabled: true,
          dblClickToZoom: true,
          clickToZoom: false,
          scrollToZoom: false,
        },
        gestureSettingsMouse: {
          dragToPan: true,
          scrollToZoom: true,
          clickToZoom: false,
          dblClickToZoom: true,
          pinchToZoom: false,
          flickEnabled: false,
          pinchRotate: false,
        },
        animationTime: 0.6,
        springStiffness: 5,
        visibilityRatio: 0.9,
        minZoomImageRatio: 0.8,
        maxZoomPixelRatio: 2.5,
        preserveViewport: false,
        // OpenSeadragon's types do not describe a IIIF info.json passed as
        // an object, which is how the identifier is made local.
        tileSources: [
          { ...info, id: `${window.location.origin}/iiif/${scan.id}` },
        ] as never,
      }) as unknown as OsdViewer;
      instance = created;
      viewer.current = created;
      makeRect.current = (x, y, w, h) => new OpenSeadragon.Rect(x, y, w, h);
      const opened = () => {
        if (!live) return;
        setReady(true);
        onReady(true);
      };
      created.addHandler('open', opened);
      // The tile source is an object, not a URL, so there is nothing to
      // fetch and the viewer can already be open by the time this runs.
      if (created.isOpen()) opened();
      created.addHandler('open-failed', () => {
        if (live) {
          setFailed(true);
          onReady(false);
        }
      });
    })();

    return () => {
      live = false;
      setReady(false);
      // Cleared first, so the overlay effect's own cleanup, which runs after
      // this one, knows the viewer is gone and does not reach into it.
      viewer.current = null;
      try {
        instance?.destroy();
      } catch {
        // The viewer's teardown must not take the hall down with it. A throw
        // here used to break React's unmount and leave the Twin without its
        // interface after a visit to this device.
      }
    };
    // The viewer is built once per page. Callbacks are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan.id]);

  // A long press asks what is written under the finger. A drag is a drag.
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    let timer = 0;
    let start: { x: number; y: number } | null = null;

    const down = (event: PointerEvent) => {
      start = { x: event.clientX, y: event.clientY };
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      timer = window.setTimeout(() => {
        timer = 0;
        ask.current(px, py);
      }, LONG_PRESS_MS);
    };
    const move = (event: PointerEvent) => {
      if (start === null) return;
      if (
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP &&
        timer !== 0
      ) {
        window.clearTimeout(timer);
        timer = 0;
      }
    };
    const up = () => {
      if (timer !== 0) window.clearTimeout(timer);
      timer = 0;
      start = null;
    };

    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    return () => {
      if (timer !== 0) window.clearTimeout(timer);
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
    };
  }, []);

  // The boxes, registered with the viewer so a pan or a pinch carries them.
  // Nothing here takes a touch: a box that did would swallow the gesture
  // meant for the page under it.
  useEffect(() => {
    const created = viewer.current;
    const rectOf = makeRect.current;
    if (created === null || rectOf === null || !ready) return;
    created.clearOverlays();
    for (const region of regions) {
      const element = document.createElement('div');
      element.className = styles.box ?? '';
      element.dataset['heat'] = region.heat;
      if (region.id === selected) element.dataset['selected'] = 'true';
      element.setAttribute('aria-hidden', 'true');
      created.addOverlay({
        element,
        location: rectOf(region.box.x, region.box.y, region.box.width, region.box.height),
      });
    }
    return () => {
      // Only while the viewer is still the live one. On unmount the effect
      // above has already destroyed it and cleared the ref.
      if (viewer.current === created) created.clearOverlays();
    };
    // The boxes are rebuilt only when the page's regions or the selection
    // change, never on an unrelated render.
  }, [regions, selected, ready]);

  if (failed) {
    return (
      <div className={styles.stage} data-testid="manuscript-stage">
        <p className={styles.status}>{t('manuscript.failed')}</p>
      </div>
    );
  }

  return (
    <div
      className={styles.stage}
      data-testid="manuscript-stage"
      data-dim={dim || undefined}
    >
      <div ref={host} className={styles.canvas} data-testid="manuscript-canvas" />
      {/* The boxes the machine drew, over the page, in the page's own
          proportions. Nothing here takes a touch: a box that did would
          swallow the pinch that was meant for the page under it. A region is
          chosen from the transcription, and a long press asks the page
          itself. */}
      <svg
        className={styles.boxes}
        viewBox={`0 0 ${scan.width} ${scan.height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {regions.map((region) => (
          <rect
            key={region.id}
            className={styles.box}
            data-heat={region.heat}
            data-selected={region.id === selected || undefined}
            x={region.box.x * scan.width}
            y={region.box.y * scan.width}
            width={region.box.width * scan.width}
            height={region.box.height * scan.width}
          />
        ))}
      </svg>
    </div>
  );
}
