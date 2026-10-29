// Run tracking and the run recap: pure functions fed with plain numbers, plus
// one pass through the hub to check the recap airs before "back to bed".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addPoint,
  lastRunFromHalfHours,
  pictureOf,
  recapOf,
  RUN_START,
  runTotals,
  seedRun,
  speedHints,
  stepRun,
  travelled,
  wheelDayStart,
} from '../src/logic/run.ts';
import { readStats } from '../src/logic/wire.ts';
import { durationWords, stopwatch } from '../src/logic/units.ts';
import { describeAlert, emptyRunWords, runDistance, runNote } from '../src/logic/wording.ts';
import { Hub } from '../src/feed/hub.ts';

const S = 1000;
const MIN = 60 * S;
const timing = { endHoldMs: 180 * S, minRunMs: 60 * S };
const T0 = Date.parse('2026-10-28T21:00:00Z');

/**
 * Readings every 2 s from [fromSec, toSec, coreStatus, mm/s] spans. The day
 * counter grows by speed x 2 s per reading, like the real wheel. null core = lost signal.
 */
function script(spans, startMm = 455_682) {
  const out = [];
  let mm = startMm;
  for (const [from, to, core, mmps] of spans) {
    for (let t = from; t <= to; t += 2) {
      mm += mmps * 2;
      out.push(core === null ? null : { at: T0 + t * S, observedAt: T0 + t * S, coreStatus: core, mmps, dayMm: mm });
    }
  }
  return out;
}

function feed(readings, memory = RUN_START) {
  const ended = [];
  for (const r of readings) {
    const step = stepRun(memory, r, timing);
    memory = step.memory;
    if (step.ended) ended.push(step.ended);
  }
  return { memory, ended };
}

// ---------------------------------------------------------------- live tracking

test('run: starts on the first ACTIVE reading and ends after 3 minutes out of ACTIVE', () => {
  const { memory, ended } = feed(script([[0, 8, 'IDLE', 0], [10, 600, 'ACTIVE', 1400], [602, 780, 'IDLE', 0]]));
  assert.equal(ended.length, 0, '178 s of IDLE is still a breather');
  assert.equal(memory.current?.trackedFrom, T0 + 10 * S);
  assert.equal(memory.current?.joinedLate, false, 'he was asleep when the page tuned in');

  const done = feed(script([[782, 782, 'IDLE', 0]]), memory);
  assert.equal(done.ended.length, 1);
  const run = done.ended[0];
  assert.equal(run.endedAt, T0 + 600 * S, 'the run ends at the last ACTIVE reading, not when the hold ran out');
  assert.equal(run.distanceMm, 295 * 2800, 'every reading after the first adds its counter delta');
  assert.equal(run.topMmps, 1400);
  assert.ok(run.points.every((p) => p.t <= run.endedAt), 'the idle tail is trimmed from the trace');
  assert.equal(done.memory.current, null);
  assert.equal(done.memory.last, run);
});

test('run: a breather shorter than the hold stays inside one run', () => {
  const { ended } = feed(
    script([[10, 300, 'ACTIVE', 1400], [302, 400, 'IDLE', 0], [402, 600, 'ACTIVE', 1500], [602, 782, 'IDLE', 0]]),
  );
  assert.equal(ended.length, 1);
  const t = runTotals(ended[0], 0);
  assert.equal(t.durationMs, 590 * S);
  assert.equal(t.distanceMm, 145 * 2800 + 100 * 3000);
  assert.equal(t.topMmps, 1500);
  assert.equal(Math.round(t.avgMmps), Math.round((145 * 2800 + 100 * 3000) / 590));
  assert.ok(ended[0].points.some((p) => p.mmps === 0), 'the breather shows on the trace');
});

