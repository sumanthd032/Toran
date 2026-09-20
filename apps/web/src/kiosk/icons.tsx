/**
 * The kiosk's icons. Every primary action must be understood from its icon
 * alone (CLAUDE.md section 10), so each is a plain drawing of the thing: a page
 * turning, a card, a ribbon marking a page. Stroked, not filled, to sit with
 * the hairline rules of the paper theme.
 */

import styles from './kiosk.module.css';

export function Icon({ d, className }: { d: string; className?: string | undefined }) {
  return (
    <svg
      className={className ?? styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export const ICON = {
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  home: 'M4 11l8-7 8 7M6 10v10h12V10',
  language:
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  card: 'M3 6h18v12H3zM6 10h4v3H6zM13 14h5',
  keep: 'M6 3h12v18l-6-4-6 4z',
  dossier: 'M8 3h11v15H8zM5 6v15h11',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2h-2z',
  pagePrev: 'M11 4h9v16h-9M15 12H4M7 9l-3 3 3 3',
  pageNext: 'M13 4H4v16h9M9 12h11M17 9l3 3-3 3',
  remove: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.5 15.5L20 20',
  close: 'M6 6l12 12M18 6L6 18',
  plan: 'M4 5l5-2 6 2 5-2v16l-5 2-6-2-5 2zM9 3v16M15 5v16',
  walk: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5M12 8v4l3 2',
  spread: 'M4 12h16M4 12l3-3M4 12l3 3M20 12l-3-3M20 12l-3 3',
  gather: 'M3 12h7M21 12h-7M10 12l-3-3M10 12l-3 3M14 12l3-3M14 12l3 3',
} as const;
