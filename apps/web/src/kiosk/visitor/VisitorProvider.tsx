'use client';

/**
 * The visitor at this kiosk: their card, if they tapped one, their language,
 * their accessibility profile, and the dossier they are compiling.
 *
 * A card tap reads the card's record and switches the kiosk to it. A visitor
 * without a card, or at a kiosk without a reader, keeps a local session: the
 * same dossier and the same QR code, held for as long as they stand here.
 *
 * When the proximity session ends the kiosk forgets them (Dignified Amnesia,
 * PROJECT.md section 6.3): the card is unbound, the dossier leaves the screen,
 * the language returns to the device's own. What they kept went home on the
 * card, or was never stored at all.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_ACCESSIBILITY, type AccessibilityProfile } from '@toran/contracts';
import { playTouch } from '@/design/feedback/sound';
import { useI18n } from '@/i18n';
import type { CardKind, CardReader } from './card';
import { add, merge, remove, type DossierItem } from './dossier';
import { Patina } from './patina';
import { CardStore, type KeyValue } from './store';

export interface Visitor {
  /** The card bound to this kiosk now, if any. */
  readonly card: string | null;
  readonly reader: CardKind;
  readonly profile: AccessibilityProfile;
  setProfile: (profile: AccessibilityProfile) => void;
  readonly dossier: readonly DossierItem[];
  keep: (item: DossierItem) => void;
  discard: (ref: string) => void;
  /** Increments on every card read, for the screen to acknowledge it. */
  readonly taps: number;
  /** The card goes back in the bowl: its record is erased and the kiosk forgets it. */
  returnCard: () => void;
  readonly patina: Patina;
  /**
   * Increments each time the kiosk forgets a visitor. The kiosk keys its room
   * on it, so the next person starts at the room's beginning rather than on
   * the page the last one left open.
   */
  readonly visit: number;
}

const Ctx = createContext<Visitor | null>(null);

export function useVisitor(): Visitor {
  const visitor = useContext(Ctx);
  if (visitor === null) throw new Error('useVisitor outside a kiosk');
  return visitor;
}

/** localStorage when the browser allows it, memory when it does not. */
function storage(): KeyValue {
  try {
    const probe = '__toran__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    };
  }
}

export interface VisitorProviderProps {
  reader: CardReader;
  /** Whether the proximity machine holds a session for someone. */
  session: boolean;
  /** A card tap is presence, the same as a touch. */
  touch: () => void;
  defaultLanguage: string;
  children: ReactNode;
}

export function VisitorProvider({
  reader,
  session,
  touch,
  defaultLanguage,
  children,
}: VisitorProviderProps) {
  const { lang, setLang } = useI18n();
  const kv = useMemo(() => (typeof window === 'undefined' ? null : storage()), []);
  const cards = useMemo(() => (kv === null ? null : new CardStore(kv)), [kv]);
  const patina = useMemo(
    () =>
      new Patina(
        kv ?? {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
        },
      ),
    [kv],
  );

  const [card, setCard] = useState<string | null>(null);
  const [profile, setProfileState] =
    useState<AccessibilityProfile>(DEFAULT_ACCESSIBILITY);
  const [dossier, setDossier] = useState<readonly DossierItem[]>([]);
  const [taps, setTaps] = useState(0);
  const [issuedAt, setIssuedAt] = useState<string | null>(null);

  // A card tap must see the latest state, not the state when the reader started.
  const latest = useRef({ lang, profile, dossier, card });
  useEffect(() => {
    latest.current = { lang, profile, dossier, card };
  });

  const onCard = useCallback(
    (token: string) => {
      if (cards === null) return;
      touch();
      playTouch('firm');
      const now = latest.current;
      const record = cards.read(token);
      // Someone else's card is bound here: this is a different visitor, and
      // nothing of the last one's may carry over to them.
      const stranger = now.card !== null && now.card !== token;
      if (record === null) {
        // A card seen for the first time today takes on this visitor's
        // choices so far, and anything they kept before tapping it.
        const language = stranger ? defaultLanguage : now.lang;
        const accessibility = stranger ? DEFAULT_ACCESSIBILITY : now.profile;
        const issued = cards.issue(token, language, accessibility);
        const kept = stranger ? [] : now.dossier;
        cards.write({ ...issued, dossier: kept });
        setDossier(kept);
        setLang(language);
        setProfileState(accessibility);
        setIssuedAt(issued.session.issuedAt);
      } else {
        const kept =
          now.card === null ? merge(record.dossier, now.dossier) : record.dossier;
        cards.write({ ...record, dossier: kept });
        setDossier(kept);
        setLang(record.session.language);
        setProfileState(record.session.accessibility);
        setIssuedAt(record.session.issuedAt);
      }
      setCard(token);
      setTaps((n) => n + 1);
    },
    [cards, defaultLanguage, setLang, touch],
  );

  useEffect(() => reader.start(onCard), [reader, onCard]);

  // Whatever the visitor changes while their card is bound goes onto the card.
  useEffect(() => {
    if (cards === null || card === null || issuedAt === null) return;
    cards.write({
      session: { token: card, language: lang, accessibility: profile, issuedAt },
      dossier,
    });
  }, [cards, card, lang, profile, dossier, issuedAt]);

  const [visit, setVisit] = useState(0);
  const forget = useCallback(() => {
    setVisit((v) => v + 1);
    setCard(null);
    setIssuedAt(null);
    setDossier([]);
    setProfileState(DEFAULT_ACCESSIBILITY);
    setLang(defaultLanguage);
    patina.endSession();
  }, [defaultLanguage, patina, setLang]);

  // Dignified amnesia: the visitor has gone.
  const hadSession = useRef(session);
  useEffect(() => {
    if (hadSession.current && !session) forget();
    hadSession.current = session;
  }, [session, forget]);

  const value = useMemo<Visitor>(
    () => ({
      card,
      reader: reader.kind,
      profile,
      setProfile: setProfileState,
      dossier,
      keep: (item) => setDossier((d) => add(d, item)),
      discard: (ref) => setDossier((d) => remove(d, ref)),
      taps,
      returnCard: () => {
        if (card !== null) cards?.forget(card);
        forget();
      },
      patina,
      visit,
    }),
    [card, reader.kind, profile, dossier, taps, cards, forget, patina, visit],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
