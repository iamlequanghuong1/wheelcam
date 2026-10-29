// Alert decision logic. Runs on Node's built-in test runner; Node 22.18+ loads
// the TypeScript sources directly (type stripping), so nothing is compiled first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  admitEvents,
  alertFromEvent,
  assessSignal,
  BLOCKS_START,
  enqueueAlert,
  moodOf,
  PRESENCE_START,
  QUEUE_LIMIT,
  stepBlocks,
  stepPresence,
  wakeHint,
} from '../src/logic/rules.ts';

const S = 1000;
const timing = { wakeHoldMs: 60 * S, sleepHoldMs: 180 * S };

/** Feed a list of [atSeconds, coreStatus] readings and collect what flipped. */
function run(readings, memory = PRESENCE_START) {
  const flips = [];
  for (const [at, core] of readings) {
    const r = stepPresence(memory, core, at * S, timing);
    memory = r.memory;
    if (r.flipped) flips.push([at, r.flipped]);
  }
  return { memory, flips };
}

const every2s = (from, to, core) => {
  const out = [];
  for (let t = from; t <= to; t += 2) out.push([t, core]);
  return out;
};

test('presence: the first reading is adopted silently', () => {
  assert.deepEqual(run([[0, 'ACTIVE']]).flips, []);
  assert.equal(run([[0, 'ACTIVE']]).memory.committed, 'awake');
  assert.deepEqual(run([[0, 'IDLE']]).flips, []);
  assert.equal(run([[0, 'IDLE']]).memory.committed, 'asleep');
});

test('presence: wake-up is announced once ACTIVE has held for 60 s', () => {
  const { flips, memory } = run([[0, 'IDLE'], ...every2s(10, 120, 'ACTIVE')]);
  assert.deepEqual(flips, [[70, 'awake']]);
  assert.equal(memory.committed, 'awake');
});

test('presence: a short burst on the wheel is not a wake-up', () => {
  const { flips } = run([[0, 'IDLE'], ...every2s(10, 50, 'ACTIVE'), ...every2s(52, 300, 'IDLE')]);
  assert.deepEqual(flips, []);
});

test('presence: one IDLE reading restarts the wake hold', () => {
  const { flips } = run([[0, 'IDLE'], ...every2s(10, 50, 'ACTIVE'), [52, 'IDLE'], ...every2s(54, 130, 'ACTIVE')]);
  assert.deepEqual(flips, [[114, 'awake']]);
});

test('presence: bedtime needs IDLE held for 3 minutes', () => {
  const { flips } = run([[0, 'ACTIVE'], ...every2s(10, 188, 'IDLE')]);
  assert.deepEqual(flips, []);
  const later = run([[0, 'ACTIVE'], ...every2s(10, 190, 'IDLE')]);
  assert.deepEqual(later.flips, [[190, 'asleep']]);
});

test('presence: a breather shorter than 3 minutes keeps him awake', () => {
  const { flips, memory } = run([[0, 'ACTIVE'], ...every2s(2, 100, 'IDLE'), ...every2s(102, 200, 'ACTIVE')]);
  assert.deepEqual(flips, []);
  assert.equal(memory.committed, 'awake');
});

test('presence: lost signal and counter faults freeze the state and reset the hold', () => {
  const lost = run([[0, 'ACTIVE'], [10, 'IDLE'], [100, null], [150, 'COUNTER_FAULT'], ...every2s(200, 378, 'IDLE')]);
  assert.deepEqual(lost.flips, []);
  const resumed = run([[0, 'ACTIVE'], [10, 'IDLE'], [100, null], ...every2s(200, 380, 'IDLE')]);
  assert.deepEqual(resumed.flips, [[380, 'asleep']]);
});

test('presence: unknown core states are treated as no reading', () => {
  const { flips, memory } = run([[0, 'IDLE'], ...every2s(2, 200, 'SPINNING')]);
  assert.deepEqual(flips, []);
  assert.equal(memory.committed, 'asleep');
});

