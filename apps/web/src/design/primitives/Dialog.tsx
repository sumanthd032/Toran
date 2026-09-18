'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import styles from './Dialog.module.css';

export interface DialogProps {
  open: boolean;
  /** Already translated by the caller. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}

/**
 * Wraps the native dialog element, which gives focus trapping, inert
 * background and Escape handling without reimplementing any of it.
 *
 * Note for kiosk surfaces: idle timeout must never raise a dialog. A session
 * decays rather than asking "are you still there". See DECISIONS.md D-022.
 */
export function Dialog({ open, title, onClose, children, actions }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className={styles.body}>
        <h2 className={styles.title}>{title}</h2>
        {children}
        {actions !== undefined && <div className={styles.actions}>{actions}</div>}
      </div>
    </dialog>
  );
}
