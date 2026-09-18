/**
 * Run: node --test apps/web/src/kiosk/machine.test.ts
 *
 * Constants come from the shared contract, the same ones the kiosk uses, so a
 * change to a threshold is tested rather than duplicated here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGAGEMENT_RADIUS,
  IDLE,
  PROXEMIC_HYSTERESIS,
  PROXEMIC_THRESHOLDS,
} from '../../../../packages/contracts/src/kiosk.ts';
import { boot, reduce, type Proximity, type ProximityEvent } from './machine.ts';

const config = {
  thresholds: PROXEMIC_THRESHOLDS,
  hysteresis: PROXEMIC_HYSTERESIS,
  engagementRadius: ENGAGEMENT_RADIUS,
  idle: IDLE,
};

function run(start: Proximity, events: ProximityEvent[]): Proximity[] {
  const trail: Proximity[] = [];
  let m = start;
  for (const e of events) {
    m = reduce(m, e, config);
    trail.push(m);
  }
  return trail;
}

const at = (metres: number, t: number): ProximityEvent => ({
  type: 'distance',
  metres,
  at: t,
});
const tick = (t: number): ProximityEvent => ({ type: 'tick', at: t });
const touch = (t: number): ProximityEvent => ({ type: 'touch', at: t });
const states = (trail: Proximity[]) => trail.map((m) => m.state);

test('with no sensor the kiosk boots to subtle, the tablet case', () => {
  assert.equal(boot(0, 'none').state, 'subtle');
});

test('with a sensor the kiosk boots to ambient', () => {
  assert.equal(boot(0, 'sensor').state, 'ambient');
});

test('an approach walks through every zone in order', () => {
  const trail = run(boot(0, 'sensor'), [at(4, 1), at(2.5, 2), at(1.2, 3), at(0.4, 4)]);
  assert.deepEqual(states(trail), ['ambient', 'implicit', 'subtle', 'personal']);
  assert.equal(trail.at(-1)?.session, true, 'arriving at the kiosk opens a session');
});

test('a reading jittering across a boundary does not flicker the screen', () => {
  const trail = run(boot(0, 'sensor'), [
    at(1.45, 1),
    at(1.55, 2),
    at(1.48, 3),
    at(1.62, 4),
    at(1.51, 5),
  ]);
  assert.deepEqual(states(trail), ['subtle', 'subtle', 'subtle', 'subtle', 'subtle']);
});

test('the kiosk leaves a zone only past the hysteresis margin', () => {
  const trail = run(boot(0, 'sensor'), [at(1.2, 1), at(1.69, 2), at(1.71, 3)]);
  assert.deepEqual(states(trail), ['subtle', 'subtle', 'implicit']);
});

test('stepping back from the kiosk drops to subtle, not further', () => {
  const trail = run(boot(0, 'sensor'), [at(0.4, 1), at(1.0, 2)]);
  assert.deepEqual(states(trail), ['personal', 'subtle']);
});

test('leaving mid session decays rather than snapping to the attract loop', () => {
  const trail = run(boot(0, 'sensor'), [at(0.4, 1), at(5, 2)]);
  assert.deepEqual(states(trail), ['personal', 'decaying']);
});

test('coming back while decaying resumes', () => {
  const trail = run(boot(0, 'sensor'), [at(0.4, 1), at(5, 2), at(0.3, 3)]);
  assert.deepEqual(states(trail), ['personal', 'decaying', 'personal']);
});

test('coming back to the engagement zone while decaying resumes at subtle', () => {
  const trail = run(boot(0, 'sensor'), [at(0.4, 1), at(5, 2), at(1.0, 3)]);
  assert.equal(trail.at(-1)?.state, 'subtle');
});

test('idle decay follows 45, 90 and 120 seconds', () => {
  const trail = run(boot(0, 'none'), [
    touch(0),
    tick(44_999),
    tick(45_000),
    tick(89_999),
    tick(90_000),
    tick(119_999),
    tick(120_000),
  ]);
  assert.deepEqual(states(trail), [
    'personal',
    'personal',
    'decaying',
    'decaying',
    'ambient',
    'ambient',
    'ambient',
  ]);
  assert.equal(trail[5]?.session, true, 'session is still held at 119.999 s');
  assert.equal(trail[6]?.session, false, 'session is dropped at 120 s');
});

test('a touch wakes the kiosk from the attract loop', () => {
  const trail = run(boot(0, 'none'), [tick(90_000), touch(91_000)]);
  assert.deepEqual(states(trail), ['ambient', 'personal']);
  assert.equal(trail.at(-1)?.session, true);
});

test('a touch during decay resumes without asking anything', () => {
  const trail = run(boot(0, 'none'), [touch(0), tick(50_000), touch(51_000)]);
  assert.deepEqual(states(trail), ['personal', 'decaying', 'personal']);
});

test('standing at the kiosk reading, without touching, is not idle', () => {
  const events: ProximityEvent[] = [at(0.4, 0)];
  for (let t = 1_000; t <= 60_000; t += 1_000) events.push(at(0.42, t), tick(t));
  const trail = run(boot(0, 'sensor'), events);
  assert.equal(trail.at(-1)?.state, 'personal', 'a minute of presence does not decay');
});

test('a session survives a brief absence and is gone after two minutes', () => {
  const back = run(boot(0, 'sensor'), [
    touch(0),
    at(5, 1_000),
    tick(100_000),
    at(0.3, 100_500),
  ]);
  assert.equal(back.at(-1)?.session, true, 'back within two minutes: same session');
  const gone = run(boot(0, 'sensor'), [touch(0), at(5, 1_000), tick(121_000)]);
  assert.equal(gone.at(-1)?.session, false, 'gone for over two minutes: session dropped');
});

test('someone passing at a distance never opens a session', () => {
  const trail = run(boot(0, 'sensor'), [at(2.5, 1), at(2.0, 2), at(4, 3), tick(200_000)]);
  assert.ok(trail.every((m) => !m.session));
  assert.equal(trail.at(-1)?.state, 'ambient');
});

test('losing the sensor mid session keeps the session and the state', () => {
  const trail = run(boot(0, 'sensor'), [
    at(0.4, 1),
    { type: 'sensor', at: 2, presence: 'none' },
  ]);
  assert.equal(trail.at(-1)?.state, 'personal');
  assert.equal(trail.at(-1)?.session, true);
});

test('losing the sensor while idle puts the interface up rather than waiting forever', () => {
  const trail = run(boot(0, 'sensor'), [
    at(4, 1),
    { type: 'sensor', at: 2, presence: 'none' },
  ]);
  assert.equal(trail.at(-1)?.state, 'subtle');
});
