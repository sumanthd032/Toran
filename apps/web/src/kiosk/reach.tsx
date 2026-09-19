'use client';

/**
 * The channel's own controls, set in the reach zone.
 *
 * Primary controls live in the bottom third, where a standing visitor's hand
 * already is (CLAUDE.md section 10). The shell draws the reach zone; a channel
 * puts its controls into it through this slot, so the Reading Room's page
 * turns and the Timeline Wall's era buttons sit beside Back and Home rather
 * than up in the reading area.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const Slot = createContext<HTMLElement | null>(null);

export const ReachSlot = Slot.Provider;

export function ReachTools({ children }: { children: ReactNode }) {
  const host = useContext(Slot);
  return host === null ? null : createPortal(children, host);
}