test('run: a lost signal keeps the run open and restarts the stop hold', () => {
  const before = feed(script([[10, 300, 'ACTIVE', 1400], [302, 400, 'IDLE', 0], [402, 700, null, 0], [702, 880, 'IDLE', 0]]));
  assert.equal(before.ended.length, 0, 'without the outage the run would have ended at 482 s');
  const after = feed(script([[882, 882, 'IDLE', 0]]), before.memory);
  assert.equal(after.ended.length, 1, 'the hold counts from the first IDLE reading after the outage');
});

test('run: a twitch of the wheel is dropped and never replaces the last real run', () => {
  const real = feed(script([[10, 600, 'ACTIVE', 1400], [602, 782, 'IDLE', 0]]));
  const twitch = feed(script([[1000, 1030, 'ACTIVE', 1400], [1032, 1212, 'IDLE', 0]]), real.memory);
  assert.equal(twitch.ended.length, 0, '30 s on the wheel gets no recap');
  assert.equal(twitch.memory.last, real.memory.last);
});

test('run: tuning in while he is already running marks the run as joined late', () => {
  const { memory } = feed(script([[0, 60, 'ACTIVE', 1400]]));
  assert.equal(memory.current?.joinedLate, true);
  const t = runTotals(memory.current, T0 + 60 * S);
  assert.equal(t.partial, true);
  assert.equal(t.estimated, false);
  const lostFirst = feed([null, ...script([[4, 60, 'ACTIVE', 1400]])]);
  assert.equal(lostFirst.memory.current?.joinedLate, true, 'a lost first reading does not count as seeing him start');
});

test('run: the same measurement polled twice is counted once', () => {
  const r = { at: T0, observedAt: T0, coreStatus: 'ACTIVE', mmps: 1400, dayMm: 1_000_000 };
  let m = stepRun(RUN_START, r, timing).memory;
  m = stepRun(m, { ...r, at: T0 + 2 * S, observedAt: T0 + 2 * S, dayMm: 1_002_800 }, timing).memory;
  const again = stepRun(m, { ...r, at: T0 + 4 * S, observedAt: T0 + 2 * S, dayMm: 1_002_800 }, timing).memory;
  assert.equal(again.current?.distanceMm, 2800);
  assert.equal(again.current?.points.length, 2);
});

test('run: the noon roll-over and counter jumps do not corrupt the distance', () => {
  assert.equal(travelled(1_000, 3_800, 2 * S), 2_800);
  assert.equal(travelled(9_295_386, 1_200, 2 * S), 1_200, 'noon: the counter restarts from zero');
  assert.equal(travelled(1_000, 50_000_000, 2 * S), 0, 'no hamster covers 50 km in 2 s');
  assert.equal(travelled(1_000, 1_000 + 2_400_000, 10 * MIN), 2_400_000, 'a long outage can legitimately hide distance');
  const glitch = feed(script([[10, 20, 'ACTIVE', 1400]]));
  const after = stepRun(glitch.memory, { at: T0 + 22 * S, observedAt: T0 + 22 * S, coreStatus: 'ACTIVE', mmps: 65_535, dayMm: 0 }, timing);
  assert.equal(after.memory.current?.topMmps, 1400, 'an impossible speed is not a record');
});

test('run: the speed trace thins out past its cap but keeps the newest sample', () => {
  let points = [];
  for (let i = 0; i < 1000; i += 1) points = addPoint(points, { t: i, mmps: i }, 100);
  assert.ok(points.length <= 100);
  assert.deepEqual(points[points.length - 1], { t: 999, mmps: 999 });
  assert.ok(points.every((p, i) => i === 0 || p.t > points[i - 1].t), 'still in time order');
});

// ---------------------------------------------------------------- recap

