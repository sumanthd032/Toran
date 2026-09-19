/**
 * The take-home link a dossier's QR code carries.
 *
 * It holds page references only: where each kept passage is printed, never
 * the visitor, never a time. The references are in the URL fragment, which a
 * browser does not send to the server, so opening the link tells no server
 * what anyone read. The dossier page rebuilds the passages from the archive.
 */

import { DOSSIER_LIMIT, parseRef } from './dossier.ts';

export const DOSSIER_PATH = '/dossier/';

/** The visitor's language rides along, so the page opens in it. A language is not personal data. */
export function dossierUrl(
  origin: string,
  refs: readonly string[],
  lang?: string,
): string {
  const query = lang === undefined || !/^[a-z]{2,3}$/.test(lang) ? '' : `?lang=${lang}`;
  return `${origin.replace(/\/+$/, '')}${DOSSIER_PATH}${query}#${refs.join(',')}`;
}

export function refsFromHash(hash: string): string[] {
  return hash
    .replace(/^#/, '')
    .split(',')
    .map((r) => {
      try {
        return decodeURIComponent(r);
      } catch {
        return '';
      }
    })
    .filter((r) => parseRef(r) !== null)
    .slice(0, DOSSIER_LIMIT);
}
