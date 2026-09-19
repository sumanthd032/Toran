/**
 * The Timeline Wall's model, and the timeline contract under it. Run with `npm test`.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { readTimeline, type Timeline } from '@toran/contracts';
import en from '../../../i18n/messages/en.json' with { type: 'json' };
import hi from '../../../i18n/messages/hi.json' with { type: 'json' };
import mr from '../../../i18n/messages/mr.json' with { type: 'json' };
import {
  cardsThatFit,
  centreOn,
  closeIdle,
  CARD_IDLE_MS,
  formatDate,
  formatYear,
  MAX_CARDS,
  nextInThread,
  openYear,
  stepCard,
  yearsWithEvents,
  type OpenCard,
} from './model.ts';

const passage = (page: number, text: string) => ({
  corpus: 'baws',
  workId: 'baws-v17-1',
  pageId: `baws-v17-1-p${String(page).padStart(4, '0')}`,
  locator: { kind: 'page', volume: 17, part: '1', page, observed: true },
  language: 'en',
  speaker: null,
  text,
});

const event = (id: string, date: string, threads: string[], page = 9) => ({
  id,
  date,
  threads,
  passages: [passage(page, `Something happened in ${date.slice(0, 4)}.`)],
  photo: null,
});

const RAW = {
  range: [1891, 1956],
  threads: ['learning', 'rights', 'constitution', 'dhamma'],
  events: [
    event('mahad', '1927-03', ['rights']),
    event('manusmriti', '1927-12-25', ['rights']),
    event('kalaram', '1930-03-03', ['rights']),
    event('round-table', '1930-09-06', ['constitution']),
    event('poona-pact', '1932-09-24', ['rights', 'constitution']),
    event('yeola', '1935', ['rights', 'dhamma']),
    event('nagpur', '1956-10-14', ['dhamma']),
  ],
};

const timeline: Timeline = readTimeline(RAW);
let key = 0;
const nextKey = () => ++key;
const ids = (cards: readonly OpenCard[]) => cards.map((c) => c.eventId);

test('a year opens a card for each of its events', () => {
  const cards = openYear([], timeline, 1927, 0, nextKey);
  assert.deepEqual(ids(cards), ['mahad', 'manusmriti']);
  assert.equal(yearsWithEvents(timeline).get(1930), 2);
});

test('four people open four years at once, and cards sit in date order', () => {
  let cards: OpenCard[] = [];
  for (const [year, at] of [
    [1956, 1],
    [1932, 2],
    [1935, 3],
  ] as const) {
    cards = openYear(cards, timeline, year, at, nextKey);
  }
  assert.deepEqual(ids(cards), ['poona-pact', 'yeola', 'nagpur']);
  cards = openYear(cards, timeline, 1927, 4, nextKey);
  assert.equal(cards.length, MAX_CARDS);
  // 1956 was touched longest ago, so it gave way to the two events of 1927.
  assert.deepEqual(ids(cards), ['mahad', 'manusmriti', 'poona-pact', 'yeola']);
});

test('the wall holds four cards, a short screen one, and never none', () => {
  // Measured: 17.5 lines of 24 px body text, and a 30.6 px gap.
  const min = { width: 420, height: 420 };
  assert.equal(cardsThatFit({ width: 1798, height: 606 }, min, 30.6), 4);
  assert.equal(cardsThatFit({ width: 1318, height: 470 }, min, 30.6), 2);
  assert.equal(cardsThatFit({ width: 1158, height: 375 }, min, 30.6), 1);
  assert.equal(cardsThatFit({ width: 4000, height: 1600 }, min, 30.6), MAX_CARDS);
  assert.equal(
    cardsThatFit({ width: 1798, height: 900 }, { width: 840, height: 840 }, 30.6),
    2,
  );
  const two = openYear(
    openYear([], timeline, 1932, 0, nextKey, 2),
    timeline,
    1927,
    1,
    nextKey,
    2,
  );
  assert.deepEqual(ids(two), ['mahad', 'manusmriti']);
});

test('opening a year that is open refreshes it rather than doubling it', () => {
  const once = openYear([], timeline, 1932, 0, nextKey);
  const twice = openYear(once, timeline, 1932, 50, nextKey);
  assert.deepEqual(ids(twice), ['poona-pact']);
  assert.equal(twice[0]?.touched, 50);
});

test('a thread branches from an event to the next one on it', () => {
  const poona = timeline.events.find((e) => e.id === 'poona-pact')!;
  assert.equal(nextInThread(timeline, poona, 'rights')?.id, 'yeola');
  assert.equal(nextInThread(timeline, poona, 'constitution'), null);
  const yeola = timeline.events.find((e) => e.id === 'yeola')!;
  assert.equal(nextInThread(timeline, yeola, 'dhamma')?.id, 'nagpur');
});

test('stepping keeps the card in its place, or hands over to an open card', () => {
  let cards = openYear([], timeline, 1932, 0, nextKey);
  cards = openYear(cards, timeline, 1956, 1, nextKey);
  const poonaKey = cards[0]!.key;
  const stepped = stepCard(cards, poonaKey, 'yeola', 2);
  assert.equal(stepped[0]?.key, poonaKey);
  assert.deepEqual(ids(stepped), ['yeola', 'nagpur']);
  const merged = stepCard(stepped, poonaKey, 'nagpur', 3);
  assert.deepEqual(ids(merged), ['nagpur']);
});

test('a card nobody touches closes by itself', () => {
  const cards = openYear([], timeline, 1932, 0, nextKey);
  assert.equal(closeIdle(cards, CARD_IDLE_MS - 1).length, 1);
  assert.equal(closeIdle(cards, CARD_IDLE_MS).length, 0);
});

test('the axis centres a year, and stops at its ends', () => {
  assert.equal(centreOn(1927, 1891, 100, 6600, 1000), 3600 + 50 - 500);
  assert.equal(centreOn(1891, 1891, 100, 6600, 1000), 0);
  assert.equal(centreOn(1956, 1891, 100, 6600, 1000), 5600);
});

test('a date is written only as precisely as its source gives it', () => {
  const mahad = timeline.events.find((e) => e.id === 'mahad')!;
  const yeola = timeline.events.find((e) => e.id === 'yeola')!;
  const kalaram = timeline.events.find((e) => e.id === 'kalaram')!;
  assert.equal(formatDate(kalaram.date, 'en'), '3 March 1930');
  assert.equal(formatDate(mahad.date, 'en'), 'March 1927');
  assert.equal(formatDate(yeola.date, 'en'), '1935');
  assert.equal(formatYear(1927, 'mr'), '१९२७');
});

test('the contract refuses an event without a source, out of order or out of range', () => {
  const broken = (patch: (r: typeof RAW) => unknown) => () =>
    readTimeline(patch(structuredClone(RAW)));
  assert.throws(broken((r) => ((r.events[0]!.passages = []), r)));
  assert.throws(
    broken((r) => ((r.events[0]!.passages[0]!.locator = undefined as never), r)),
  );
  assert.throws(broken((r) => (r.events.reverse(), r)));
  assert.throws(broken((r) => ((r.events[0]!.date = '1850'), r)));
  assert.throws(broken((r) => ((r.events[0]!.date = '1927-02-30'), r)));
  assert.throws(broken((r) => ((r.events[0]!.threads = ['gossip']), r)));
  assert.throws(
    broken(
      (r) => (
        ((r.events[0] as { photo: unknown }).photo = {
          kind: 'commons',
          file: 'photos/x.jpg',
          width: 10,
          height: 10,
          title: 'x',
          licence: 'CC BY-SA 4.0',
          page: 'https://commons.wikimedia.org/wiki/File:x.jpg',
          sha1: 'a'.repeat(40),
        }),
        r
      ),
    ),
  );
});

const BUILT = new URL('../../../../public/archive/timeline.json', import.meta.url);

test('the built timeline reads, and every event is named in every language', (t) => {
  if (!existsSync(BUILT)) {
    t.skip('archive not built; run npm run build:data');
    return;
  }
  const built = readTimeline(JSON.parse(readFileSync(BUILT, 'utf8')));
  assert.ok(built.events.length >= 12);
  for (const catalogue of [en, hi, mr] as Record<string, string>[]) {
    for (const e of built.events) {
      assert.ok(catalogue[`timeline.event.${e.id}`], `timeline.event.${e.id}`);
      for (const thread of e.threads) assert.ok(catalogue[`timeline.thread.${thread}`]);
    }
  }
});
