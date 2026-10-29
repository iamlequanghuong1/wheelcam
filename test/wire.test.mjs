// API readers against trimmed copies of real responses (28 Oct 2026).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEconomy, readEvents, readSettlements, readStats, readStatus, WireError } from '../src/logic/wire.ts';

const STATUS = {
  schemaVersion: 1,
  installationId: 'stream-game-sepolia-test-20261025-01',
  generatedAt: '2026-10-28T21:38:20.746Z',
  measurement: {
    freshness: 'online',
    observedAt: '2026-10-28T21:38:10.361Z',
    receivedAt: '2026-10-28T21:38:10.667Z',
    staleAfterSeconds: 120,
    counterEpoch: 'c011f01a-93ba-45ff-8579-619ddfdf40ec',
    cumulativeWorkUnits: '22592',
    provenance: 'hardware',
    coreStatus: 'IDLE',
    rpmMilli: 0,
    speedMmPerSecond: 0,
    distanceMm: 455682,
  },
  builder: {
    status: 'available',
    anchor: {
      cumulativeWork: '22542',
      cumulativeBlockUnits: '2070384421937',
      blockHeight: '2070',
      blockProgress: '384421937',
      workPerThousandBlocks: '10875',
      settledThroughRound: '334',
      confirmedAt: '2026-10-28T21:30:36.000Z',
      transactionHash: '0x1f511c4ad4ba5d3c9d2db905afbf609ff17d4e9d956e18390fb357f3c33e17db',
    },
    queued: { closedRoundCount: '0', closedWorkUnits: '0', openRoundWorkUnits: '50' },
    projected: { cumulativeWork: '22592', blockHeight: '2074', blockProgress: '982123086', lifecycle: 'optimistic' },
  },
};

test('status: real response parses with exact bigints', () => {
  const s = readStatus(STATUS);
  assert.equal(s.telemetry?.coreStatus, 'IDLE');
  assert.equal(s.telemetry?.distanceMm, 455682);
  assert.equal(s.telemetry?.receivedAt, Date.parse('2026-10-28T21:38:10.667Z'));
  assert.ok(s.builder.ok);
  assert.equal(s.builder.anchor.blockHeight, 2070n);
  assert.equal(s.builder.anchor.blockProgress, 384421937n);
  assert.equal(s.builder.anchor.settledThroughRound, 334n);
  assert.equal(s.builder.projected?.blockHeight, 2074n);
});

test('status: unavailable builder and missing measurement are unknown, not zero', () => {
  const s = readStatus({ ...STATUS, measurement: null, builder: { status: 'unavailable', reason: 'counter_fault' } });
  assert.equal(s.telemetry, null);
  assert.deepEqual(s.builder, { ok: false, reason: 'counter_fault' });
});

test('status: a response that does not match is an error', () => {
  assert.throws(() => readStatus({ ...STATUS, measurement: { ...STATUS.measurement, rpmMilli: '0' } }), WireError);
  assert.throws(
    () => readStatus({ ...STATUS, builder: { ...STATUS.builder, anchor: { ...STATUS.builder.anchor, blockHeight: 2070.5 } } }),
    WireError,
  );
  assert.throws(() => readStatus('nope'), WireError);
});

test('events: unavailable feed and events without ids', () => {
  assert.deepEqual(readEvents({ status: 'unavailable', reason: 'not_yet_safe' }), {
    available: false,
    reason: 'not_yet_safe',
    events: [],
  });
  const e = readEvents({
    status: 'available',
    events: [
      { id: 'a', type: 'measurement.speed_record', occurredAt: '2026-10-27T21:19:52.920Z', payload: { recordMmPerSecond: '1600' } },
      { type: 'measurement.speed_record', occurredAt: '2026-10-27T21:19:52.920Z' },
      { id: 'b', type: 'measurement.speed_record', occurredAt: 'yesterday' },
    ],
  });
  assert.deepEqual(
    e.events.map((x) => x.id),
    ['a'],
  );
  assert.throws(() => readEvents({ status: 'available' }), WireError);
});

test('stats: lifetime, records (null allowed) and the typical day', () => {
  const s = readStats({
    lifetime: {
      acceptedWorkUnits: '22542',
      observedDistanceMm: '19835776',
      activeDayCount: 3,
      settledBlockCount: '2070',
      settlementCount: '291',
    },
    records: {
      peakObservedSpeedMmPerSecond: { value: '1628', occurredAt: '2026-10-28T21:28:20.307Z', coverage: 'partial' },
      peakObservedRpmMilli: { value: '111256', occurredAt: '2026-10-28T21:28:20.307Z', coverage: 'partial' },
      mostWorkHalfHour: null,
    },
    activity: { typicalDay: [{ startMinuteUtc: 1320, meanWorkMilli: '1456666' }] },
  });
  assert.equal(s.lifetime?.distanceMm, 19835776n);
  assert.equal(s.records.topSpeedMmps?.value, 1628n);
  assert.equal(s.records.busiestHalfHourWork, null);
  assert.equal(s.records.longestStreakDays, null);
  assert.deepEqual(s.typicalDay, [{ minute: 1320, meanWorkMilli: 1456666n }]);
  assert.throws(() => readStats({ records: {} }), WireError);
});

test('settlements and economy', () => {
  const s = readSettlements({
    status: 'available',
    recentSettlements: [
      {
        settledThroughRound: '334',
        completedBlockCount: '33',
        workAdded: '363',
        blockTimestamp: '2026-10-28T21:30:36.000Z',
        sqkMintedBaseUnits: '131325132792843164663078',
        transactionHash: '0x1f51',
      },
    ],
  });
  assert.equal(s.latest?.completedBlockCount, 33n);
  assert.equal(s.latest?.sqkMinted, 131325132792843164663078n);
  assert.equal(readSettlements({ status: 'available', recentSettlements: [] }).latest, null);
  const e = readEconomy({ status: 'available', supply: { totalMintedBaseUnits: '8106342287849137164202742' } });
  assert.equal(e.totalMinted, 8106342287849137164202742n);
  assert.equal(readEconomy({ status: 'unavailable', reason: 'not_yet_safe' }).totalMinted, null);
});