test('recap: distance, duration and top speed of a finished run; short runs get none', () => {
  const { ended } = feed(script([[0, 8, 'IDLE', 0], [10, 600, 'ACTIVE', 1400], [602, 782, 'IDLE', 0]]));
  const recap = recapOf(ended[0], timing);
  assert.deepEqual(recap, {
    startedAt: T0 + 10 * S,
    endedAt: T0 + 600 * S,
    durationMs: 590 * S,
    distanceMm: 826_000,
    topMmps: 1400,
    estimated: false,
    partial: false,
  });
  const copy = describeAlert({ kind: 'run_recap', key: 'k', at: recap.endedAt, ...recap });
  assert.equal(copy.tag, 'Run recap');
  assert.equal(copy.headline, '826 metres', 'plates are set in capitals, where "826 M" would read as millions');
  assert.equal(copy.detail, '9 min 50 s on the wheel, top speed 5.0 km/h. Started 21:00 UTC.');
  const shortRun = { ...ended[0], endedAt: ended[0].trackedFrom + 30 * S };
  assert.equal(recapOf(shortRun, timing), null);
});

test('recap: estimated and partial runs say so on air', () => {
  const base = { kind: 'run_recap', key: 'k', at: 0, startedAt: Date.parse('2026-10-28T21:42:00Z'), durationMs: 41 * MIN, topMmps: 1590 };
  const est = describeAlert({ ...base, distanceMm: 2_310_400, estimated: true, partial: false });
  assert.equal(est.headline, 'About 2.31 km');
  assert.match(est.detail, /^41 min on the wheel, top speed 5\.7 km\/h\. Start estimated/);
  const part = describeAlert({ ...base, distanceMm: 2_310_400, estimated: false, partial: true, topMmps: null });
  assert.equal(part.detail, '41 min on the wheel. Counted from 21:42 UTC, when this source tuned in.');
});

// ---------------------------------------------------------------- estimates from half-hour totals

const H = 30 * MIN;
const halfHours = (startIso, works) => works.map((work, k) => ({ from: Date.parse(startIso) + k * H, to: Date.parse(startIso) + (k + 1) * H, work }));
const scale = { mmPerWork: 878, fullHalfHourWork: 1827 };

// The evening of 28 Oct 2026 as the live stats feed reported it.
const EVENING = halfHours('2026-10-28T20:00:00Z', [0, 0, 469, 50, 0, 1512, 1597, 1595]);

test('seed: a run joined at 23:47 is traced back to the start of its busy stretch', () => {
  const trackedFrom = Date.parse('2026-10-28T23:47:00Z');
  const dayMmAtStart = (519 + 4704 + 100) * 878; // the evening so far plus the open round
  const seed = seedRun({
    ...scale,
    halfHours: EVENING,
    trackedFrom,
    dayMmAtStart,
    dayStartMinute: 720,
    hints: [
      { at: Date.parse('2026-10-28T21:28:20Z'), mmps: 1628 },
      { at: Date.parse('2026-10-28T23:10:00Z'), mmps: 1580 },
    ],
  });
  assert.ok(seed);
  // 1512 work is about 25 minutes of steady running, packed against the end of the 22:30 half hour.
  assert.ok(Math.abs(seed.startedAt - Date.parse('2026-10-28T22:35:10Z')) < S);
  assert.equal(seed.distanceMm, (4704 + 100) * 878, 'the day counter minus what the day logged before the stretch');
  assert.equal(seed.topMmps, 1580, 'only speeds reported inside the run count');
  assert.equal(seed.bars.length, 3);
  assert.equal(seed.bars[2].to, trackedFrom, 'the estimate reaches the moment live tracking took over');
  assert.ok(seed.bars.every((b) => b.mmps <= 1628), 'no half-hour average beats the fastest speed on record');
});

test('seed: early in a half hour the previous one stands in; later an empty one means he just started', () => {
  const hh = halfHours('2026-10-28T20:00:00Z', [0, 300, 0]);
  const input = { ...scale, halfHours: hh, dayMmAtStart: 300 * 878, dayStartMinute: 720, hints: [] };
  const early = seedRun({ ...input, trackedFrom: Date.parse('2026-10-28T21:03:00Z') });
  assert.ok(early);
  assert.ok(early.startedAt >= Date.parse('2026-10-28T20:30:00Z') && early.startedAt < Date.parse('2026-10-28T21:00:00Z'));
  assert.equal(seedRun({ ...input, trackedFrom: Date.parse('2026-10-28T21:20:00Z') }), null);
  assert.equal(seedRun({ ...input, halfHours: halfHours('2026-10-28T20:00:00Z', [0, 0, 0]), trackedFrom: Date.parse('2026-10-28T21:03:00Z') }), null);
  assert.equal(seedRun({ ...input, halfHours: [], trackedFrom: Date.parse('2026-10-28T21:03:00Z') }), null);
});

