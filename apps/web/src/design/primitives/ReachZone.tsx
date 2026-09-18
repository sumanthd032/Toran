import type { ReactNode } from 'react';
import styles from './ReachZone.module.css';

export interface ReachZoneProps {
  align?: 'start' | 'center' | 'end' | 'between';
  /**
   * Static flow instead of pinned to the bottom third. For the design system
   * reference and the curator desk surface, which is not a standing kiosk.
   */
  inline?: boolean;
  children: ReactNode;
}

/**
 * Layout primitive that pins its children to the bottom third of the screen,
 * within thumb reach of a standing visitor.
 */
export function ReachZone({ align = 'start', inline = false, children }: ReachZoneProps) {
  return (
    <div
      className={[styles.zone, styles[align], inline ? styles.inline : '']
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
