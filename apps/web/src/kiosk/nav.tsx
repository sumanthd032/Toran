'use client';

/**
 * Back, Home and Forward, the only three navigation affordances a kiosk has
 * (CLAUDE.md section 10). The shell owns the buttons; the channel owns what
 * they mean, because only the Reading Room knows that Back from a page goes to
 * the results, and Back from the results leaves the room.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ChannelNav {
  /** Step back within the channel. False when there is nothing to go back to. */
  back: () => boolean;
  home: () => void;
  forward: () => boolean;
  canForward: boolean;
}

interface NavRegistry {
  register: (nav: ChannelNav | null) => void;
}

const Registry = createContext<NavRegistry | null>(null);

export function useNavSlot(): {
  provider: NavRegistry;
  back: () => boolean;
  home: () => void;
  forward: () => void;
  canForward: boolean;
} {
  const current = useRef<ChannelNav | null>(null);
  const [canForward, setCanForward] = useState(false);
  const register = useCallback((nav: ChannelNav | null) => {
    current.current = nav;
    setCanForward(nav?.canForward ?? false);
  }, []);
  const provider = useRef<NavRegistry>({ register }).current;
  return {
    provider,
    back: () => current.current?.back() ?? false,
    home: () => current.current?.home(),
    forward: () => void current.current?.forward(),
    canForward,
  };
}

export function NavProvider({
  registry,
  children,
}: {
  registry: NavRegistry;
  children: ReactNode;
}) {
  return <Registry.Provider value={registry}>{children}</Registry.Provider>;
}

/** A channel declares what Back, Home and Forward do in it. */
export function useChannelNav(nav: ChannelNav): void {
  const registry = useContext(Registry);
  const latest = useRef(nav);
  useEffect(() => {
    latest.current = nav;
  });
  useEffect(() => {
    if (registry === null) return;
    registry.register({
      back: () => latest.current.back(),
      home: () => latest.current.home(),
      forward: () => latest.current.forward(),
      canForward: nav.canForward,
    });
  }, [registry, nav.canForward]);
  useEffect(() => () => registry?.register(null), [registry]);
}
