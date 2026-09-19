'use client';

/**
 * How a kiosk hears a Sutra card. STEPS.md step 6, DECISIONS.md D-023.
 *
 *   hardware   the PN532 reader, through the same loopback daemon as the
 *              proximity sensor. The daemon sends { type: 'card', token }.
 *   simulator  the keyboard: F8 and F9 are two cards. For development, and
 *              for the Twin, which has no reader in front of it.
 *   null       no reader. The visitor picks a language by hand and keeps a
 *              local session, which still compiles a dossier and a QR code.
 *
 * Chosen with ?card=hw|sim|null. A standalone kiosk defaults to null, like
 * the sensor, because the tablet has no reader; the Twin defaults to the
 * simulator so a demonstration can show a card moving between devices.
 */

import { connectDaemon } from '../daemon';

export type CardKind = 'hardware' | 'simulator' | 'null';

export interface CardReader {
  readonly kind: CardKind;
  start: (onCard: (token: string) => void) => () => void;
}

/** A token is opaque, but it is never markup, a path or a paragraph. */
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,63}$/;

export const nullReader: CardReader = {
  kind: 'null',
  start: () => () => undefined,
};

/**
 * Two cards on two keys. F8 and F9 because the browser leaves them alone:
 * F6 moves focus to the address bar, F7 offers caret browsing, F10 opens a
 * menu, and letters would fire while someone types a search.
 */
export const SIMULATED_CARDS: Readonly<Record<string, string>> = {
  F8: 'sim-card-a',
  F9: 'sim-card-b',
};

export function simulatorReader(): CardReader {
  return {
    kind: 'simulator',
    start: (onCard) => {
      const onKey = (e: KeyboardEvent) => {
        const token = SIMULATED_CARDS[e.key];
        if (token === undefined || e.repeat) return;
        e.preventDefault();
        onCard(token);
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    },
  };
}

export function hardwareReader(): CardReader {
  return {
    kind: 'hardware',
    start: (onCard) =>
      connectDaemon({
        message: (m) => {
          if (m.type === 'card' && TOKEN.test(m.token)) onCard(m.token);
        },
      }),
  };
}

export function selectReader(search: string, context: 'standalone' | 'twin'): CardReader {
  const choice = new URLSearchParams(search).get('card');
  if (choice === 'hw') return hardwareReader();
  if (choice === 'sim') return simulatorReader();
  if (choice === 'null') return nullReader;
  return context === 'twin' ? simulatorReader() : nullReader;
}
