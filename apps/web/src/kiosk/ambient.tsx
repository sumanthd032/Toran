'use client';

/**
 * A channel's own attract loop, set in the shell's ambient layer.
 *
 * Every kiosk shows curated passages from across the hall when nobody is near.
 * A channel that has a better story to tell from 3 m puts it here instead: the
 * Timeline Wall's idle narrative runs in this slot, and the shell's passages
 * step aside while it does.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const Slot = createContext<HTMLElement | null>(null);

export const AmbientSlot = Slot.Provider;

export function AmbientContent({ children }: { children: ReactNode }) {
  const host = useContext(Slot);
  return host === null ? null : createPortal(children, host);
}
