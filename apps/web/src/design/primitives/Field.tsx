'use client';

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './Field.module.css';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Already translated by the caller. Primitives do not reach into i18n. */
  label: string;
  hint?: ReactNode;
}

export function Field({ label, hint, className, ...rest }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={styles.wrapper}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        {...rest}
        id={id}
        className={[styles.input, className ?? ''].filter(Boolean).join(' ')}
        {...(hint !== undefined ? { 'aria-describedby': hintId } : {})}
      />
      {hint !== undefined && (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}
