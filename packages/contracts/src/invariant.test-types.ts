/**
 * Compile-time proof of the citation invariant.
 *
 * This file is type checked, never executed. Each @ts-expect-error asserts
 * that the line below it does NOT compile. If someone weakens the contract so
 * that uncited text becomes constructible, the expected error disappears and
 * tsc fails on the unused directive, which fails the build.
 */

import { citation, citedPassage, pageLocator, type CitedPassage } from './citation.ts';

const good = citedPassage({
  text: 'I measure the progress of a community by the degree of progress which women have achieved.',
  citation: citation({
    corpus: 'baws',
    workId: 'baws-v1',
    pageId: 'baws-v1-p0047',
    locator: pageLocator({ volume: 1, page: 47, observed: true }),
  }),
  language: 'en',
});
void good;

// A passage cannot be made from a bare string.
// @ts-expect-error text alone is not a passage
const noCitation: CitedPassage = 'some text from the archive';
void noCitation;

// A passage object cannot be assembled by hand, because the citation is required.
// @ts-expect-error missing citation
const handmade: CitedPassage = {
  text: 'x',
  language: 'en',
  translatedFrom: null,
  speaker: null,
};
void handmade;

// A citation cannot be made without a locator.
// @ts-expect-error locator is required
const noLocator = citation({ corpus: 'baws', workId: 'w', pageId: 'p' });
void noLocator;

// A page locator cannot be made without a page number.
// @ts-expect-error page is required
const noPage = pageLocator({ volume: 1, observed: true });
void noPage;

// A locator cannot be an arbitrary object.
// The directive sits on the offending property rather than the call, because
// a formatter is free to wrap the call and @ts-expect-error only suppresses
// the line directly beneath it.
const bogus = citation({
  corpus: 'baws',
  workId: 'w',
  pageId: 'p',
  // @ts-expect-error kind must be one of the known locator kinds
  locator: { kind: 'vibes' },
});
void bogus;

// The corpus is closed.
const badCorpus = citation({
  // @ts-expect-error not a corpus
  corpus: 'twitter',
  workId: 'w',
  pageId: 'p',
  locator: pageLocator({ page: 1, observed: true }),
});
void badCorpus;
