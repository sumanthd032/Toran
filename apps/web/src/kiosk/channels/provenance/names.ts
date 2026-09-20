/**
 * What a document is called on screen, in the visitor's language. Articles and
 * drafts are named from their number; a writing or an Act by its own title,
 * translated where the catalogue has it and in its own language where not.
 */

import type { ProvenanceNode } from '@toran/contracts';
import en from '../../../i18n/messages/en.json';
import type { MessageKey } from '@/i18n';

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function nodeTitle(node: ProvenanceNode, t: T): string {
  const n = /(\d+[A-Z]?)$/.exec(node.title)?.[1];
  if (node.kind === 'article' && n !== undefined)
    return t('provenance.node.article', { n });
  if (node.kind === 'draft' && n !== undefined) return t('provenance.node.draft', { n });
  const key = `provenance.title.${node.id}`;
  return key in en ? t(key as MessageKey) : node.title;
}
