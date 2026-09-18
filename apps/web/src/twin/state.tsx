'use client';

/**
 * Twin state shared between the scene and the DOM around it.
 *
 * `open` is the device whose application is showing, or on its way in or
 * out. `phase` is where the transition is: in the hall, flying in, open, or
 * flying out. The director inside the canvas advances the phase; everything
 * else only asks for a device to open or close.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type TransitionPhase = 'hall' | 'in' | 'open' | 'out';

interface TwinState {
  readonly selected: string | null;
  readonly hovered: string | null;
  readonly entered: boolean;
  readonly open: string | null;
  readonly phase: TransitionPhase;
  /** True when the device was opened by URL, skipping the hall entirely. */
  readonly deepLinked: boolean;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setEntered: (value: boolean) => void;
  openDevice: (id: string, options?: { deepLink?: boolean }) => void;
  closeDevice: () => void;
  setPhase: (phase: TransitionPhase) => void;
  finishClose: () => void;
}

const Ctx = createContext<TwinState | null>(null);

export function TwinStateProvider({ children }: { children: ReactNode }) {
  const [selected, select] = useState<string | null>(null);
  const [hovered, hover] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [phase, setPhase] = useState<TransitionPhase>('hall');
  const [deepLinked, setDeepLinked] = useState(false);

  const openDevice = useCallback((id: string, options?: { deepLink?: boolean }) => {
    select(id);
    setOpen(id);
    setDeepLinked(options?.deepLink ?? false);
    setPhase(options?.deepLink ? 'open' : 'in');
  }, []);

  const closeDevice = useCallback(() => setPhase((p) => (p === 'open' ? 'out' : p)), []);

  const finishClose = useCallback(() => {
    setOpen(null);
    setPhase('hall');
    setDeepLinked(false);
  }, []);

  const value = useMemo(
    () => ({
      selected,
      hovered,
      entered,
      open,
      phase,
      deepLinked,
      select,
      hover,
      setEntered,
      openDevice,
      closeDevice,
      setPhase,
      finishClose,
    }),
    [
      selected,
      hovered,
      entered,
      open,
      phase,
      deepLinked,
      openDevice,
      closeDevice,
      finishClose,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTwinState(): TwinState {
  const ctx = useContext(Ctx);
  if (ctx === null) throw new Error('useTwinState must be used inside TwinStateProvider');
  return ctx;
}
