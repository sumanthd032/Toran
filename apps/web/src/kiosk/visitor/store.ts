/**
 * What a Sutra card leads to: a language, an accessibility profile and a
 * dossier, held against the card's anonymous token. DECISIONS.md D-023.
 *
 * The token is the card, not the person. Nothing here identifies anyone, and
 * nothing survives the card being returned at the exit or the day ending.
 *
 * This is the device's own copy, in the browser's storage. Every kiosk in the
 * Twin shares it, as do kiosk routes opened in the same browser, which is
 * enough for a tap at one device to be recognised at the next. Across physical
 * kiosks, continuity comes from Toran Core's session service, and this store
 * is what the kiosk falls back to when Core is not reachable.
 */

import {
  DEFAULT_ACCESSIBILITY,
  restore,
  SESSION_TTL_MS,
  store,
  type AccessibilityProfile,
  type DossierItem,
  type SutraSession,
} from '@toran/contracts';

const PREFIX = 'toran.card.';

export interface CardRecord {
  readonly session: SutraSession;
  readonly dossier: readonly DossierItem[];
}

/** The part of Storage this needs, so tests can pass a Map. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SCALES = ['default', 'large', 'largest'] as const;

function profile(raw: unknown): AccessibilityProfile {
  const p = (raw ?? {}) as Partial<Record<keyof AccessibilityProfile, unknown>>;
  return {
    typeScale: SCALES.includes(p.typeScale as (typeof SCALES)[number])
      ? (p.typeScale as AccessibilityProfile['typeScale'])
      : DEFAULT_ACCESSIBILITY.typeScale,
    highContrast: p.highContrast === true,
    audioFirst: p.audioFirst === true,
    reducedMotion: p.reducedMotion === true,
  };
}

export class CardStore {
  private readonly kv: KeyValue;
  private readonly now: () => number;

  constructor(kv: KeyValue, now: () => number = Date.now) {
    this.kv = kv;
    this.now = now;
  }

  read(token: string): CardRecord | null {
    let raw: string | null = null;
    try {
      raw = this.kv.getItem(PREFIX + token);
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as {
        session?: Partial<SutraSession>;
        dossier?: unknown;
      };
      const s = parsed.session;
      if (
        s === undefined ||
        typeof s.language !== 'string' ||
        typeof s.issuedAt !== 'string'
      ) {
        throw new Error('malformed');
      }
      if (this.now() - Date.parse(s.issuedAt) > SESSION_TTL_MS) {
        this.forget(token);
        return null;
      }
      return {
        session: {
          token,
          language: s.language,
          accessibility: profile(s.accessibility),
          issuedAt: s.issuedAt,
        },
        dossier: restore(parsed.dossier).items,
      };
    } catch {
      // A record that cannot be read is treated as a blank card, not trusted.
      this.forget(token);
      return null;
    }
  }

  write(record: CardRecord): void {
    try {
      this.kv.setItem(
        PREFIX + record.session.token,
        JSON.stringify({ session: record.session, dossier: record.dossier.map(store) }),
      );
    } catch {
      // Storage full or blocked: the kiosk carries on with the session in memory.
    }
  }

  /** A card returned at the exit, or recycled. */
  forget(token: string): void {
    try {
      this.kv.removeItem(PREFIX + token);
    } catch {
      // Nothing to do; the record expires with the day regardless.
    }
  }

  /** A new session for a card seen for the first time today. */
  issue(
    token: string,
    language: string,
    accessibility: AccessibilityProfile,
  ): CardRecord {
    const record: CardRecord = {
      session: {
        token,
        language,
        accessibility,
        issuedAt: new Date(this.now()).toISOString(),
      },
      dossier: [],
    };
    this.write(record);
    return record;
  }
}