test('history: the last run on record, with blips and unfinished half hours ignored', () => {
  // 28 Oct 21:00 to 29 Oct 06:30, as served at 06:25 UTC on the 29th.
  const night = halfHours('2026-10-28T21:00:00Z', [469, 50, 0, 1512, 1597, 1595, 1332, 1170, 1330, 0, 0, 0, 0, 390, 1142, 0, 0, 0, 20, null]);
  const past = lastRunFromHalfHours({ ...scale, halfHours: night, now: Date.parse('2026-10-29T06:25:00Z'), hints: [] });
  assert.ok(past);
  assert.equal(past.distanceMm, 1532 * 878);
  assert.ok(Math.abs(past.startedAt - Date.parse('2026-10-29T03:53:36Z')) < S);
  assert.ok(Math.abs(past.endedAt - Date.parse('2026-10-29T04:18:45Z')) < S);
  assert.equal(past.topMmps, null, 'no speed was reported inside it');
  assert.equal(lastRunFromHalfHours({ ...scale, halfHours: halfHours('2026-10-28T21:00:00Z', [0, 30, 0]), now: Date.now(), hints: [] }), null);
});

test('stats: half-hour buckets land on real time, noon to noon', () => {
  const s = readStats({
    window: { startAt: '2026-10-22T12:00:00.000Z', bucketSeconds: 1800, roundSeconds: 600 },
    lifetime: { acceptedWorkUnits: '32660', observedDistanceMm: '28675480', settledBlockCount: '2994', settlementCount: '343' },
    records: { mostWorkHalfHour: { value: '1827', occurredAt: '2026-10-27T22:00:00.000Z', coverage: 'complete' } },
    activity: {
      days: [
        {
          date: '2026-10-27',
          buckets: [
            { startMinuteUtc: 30, coverage: 'complete', observedRoundCount: 3, workUnits: '1148' },
            { startMinuteUtc: 1320, coverage: 'complete', observedRoundCount: 3, workUnits: '1827' },
            { startMinuteUtc: 1350, coverage: 'future', observedRoundCount: 0, workUnits: null },
            { startMinuteUtc: 'soon', coverage: 'complete', workUnits: '5' },
          ],
        },
      ],
    },
  });
  assert.equal(s.dayStartMinute, 720);
  assert.deepEqual(
    s.halfHours.map((h) => [new Date(h.from).toISOString(), h.work]),
    [
      ['2026-10-27T22:00:00.000Z', 1827],
      ['2026-10-27T22:30:00.000Z', null],
      ['2026-10-28T00:30:00.000Z', 1148],
    ],
    'a bucket before noon belongs to the next morning',
  );
  assert.equal(wheelDayStart(Date.parse('2026-10-29T06:25:00Z'), 720), Date.parse('2026-10-28T12:00:00Z'));
  assert.deepEqual(speedHints(s, []), [], 'no 7-day speed record in this response');
  const hints = speedHints(s, [
    { id: 'a', type: 'measurement.speed_record', occurredAt: 5, payload: { recordMmPerSecond: '1600' } },
    { id: 'b', type: 'measurement.distance_milestone', occurredAt: 6, payload: { thresholdDistanceMm: '1000000' } },
  ]);
  assert.deepEqual(hints, [{ at: 5, mmps: 1600 }]);
});

// ---------------------------------------------------------------- what the card shows

