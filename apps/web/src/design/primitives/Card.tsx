'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { useTouchFeedback } from '../feedback/useTouchFeedback';
import styles from './Card.module.css';

/** How worn this passage is, from visitor attention. 0 is untouched. */
export type PatinaLevel = 0 | 1 | 2 | 3 | 4;

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  patina?: PatinaLevel;
  interactive?: boolean;
  children: ReactNode;
}

export function Card({
  patina = 0,
  interactive = false,
  children,
  className,
  onPointerDown,
  ...rest
}: CardProps) {
  const feedback = useTouchFeedback('light');
  const patinaClass = patina === 0 ? '' : (styles[`patina${patina}`] ?? '');

  return (
    <div
      {...rest}
      className={[
        styles.card,
        patinaClass,
        interactive ? styles.interactive : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      onPointerDown={(event) => {
        if (interactive) feedback();
        onPointerDown?.(event);
      }}
    >
      {children}
    </div>
  );
}
