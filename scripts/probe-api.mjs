#!/usr/bin/env node
// Checks that the live Squeekchain API still serves every field WheelCam reads,
// that ETag revalidation answers 304, and that CORS exposes the headers the
// browser needs. Then runs the overlay's own readers over the same responses.
//
//   npm run probe            (uses https://api.squeekchain.com/v1)
//   SQUEEK_API=... npm run probe
//
// Exit code 1 when a field the graphics depend on is missing or mistyped.
// A hamster that is asleep is normal and is not a failure.

import { readEconomy, readEvents, readSettlements, readStats, readStatus } from '../src/logic/wire.ts';

const BASE = (process.env.SQUEEK_API || 'https://api.squeekchain.com/v1').replace(/\/+$/, '');
const ORIGIN = 'http://localhost:5173'; // any page origin; the API answers CORS with *

const isDecimal = (v) => typeof v === 'string' && /^\d+$/.test(v);
const isTime = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';
const isRecord = (v) => v === null || (typeof v === 'object' && isDecimal(v.value));

let failures = 0;
const lines = [];

function at(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function expect(label, obj, path, check, kind, optional = false) {
  const v = at(obj, path);
  const ok = check(v) || (optional && v === undefined);
  if (!ok) failures += 1;
  lines.push(`  ${ok ? 'ok     ' : 'MISSING'} ${label}.${path} (${kind})${ok ? '' : ` got ${JSON.stringify(v)}`}`);
}

async function get(path) {
  const url = BASE + path;
  const res = await fetch(url, { headers: { Origin: ORIGIN, Accept: 'application/json' } });
  const etag = res.headers.get('etag');
  const body = await res.json();
  let revalidated = 'no ETag';
  if (etag) {
    const again = await fetch(url, { headers: { Origin: ORIGIN, 'If-None-Match': etag } });
    revalidated = again.status === 304 ? '304 on If-None-Match' : `HTTP ${again.status} on If-None-Match (content moved on)`;
  }
  const exposed = (res.headers.get('access-control-expose-headers') || '').toLowerCase();
  const cors = res.headers.get('access-control-allow-origin');
  console.log(`\n${path}`);
  console.log(`  HTTP ${res.status}, ${res.headers.get('cache-control')}, ${revalidated}`);
  console.log(`  CORS allow-origin=${cors}, ETag exposed=${exposed.includes('etag')}, Retry-After exposed=${exposed.includes('retry-after')}`);
  if (res.status !== 200) failures += 1;
  if (cors !== '*' || !exposed.includes('etag')) failures += 1;
  return body;
}

function flush() {
  for (const l of lines.splice(0)) console.log(l);
}

function parsedWith(name, reader, body) {
  try {
    const out = reader(body);
    console.log(`  reader ${name}: ok`);
    return out;
  } catch (err) {
    failures += 1;
    console.log(`  reader ${name}: FAILED ${err.message}`);
    return null;
  }
}

console.log(`WheelCam API probe against ${BASE}`);

// ---------------------------------------------------------------- /status
const status = await get('/status');
if (status.measurement === null) {
  console.log('  measurement is null: the overlay will show SIGNAL LOST (valid, but unusual)');
} else {
  for (const [p, c, k] of [
    ['measurement.freshness', isStr, 'online|stale'],
    ['measurement.observedAt', isTime, 'ISO time'],
    ['measurement.receivedAt', isTime, 'ISO time'],
    ['measurement.staleAfterSeconds', isNum, 'seconds'],
    ['measurement.coreStatus', isStr, 'IDLE|ACTIVE|COUNTER_FAULT'],
    ['measurement.rpmMilli', isNum, 'integer'],
    ['measurement.speedMmPerSecond', isNum, 'integer'],
    ['measurement.distanceMm', isNum, 'integer'],
    ['measurement.provenance', isStr, 'string'],
  ]) expect('status', status, p, c, k);
}
expect('status', status, 'generatedAt', isTime, 'ISO time');
expect('status', status, 'builder.status', isStr, 'available|unavailable');
if (status.builder?.status === 'available') {
  for (const p of ['settledThroughRound', 'cumulativeWork', 'blockHeight', 'blockProgress', 'workPerThousandBlocks']) {
    expect('status', status, `builder.anchor.${p}`, isDecimal, 'decimal string');
  }
  expect('status', status, 'builder.anchor.confirmedAt', isTime, 'ISO time');
  expect('status', status, 'builder.projected.blockHeight', isDecimal, 'decimal string');
  expect('status', status, 'builder.projected.blockProgress', isDecimal, 'decimal string');
} else {
  console.log(`  builder unavailable (${status.builder?.reason}): block height will show as unknown`);
}
flush();
const s = parsedWith('readStatus', readStatus, status);

// ---------------------------------------------------------------- /events
const events = await get('/events?category=measurement&limit=40');
expect('events', events, 'status', isStr, 'available|unavailable');
if (events.status === 'available') {
  expect('events', events, 'events', Array.isArray, 'array');
  const payloadFields = {
    'measurement.distance_milestone': ['thresholdDistanceMm'],
    'measurement.daily_distance_milestone': ['thresholdDistanceMm', 'observedDayDistanceMm'],
    'measurement.speed_milestone': ['thresholdSpeedMmPerSecond', 'observedSpeedMmPerSecond'],
    'measurement.speed_record': ['recordMmPerSecond', 'previousRecordMmPerSecond'],
    'measurement.distance_streak': ['minimumDailyDistanceMm'],
  };
  const seenTypes = new Set();
  for (const ev of events.events || []) {
    if (!isStr(ev.id) || !isStr(ev.type) || !isTime(ev.occurredAt)) {
      failures += 1;
      lines.push(`  MISSING id/type/occurredAt on ${JSON.stringify(ev).slice(0, 80)}`);
      continue;
    }
    if (seenTypes.has(ev.type)) continue;
    seenTypes.add(ev.type);
    for (const f of payloadFields[ev.type] || []) expect(`events[${ev.type}]`, ev, `payload.${f}`, isDecimal, 'decimal string');
    if (ev.type === 'measurement.distance_streak') expect(`events[${ev.type}]`, ev, 'payload.days', (v) => isNum(v) || isDecimal(v), 'integer');
  }
  lines.push(`  ${events.events.length} events, types present: ${[...seenTypes].join(', ') || 'none'}`);
}
flush();
parsedWith('readEvents', readEvents, events);

// ---------------------------------------------------------------- /measurement/stats
const stats = await get('/measurement/stats?range=7d');
for (const p of ['observedDistanceMm', 'acceptedWorkUnits', 'settledBlockCount', 'settlementCount']) {
  expect('stats', stats, `lifetime.${p}`, isDecimal, 'decimal string');
}
for (const p of [
  'peakObservedSpeedMmPerSecond',
  'peakObservedRpmMilli',
  'maximumDailyDistanceMm',
  'mostWorkHalfHour',
  'longestActiveWindowMinutes',
  'longestActiveDayStreak',
]) {
  expect('stats', stats, `records.${p}`, isRecord, 'null or {value}');
}
expect('stats', stats, 'activity.typicalDay', (v) => Array.isArray(v) && v.length === 48, '48 half-hour slots');
expect('stats', stats, 'activity.typicalDay.0.meanWorkMilli', isDecimal, 'decimal string');
flush();
const st = parsedWith('readStats', readStats, stats);

// ---------------------------------------------------------------- /settlements
const settlements = await get('/settlements?range=now');
expect('settlements', settlements, 'status', isStr, 'available|unavailable');
if (settlements.status === 'available' && settlements.recentSettlements?.length) {
  for (const p of ['settledThroughRound', 'completedBlockCount', 'workAdded', 'sqkMintedBaseUnits']) {
    expect('settlements', settlements, `recentSettlements.0.${p}`, isDecimal, 'decimal string');
  }
  expect('settlements', settlements, 'recentSettlements.0.blockTimestamp', isTime, 'ISO time');
}
flush();
const se = parsedWith('readSettlements', readSettlements, settlements);

// ---------------------------------------------------------------- /economy/state
const economy = await get('/economy/state');
expect('economy', economy, 'status', isStr, 'available|unavailable');
if (economy.status === 'available') expect('economy', economy, 'supply.totalMintedBaseUnits', isDecimal, 'decimal string');
flush();
const ec = parsedWith('readEconomy', readEconomy, economy);

// ---------------------------------------------------------------- summary
console.log('\nWhat the overlay would show right now');
if (s?.telemetry) {
  const t = s.telemetry;
  const ageS = Math.round((Date.parse(status.generatedAt) - t.receivedAt) / 1000);
  console.log(`  wheel: ${t.coreStatus}, ${t.rpmMilli / 1000} rpm, ${(t.distanceMm / 1e6).toFixed(2)} km today, freshness ${t.freshness} (reading ${ageS}s old)`);
}
if (s?.builder.ok) {
  const a = s.builder.anchor;
  console.log(`  chain: block ${a.blockHeight} (${(Number(a.blockProgress) / 1e7).toFixed(1)}% to next), settled through round ${a.settledThroughRound}`);
}
if (st?.lifetime) console.log(`  lifetime: ${(Number(st.lifetime.distanceMm) / 1e6).toFixed(2)} km, ${st.lifetime.settledBlocks} blocks settled`);
if (st?.records.topSpeedMmps) console.log(`  7-day top speed: ${(Number(st.records.topSpeedMmps.value) * 0.0036).toFixed(2)} km/h`);
if (se?.latest) console.log(`  latest paying settlement: round ${se.latest.settledThroughRound}, ${se.latest.completedBlockCount} blocks`);
if (ec?.totalMinted !== null && ec?.totalMinted !== undefined) console.log(`  SQK minted: ${ec.totalMinted / 10n ** 18n} (test SQK)`);

console.log(failures === 0 ? '\nAll fields present.' : `\n${failures} problem(s) found.`);
process.exit(failures === 0 ? 0 : 1);