test('picture: the run in progress, else the last one watched, else the one on record', () => {
  const live = feed(script([[10, 300, 'ACTIVE', 1400]]));
  const p = pictureOf(live.memory, null, T0 + 302 * S);
  assert.equal(p.phase, 'running');
  assert.equal(p.source, 'live');
  assert.equal(p.durationMs, 292 * S, 'the clock runs to now');
  const paused = feed(script([[302, 320, 'IDLE', 0]]), live.memory);
  assert.equal(pictureOf(paused.memory, null, T0 + 322 * S).phase, 'paused');

  const past = { startedAt: 0, endedAt: 25 * MIN, distanceMm: 1_345_096, topMmps: null, topAt: null, bars: [] };
  const history = pictureOf(RUN_START, past, 30 * MIN);
  assert.equal(history.source, 'history');
  assert.equal(history.estimated, true);
  assert.equal(runNote(history), 'Pieced together from half-hour totals, so times are approximate.');
  assert.equal(pictureOf(RUN_START, null, 0), null);
});

test('words: run clock, spoken durations, distance and the empty card', () => {
  assert.equal(stopwatch(41 * MIN + 7 * S), '41:07');
  assert.equal(stopwatch(72 * MIN + 7 * S), '1:12:07');
  assert.equal(stopwatch(42 * S), '0:42');
  assert.equal(durationWords(45 * S), '45 s');
  assert.equal(durationWords(252 * S), '4 min 12 s');
  assert.equal(durationWords(41 * MIN), '41 min');
  assert.equal(durationWords(72 * MIN), '1 h 12 min');
  assert.deepEqual(runDistance(640_400), { value: '640', unit: 'm' });
  assert.deepEqual(runDistance(2_310_400), { value: '2.31', unit: 'km' });
  assert.deepEqual(runDistance(null), { value: '--', unit: 'km' });
  const ok = { state: 'ok', reason: null, lastSeenAt: 0 };
  const asleep = emptyRunWords({ signal: ok, mood: 'asleep', hint: { kind: 'later', minute: 1260 }, historyKnown: false });
  assert.deepEqual(asleep, { title: "Wheel's quiet", detail: 'Squeektoshi is asleep. Usually up around 21:00 UTC.' });
  assert.equal(emptyRunWords({ signal: { state: 'tuning', reason: 'connecting', lastSeenAt: null }, mood: null, hint: null, historyKnown: false }).title, 'Tuning in');
});

// ---------------------------------------------------------------- through the hub

test('hub: the recap airs before "back to bed", once, with the run in the card', () => {
  const hub = new Hub({ demo: false, timing: { wakeHoldMs: 60 * S, sleepHoldMs: 180 * S } });
  const aired = [];
  hub.onAlert((a) => aired.push(a));
  const base = Date.now();
  let mm = 455_682;
  const poll = (sec, core, mmps) => {
    const at = base + sec * S;
    mm += mmps * 2;
    const snap = {
      installationId: 'x',
      generatedAt: at,
      telemetry: {
        freshness: 'online',
        observedAt: at - 300,
        receivedAt: at - 200,
        staleAfterSeconds: 120,
        coreStatus: core,
        rpmMilli: Math.round((mmps / 878) * 60_000),
        speedMmPerSecond: mmps,
        distanceMm: mm,
        provenance: 'hardware',
      },
      builder: { ok: false, reason: 'unavailable' },
    };
    hub.statusOk(snap, true, at);
  };
  poll(0, 'IDLE', 0);
  for (let t = 10; t <= 600; t += 2) poll(t, 'ACTIVE', 1400);
  assert.equal(hub.snapshot(base + 600 * S).run?.phase, 'running');
  for (let t = 602; t <= 900; t += 2) poll(t, 'IDLE', 0);
  assert.deepEqual(
    aired.map((a) => a.kind),
    ['wake', 'run_recap', 'sleep'],
  );
  const recap = aired[1];
  assert.equal(recap.distanceMm, 295 * 2800);
  assert.equal(recap.durationMs, 590 * S);
  const card = hub.snapshot(base + 900 * S).run;
  assert.equal(card?.phase, 'finished');
  assert.equal(card?.distanceMm, recap.distanceMm);
});
