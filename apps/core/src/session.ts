/**
 * The session service: an anonymous card, its language, its accessibility
 * profile, and the passages its holder kept.
 *
 * This is what makes a tap at device 1 and a tap at device 9 the same visit.
 * Step 6 built that continuity inside one browser; across thirteen physical
 * kiosks it has to live somewhere they can all reach, and this is that place.
 *
 * The privacy posture is the point, so it is worth stating what this service
 * cannot do. It never learns which device a card tapped, because no route
 * carries a device id. It never learns when, beyond the moment the card was
 * issued. It never learns what was searched for. A card returned to the bowl is
 * deleted outright, and everything else expires with the day. There is nothing
 * to subpoena and nothing to leak, which is the correct posture for a
 * government memorial. ARCHITECTURE.md section 8, DECISIONS.md D-023.
 */

import {
  DOSSIER_LIMIT,
  readSessionRecord,
  readToken,
  sessionIsLive,
  SESSION_TTL_MS,
  type SessionRecord,
  type StoredItem,
} from '@toran/contracts';
import { one, rows, run, type Db } from './db.ts';

interface SessionRow {
  token: string;
  language: string;
  type_scale: string;
  high_contrast: number;
  audio_first: number;
  reduced_motion: number;
  issued_at: string;
}

export class Sessions {
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  read(rawToken: string): SessionRecord | null {
    const token = readToken(rawToken);
    const row = one<SessionRow>(this.db, 'select * from session where token = ?', token);
    if (row === null) return null;
    if (!sessionIsLive(row.issued_at, this.now())) {
      // Reading an expired card is what collects it. A daily sweep would work
      // too, but this needs no scheduler on a server an archivist restarts.
      this.forget(token);
      return null;
    }
    const items = rows<{ item: string }>(
      this.db,
      'select item from dossier_item where token = ? order by rowid',
      token,
    );
    return {
      session: {
        token: row.token,
        language: row.language,
        accessibility: {
          typeScale:
            row.type_scale as SessionRecord['session']['accessibility']['typeScale'],
          highContrast: row.high_contrast === 1,
          audioFirst: row.audio_first === 1,
          reducedMotion: row.reduced_motion === 1,
        },
        issuedAt: row.issued_at,
      },
      dossier: items.map((r) => JSON.parse(r.item) as StoredItem),
    };
  }

  /**
   * Writes what a kiosk knows about a card.
   *
   * The dossier replaces rather than merges. A kiosk holds the whole of it in
   * memory and already merged what the card carried when the card was tapped,
   * so a merge here would be a second opinion about the same list and the two
   * would eventually disagree. Removing a passage has to work as well as adding
   * one, and it cannot if the server only ever unions.
   */
  write(rawToken: string, raw: unknown): { record: SessionRecord; refused: number } {
    const token = readToken(rawToken);
    const { record, refused } = readSessionRecord({
      ...(typeof raw === 'object' && raw !== null ? raw : {}),
      session: {
        ...(typeof raw === 'object' && raw !== null
          ? ((raw as Record<string, unknown>)['session'] ?? {})
          : {}),
        token,
      },
    });
    const kept = record.dossier.slice(0, DOSSIER_LIMIT);
    const a = record.session.accessibility;
    run(
      this.db,
      `insert into session
           (token, language, type_scale, high_contrast, audio_first, reduced_motion, issued_at)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(token) do update set
           language = excluded.language,
           type_scale = excluded.type_scale,
           high_contrast = excluded.high_contrast,
           audio_first = excluded.audio_first,
           reduced_motion = excluded.reduced_motion`,
      token,
      record.session.language,
      a.typeScale,
      a.highContrast ? 1 : 0,
      a.audioFirst ? 1 : 0,
      a.reducedMotion ? 1 : 0,
      record.session.issuedAt,
    );
    run(this.db, 'delete from dossier_item where token = ?', token);
    for (const item of kept) {
      run(
        this.db,
        'insert into dossier_item (token, ref, item) values (?, ?, ?)',
        token,
        item.ref,
        JSON.stringify(item),
      );
    }
    return { record: { session: record.session, dossier: kept }, refused };
  }

  /** The card went back in the bowl. Nothing of this holder survives it. */
  forget(rawToken: string): void {
    const token = readToken(rawToken);
    run(this.db, 'delete from dossier_item where token = ?', token);
    run(this.db, 'delete from session where token = ?', token);
  }

  /**
   * Drops every session older than a visit. Called on boot, because a server
   * restarted the next morning should not still be holding yesterday's cards.
   */
  sweep(): number {
    const cutoff = new Date(this.now() - SESSION_TTL_MS).toISOString();
    const stale = rows<{ token: string }>(
      this.db,
      'select token from session where issued_at < ?',
      cutoff,
    );
    for (const row of stale) this.forget(row.token);
    return stale.length;
  }

  /** How many cards are live. A count, never a list, and never with a device beside it. */
  count(): number {
    return one<{ n: number }>(this.db, 'select count(*) as n from session')?.n ?? 0;
  }
}
