// Numbers, copy, links and retry timing: unknown stays unknown, big values stay exact.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { big, km, kmh, rpm, scaled, sqk, ago, dayLabel, UNKNOWN } from '../src/logic/units.ts';
import { describeAlert, settledLine, tickerFacts, progressWords } from '../src/logic/wording.ts';
import { readOptions, sceneQuery, DEFAULTS } from '../src/logic/options.ts';
import { nextDistanceMilestoneMm } from '../src/logic/samples.ts';
import { nextDelay, retryAfterMs } from '../src/logic/backoff.ts';

test('units: decimal strings parse exactly, junk does not', () => {
  assert.equal(big('8106342287849137164202742'), 8106342287849137164202742n);
  assert.equal(big(455682), 455682n);
  assert.equal(big('-5'), null);
  assert.equal(big('1e9'), null);
  assert.equal(big(1.5), null);
  assert.equal(big(null), null);
});

test('units: on-air figures', () => {
  assert.equal(km(19835776n), '19.84');
  assert.equal(km(455682), '0.46');
  assert.equal(kmh(1628), '5.9');
  assert.equal(kmh(1667, 0), '6');
  assert.equal(rpm(111256), '111');
  assert.equal(scaled(2070384421937n, 0, 0), '2,070,384,421,937');
  assert.equal(sqk(8106342287849137164202742n), '8.11M');
  assert.equal(sqk(131325132792843164663078n), '131,325');
  assert.equal(ago(9 * 60_000), '9 min ago');
  assert.equal(ago(10_000), 'just now');
  assert.equal(dayLabel('2026-10-27'), 'Oct 27');
});

test('units: unknown is never printed as zero', () => {
  assert.equal(km(null), UNKNOWN);
  assert.equal(kmh(undefined), UNKNOWN);
  assert.equal(rpm(null), UNKNOWN);
  assert.equal(sqk(null), UNKNOWN);
  assert.equal(progressWords(null).height, UNKNOWN);
  assert.equal(progressWords({ builder: { ok: false, reason: 'counter_fault' } }).fraction, null);
});

