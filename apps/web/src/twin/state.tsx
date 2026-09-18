'use client';

/**
 * Selection state shared between the scene and the DOM around it. The device
 * sheet and a tap on a device in the hall select the same thing.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface TwinState {
  readonly selected: string | null;
  readonly hovered: string | null;
  readonly entered: boolean;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setEntered: (value: boolean) => void;
}

const Ctx = createContext<TwinState | null>(null);

export function TwinStateProvider({ children }: { children: ReactNode }) {
  const [selected, select] = useState<string | null>(null);
  const [hovered, hover] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const value = useMemo(
    () => ({ selected, hovered, entered, select, hover, setEntered }),
    [selected, hovered, entered],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTwinState(): TwinState {
  const ctx = useContext(Ctx);
  if (ctx === null) throw new Error('useTwinState must be used inside TwinStateProvider');
  return ctx;
}