test('mood combines the announced state with the raw reading', () => {
  const awake = { committed: 'awake', pending: null, pendingSince: 0 };
  const asleep = { committed: 'asleep', pending: null, pendingSince: 0 };
  assert.equal(moodOf(awake, 'ACTIVE'), 'running');
  assert.equal(moodOf(awake, 'IDLE'), 'breather');
  assert.equal(moodOf(asleep, 'ACTIVE'), 'stirring');
  assert.equal(moodOf(asleep, 'IDLE'), 'asleep');
  assert.equal(moodOf(asleep, null), null);
  assert.equal(moodOf(PRESENCE_START, 'IDLE'), null);
});

test('blocks: first height is a baseline, increases say how many', () => {
  let r = stepBlocks(BLOCKS_START, 2037n, 'install-a');
  assert.equal(r.gained, null);
  r = stepBlocks(r.memory, 2070n, 'install-a');
  assert.deepEqual(r.gained, { count: 33n, first: 2038n, last: 2070n });
  r = stepBlocks(r.memory, 2070n, 'install-a');
  assert.equal(r.gained, null, 'same height is not news');
  r = stepBlocks(r.memory, 2071n, 'install-a');
  assert.deepEqual(r.gained, { count: 1n, first: 2071n, last: 2071n });
});

test('blocks: unknown keeps the baseline; decreases and new installations re-baseline', () => {
  let r = stepBlocks(BLOCKS_START, 100n, 'a');
  r = stepBlocks(r.memory, null, 'a');
  assert.equal(r.memory.height, 100n);
  r = stepBlocks(r.memory, 104n, 'a');
  assert.equal(r.gained?.count, 4n, 'an outage does not hide blocks settled meanwhile');
  r = stepBlocks(r.memory, 90n, 'a');
  assert.equal(r.gained, null);
  assert.equal(r.memory.height, 90n);
  r = stepBlocks(r.memory, 5000n, 'b');
  assert.equal(r.gained, null, 'a different installation starts fresh');
});

const ev = (id, type, occurredAt, payload = {}) => ({ id, type, occurredAt: Date.parse(occurredAt), payload });

test('events: only unseen events that happened after page load are admitted', () => {
  const openedAt = Date.parse('2026-10-28T21:00:00Z');
  const page1 = [
    ev('e3', 'measurement.speed_record', '2026-10-28T21:05:00Z', { recordMmPerSecond: '1700' }),
    ev('e2', 'measurement.distance_milestone', '2026-10-28T20:59:59Z', { thresholdDistanceMm: '15000000' }),
    ev('e1', 'measurement.daily_distance_milestone', '2026-10-28T21:01:00Z', { thresholdDistanceMm: '1000000' }),
  ];
  let r = admitEvents({ openedAt, seen: [] }, page1);
  assert.deepEqual(
    r.fresh.map((e) => e.id),
    ['e1', 'e3'],
    'oldest first, history skipped',
  );
  r = admitEvents(r.gate, [ev('e4', 'measurement.speed_milestone', '2026-10-28T21:06:00Z', { thresholdSpeedMmPerSecond: '1667' }), ...page1]);
  assert.deepEqual(
    r.fresh.map((e) => e.id),
    ['e4'],
    'repeats are deduplicated by id',
  );
});

test('events: unknown types are remembered but never aired', () => {
  const openedAt = 0;
  const r = admitEvents({ openedAt, seen: [] }, [ev('x', 'measurement.rpm_record', '2026-10-28T21:00:00Z')]);
  assert.deepEqual(r.fresh, []);
  assert.deepEqual(r.gate.seen, ['x']);
});

test('events: payload strings become exact bigints, bad payloads are dropped', () => {
  const record = alertFromEvent(
    ev('r', 'measurement.speed_record', '2026-10-27T21:19:52.920Z', {
      previousRecordMmPerSecond: '1554',
      recordMmPerSecond: '1600',
      observedSpeedMmPerSecond: '1600',
    }),
  );
  assert.equal(record?.kind, 'speed_record');
  assert.equal(record?.recordMmps, 1600n);
  assert.equal(record?.previousMmps, 1554n);

  const streak = alertFromEvent(
    ev('s', 'measurement.distance_streak', '2026-10-28T01:16:19.497Z', {
      days: 2,
      minimumDailyDistanceMm: '5000000',
      endingUtcDate: '2026-10-27',
    }),
  );
  assert.deepEqual(
    { days: streak?.days, min: streak?.minimumMm, end: streak?.endingUtcDate },
    { days: 2, min: 5000000n, end: '2026-10-27' },
  );

  assert.equal(alertFromEvent(ev('b', 'measurement.distance_milestone', '2026-10-28T00:00:00Z', { thresholdDistanceMm: 'lots' })), null);
  assert.equal(alertFromEvent(ev('c', 'measurement.speed_milestone', '2026-10-28T00:00:00Z', {})), null);
});