test('copy: block alerts count properly', () => {
  const one = describeAlert({ kind: 'blocks', key: 'k', count: 1n, first: 2071n, last: 2071n });
  assert.equal(one.headline, '+1 block');
  assert.equal(one.detail, 'Block #2,071 settled on Sepolia.');
  const many = describeAlert({ kind: 'blocks', key: 'k', count: 33n, first: 2038n, last: 2070n });
  assert.equal(many.headline, '+33 blocks');
  assert.match(many.detail, /#2,038 to #2,070/);
});

test('copy: records and milestones read like a broadcast', () => {
  const rec = describeAlert({ kind: 'speed_record', key: 'r', at: 0, recordMmps: 1700n, previousMmps: 1628n });
  assert.equal(rec.headline, '6.1 km/h');
  assert.match(rec.detail, /Old mark: 5\.9 km\/h/);
  const mile = describeAlert({ kind: 'distance_milestone', key: 'm', at: 0, thresholdMm: 20_000_000n, observedMm: null });
  assert.equal(mile.headline, '20 km');
  assert.match(mile.detail, /47% of a marathon/);
  const streak = describeAlert({ kind: 'distance_streak', key: 's', at: 0, days: 3, minimumMm: 5_000_000n, endingUtcDate: '2026-10-27' });
  assert.equal(streak.headline, '3 days in a row');
  assert.match(streak.detail, /5 km or more every day through Oct 27/);
});

const status = {
  installationId: 'x',
  generatedAt: 0,
  telemetry: {
    freshness: 'online',
    observedAt: 0,
    receivedAt: 0,
    staleAfterSeconds: 120,
    coreStatus: 'IDLE',
    rpmMilli: 0,
    speedMmPerSecond: 0,
    distanceMm: 455682,
    provenance: 'hardware',
  },
  builder: {
    ok: true,
    anchor: {
      settledThroughRound: 334n,
      cumulativeWork: 22542n,
      blockHeight: 2070n,
      blockProgress: 384421937n,
      workPerThousandBlocks: 10875n,
      confirmedAt: Date.parse('2026-10-28T21:30:36Z'),
      transactionHash: null,
    },
    projected: { blockHeight: 2074n, blockProgress: 982123086n },
  },
};

test('copy: settlement freshness and lateness', () => {
  const fresh = settledLine(status, Date.parse('2026-10-28T21:39:36Z'));
  assert.deepEqual(fresh, { text: 'Round 334 settled 9 min ago', late: false });
  const late = settledLine(status, Date.parse('2026-10-28T22:05:36Z'));
  assert.equal(late?.late, true);
  assert.equal(progressWords(status).next, '38% to #2,071');
});

test('ticker: live facts disappear when the signal is lost', () => {
  const input = {
    serverNow: Date.parse('2026-10-28T21:40:00Z'),
    status,
    signal: { state: 'ok', reason: null, lastSeenAt: 0 },
    mood: 'asleep',
    stats: null,
    settlements: null,
    economy: null,
    hint: { kind: 'later', minute: 1260 },
  };
  const ok = tickerFacts(input);
  assert.ok(ok.some((f) => f.key === 'today'));
  assert.match(ok.find((f) => f.key === 'now')?.text ?? '', /asleep\. Usually back on the wheel around 21:00 UTC/);
  assert.ok(ok.some((f) => f.key === 'queued'), 'projected blocks become a fact');

  const lost = tickerFacts({ ...input, signal: { state: 'lost', reason: 'device-quiet', lastSeenAt: 0 }, mood: null });
  assert.ok(!lost.some((f) => f.key === 'today'));
  assert.match(lost.find((f) => f.key === 'now')?.text ?? '', /Signal lost/);
  assert.ok(!lost.some((f) => /\b0\.00 km\b/.test(f.text)));
});

test('options: URL params in, OBS links out', () => {
  const o = readOptions('?scene=bug&theme=light&scale=9&corner=bl&sound=1&demo=1&mute=blocks,nope,wake&motion=reduce');
  assert.equal(o.scene, 'bug');
  assert.equal(o.theme, 'light');
  assert.equal(o.scale, 2);
  assert.equal(o.corner, 'bl');
  assert.equal(o.sound, true);
  assert.equal(o.demo, true);
  assert.deepEqual(o.mute, ['wake', 'blocks']);
  assert.equal(o.calm, true);
  assert.equal(readOptions('?scene=nope').scene, null);
  assert.equal(sceneQuery('gauge', { ...DEFAULTS }), '?scene=gauge');
  assert.equal(
    sceneQuery('alerts', { ...DEFAULTS, sound: true, mute: ['blocks', 'sleep'], corner: 'bl' }),
    '?scene=alerts&sound=1&mute=sleep,blocks',
  );
  assert.equal(sceneQuery('bug', { ...DEFAULTS, corner: 'bl', sound: true }), '?scene=bug&corner=bl');
});

test('options: the run card and the program composite get the right link settings', () => {
  assert.equal(readOptions('?scene=run&demo=1').scene, 'run');
  assert.deepEqual(readOptions('?scene=alerts&mute=run_recap').mute, ['run_recap']);
  assert.equal(sceneQuery('run', { ...DEFAULTS, corner: 'bl', sound: true, mute: ['run_recap'] }), '?scene=run');
  assert.equal(
    sceneQuery('program', { ...DEFAULTS, corner: 'tl', sound: true, mute: ['run_recap'] }),
    '?scene=program&corner=tl&sound=1&mute=run_recap',
  );
});

test('samples: next lifetime milestone follows the API ladder', () => {
  assert.equal(nextDistanceMilestoneMm(19_835_776n), 20_000_000n);
  assert.equal(nextDistanceMilestoneMm(20_000_000n), 30_000_000n);
  assert.equal(nextDistanceMilestoneMm(100_000_000n), 150_000_000n);
  assert.equal(nextDistanceMilestoneMm(0n), 1_000_000n);
});


test('backoff: doubles per miss, caps, jitters, and honours Retry-After', () => {
  assert.equal(nextDelay(2000, 30000, 0, null, 0.5), 2000);
  assert.equal(nextDelay(2000, 30000, 1, null, 0.5), 4000);
  assert.equal(nextDelay(2000, 30000, 3, null, 0.5), 16000);
  assert.equal(nextDelay(2000, 30000, 9, null, 0.5), 30000);
  assert.equal(nextDelay(2000, 30000, 9, null, 0), 25500);
  assert.equal(nextDelay(2000, 30000, 9, null, 1), 34500);
  assert.equal(nextDelay(2000, 30000, 1, 7000, 0.5), 7000, '429 Retry-After wins over a shorter backoff');
  assert.equal(retryAfterMs('7', 0), 7000);
  assert.equal(retryAfterMs('100000', 0), 600000, 'capped at ten minutes');
  assert.equal(retryAfterMs('Wed, 28 Oct 2026 21:40:10 GMT', Date.parse('2026-10-28T21:40:00Z')), 10000);
  assert.equal(retryAfterMs(null, 0), null);
  assert.equal(retryAfterMs('soon', 0), null);
});
