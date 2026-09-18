'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useTouchFeedback } from '../feedback/useTouchFeedback';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'quiet';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** A commit action such as saving to the dossier gets the firmer sound. */
  weight?: 'light' | 'firm';
  fullWidth?: boolean;
  /**
   * Every primary action must be comprehensible from its icon alone, because
   * a visitor reading Marathi should not depend on an English label.
   */
  icon?: ReactNode;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  weight = 'light',
  fullWidth = false,
  icon,
  children,
  className,
  onPointerDown,
  ...rest
}: ButtonProps) {
  const feedback = useTouchFeedback(weight);

  return (
    <button
      type="button"
      {...rest}
      className={[
        styles.button,
        styles[variant],
        fullWidth ? styles.full : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      onPointerDown={(event) => {
        feedback();
        onPointerDown?.(event);
      }}
    >
      {icon}
      {children}
    </button>
  );
}