const blocks = (first, last) => ({ kind: 'blocks', key: `blocks:${first}-${last}`, count: BigInt(last - first + 1), first: BigInt(first), last: BigInt(last) });
const wake = (n) => ({ kind: 'wake', key: `wake:${n}`, at: n, rpmMilli: 90000 });

test('queue: same key never queues twice', () => {
  let q = enqueueAlert([], wake(1));
  q = enqueueAlert(q, wake(1));
  assert.equal(q.length, 1);
});

test('queue: waiting block alerts merge into one plate', () => {
  let q = enqueueAlert([], blocks(2038, 2070));
  q = enqueueAlert(q, wake(2));
  q = enqueueAlert(q, blocks(2071, 2080));
  assert.equal(q.length, 2);
  assert.equal(q[0].kind, 'blocks');
  assert.equal(q[0].count, 43n);
  assert.equal(q[0].first, 2038n);
  assert.equal(q[0].last, 2080n);
  assert.equal(q[1].kind, 'wake');
});

test('queue: when full, block alerts are dropped before anything else', () => {
  let q = enqueueAlert([], blocks(1, 5));
  for (let i = 0; i < QUEUE_LIMIT; i += 1) q = enqueueAlert(q, wake(i));
  assert.equal(q.length, QUEUE_LIMIT);
  assert.ok(q.every((a) => a.kind === 'wake'));
});

const telemetry = (over = {}) => ({
  freshness: 'online',
  observedAt: Date.parse('2026-10-28T21:38:10.361Z'),
  receivedAt: Date.parse('2026-10-28T21:38:10.667Z'),
  staleAfterSeconds: 120,
  coreStatus: 'IDLE',
  rpmMilli: 0,
  speedMmPerSecond: 0,
  distanceMm: 455682,
  provenance: 'hardware',
  ...over,
});

test('signal: tuning, ok, stale, silent and faulted feeds', () => {
  const now = Date.parse('2026-10-28T21:38:12Z');
  const base = { now, serverOffsetMs: 0, startedAt: now - 5 * S, lastOkAt: now - 1 * S, telemetry: telemetry() };
  assert.equal(assessSignal({ ...base, lastOkAt: null, telemetry: null }).state, 'tuning');
  assert.equal(assessSignal({ ...base, lastOkAt: null, telemetry: null, startedAt: now - 30 * S }).state, 'lost');
  assert.equal(assessSignal(base).state, 'ok');
  assert.equal(assessSignal({ ...base, telemetry: telemetry({ freshness: 'stale' }) }).reason, 'device-quiet');
  assert.equal(assessSignal({ ...base, now: now + 10 * 60 * S, lastOkAt: now + 10 * 60 * S }).reason, 'device-quiet');
  assert.equal(assessSignal({ ...base, lastOkAt: now - 25 * S }).reason, 'no-response');
  assert.equal(assessSignal({ ...base, telemetry: null }).reason, 'no-measurement');
  assert.equal(assessSignal({ ...base, telemetry: telemetry({ coreStatus: 'COUNTER_FAULT' }) }).state, 'fault');
});

test('wake hint: next busy slot, or overdue inside a usually-busy slot', () => {
  const slots = Array.from({ length: 48 }, (_, i) => {
    const minute = i * 30;
    const busy = minute >= 1260 || minute < 180;
    return { minute, meanWorkMilli: busy ? 1400000n : 0n };
  });
  assert.deepEqual(wakeHint(slots, Date.parse('2026-10-28T15:10:00Z')), { kind: 'later', minute: 1260 });
  assert.deepEqual(wakeHint(slots, Date.parse('2026-10-28T22:10:00Z')), { kind: 'overdue' });
  assert.equal(wakeHint([], Date.now()), null);
  assert.equal(wakeHint(slots.map((s) => ({ ...s, meanWorkMilli: 0n })), Date.now()), null);
});
