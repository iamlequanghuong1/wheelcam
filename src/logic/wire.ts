// Readers for the public Squeekchain API (https://api.squeekchain.com/v1).
// Each reader checks the fields the overlay actually uses and throws WireError
// when the shape is wrong, because a response that does not match is an error,
// not an empty result. "status": "unavailable" is a valid answer and is kept as
// unknown, never turned into zeros.

import { big } from './units.ts';

export class WireError extends Error {
  constructor(where: string, problem: string) {
    super(`${where}: ${problem}`);
    this.name = 'WireError';
  }
}

type Bag = Record<string, unknown>;

const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);

function bag(v: unknown, where: string): Bag {
  if (!isBag(v)) throw new WireError(where, 'expected an object');
  return v;
}

function text(v: unknown, where: string): string {
  if (typeof v !== 'string') throw new WireError(where, 'expected a string');
  return v;
}

function finite(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new WireError(where, 'expected a number');
  return v;
}

function decimal(v: unknown, where: string): bigint {
  const b = big(v);
  if (b === null) throw new WireError(where, 'expected an unsigned decimal string');
  return b;
}

function instant(v: unknown, where: string): number {
  const ms = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  if (!Number.isFinite(ms)) throw new WireError(where, 'expected an ISO timestamp');
  return ms;
}

function maybeInstant(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

const maybeText = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// ---------------------------------------------------------------- /v1/status

export interface Telemetry {
  freshness: string;
  observedAt: number;
  receivedAt: number;
  staleAfterSeconds: number;
  coreStatus: string;
  rpmMilli: number;
  speedMmPerSecond: number;
  /** Distance for the device's current day (noon to noon UTC). */
  distanceMm: number;
  provenance: string | null;
}

export interface Anchor {
  settledThroughRound: bigint;
  cumulativeWork: bigint;
  blockHeight: bigint;
  blockProgress: bigint;
  workPerThousandBlocks: bigint;
  confirmedAt: number | null;
  transactionHash: string | null;
}

export interface Projection {
  blockHeight: bigint;
  blockProgress: bigint;
}

export type BuilderView =
  | { ok: true; anchor: Anchor; projected: Projection | null }
  | { ok: false; reason: string };

export interface StatusSnap {
  installationId: string | null;
  generatedAt: number | null;
  telemetry: Telemetry | null;
  builder: BuilderView;
}

function readTelemetry(v: unknown): Telemetry | null {
  if (v === null || v === undefined) return null;
  const m = bag(v, 'measurement');
  return {
    freshness: text(m.freshness, 'measurement.freshness'),
    observedAt: instant(m.observedAt, 'measurement.observedAt'),
    receivedAt: instant(m.receivedAt, 'measurement.receivedAt'),
    staleAfterSeconds: typeof m.staleAfterSeconds === 'number' && m.staleAfterSeconds > 0 ? m.staleAfterSeconds : 120,
    coreStatus: text(m.coreStatus, 'measurement.coreStatus'),
    rpmMilli: finite(m.rpmMilli, 'measurement.rpmMilli'),
    speedMmPerSecond: finite(m.speedMmPerSecond, 'measurement.speedMmPerSecond'),
    distanceMm: finite(m.distanceMm, 'measurement.distanceMm'),
    provenance: maybeText(m.provenance),
  };
}

function readBuilder(v: unknown): BuilderView {
  if (!isBag(v)) return { ok: false, reason: 'builder_missing' };
  if (v.status !== 'available') return { ok: false, reason: maybeText(v.reason) ?? 'unavailable' };
  const a = bag(v.anchor, 'builder.anchor');
  const anchor: Anchor = {
    settledThroughRound: decimal(a.settledThroughRound, 'anchor.settledThroughRound'),
    cumulativeWork: decimal(a.cumulativeWork, 'anchor.cumulativeWork'),
    blockHeight: decimal(a.blockHeight, 'anchor.blockHeight'),
    blockProgress: decimal(a.blockProgress, 'anchor.blockProgress'),
    workPerThousandBlocks: decimal(a.workPerThousandBlocks, 'anchor.workPerThousandBlocks'),
    confirmedAt: maybeInstant(a.confirmedAt),
    transactionHash: maybeText(a.transactionHash),
  };
  let projected: Projection | null = null;
  if (isBag(v.projected)) {
    const h = big(v.projected.blockHeight);
    const p = big(v.projected.blockProgress);
    if (h !== null && p !== null) projected = { blockHeight: h, blockProgress: p };
  }
  return { ok: true, anchor, projected };
}

export function readStatus(raw: unknown): StatusSnap {
  const r = bag(raw, 'status');
  return {
    installationId: maybeText(r.installationId),
    generatedAt: maybeInstant(r.generatedAt),
    telemetry: readTelemetry(r.measurement),
    builder: readBuilder(r.builder),
  };
}

// ---------------------------------------------------------------- /v1/events

export interface WireEvent {
  id: string;
  type: string;
  occurredAt: number;
  payload: Bag;
}

export interface EventsSnap {
  available: boolean;
  reason: string | null;
  events: WireEvent[];
}

export function readEvents(raw: unknown): EventsSnap {
  const r = bag(raw, 'events');
  if (r.status === 'unavailable') return { available: false, reason: maybeText(r.reason) ?? 'unavailable', events: [] };
  if (!Array.isArray(r.events)) throw new WireError('events.events', 'expected an array');
  const events: WireEvent[] = [];
  for (const item of r.events) {
    // An event we cannot identify or date cannot be deduplicated or gated, so it is skipped.
    if (!isBag(item)) continue;
    const id = maybeText(item.id);
    const type = maybeText(item.type);
    const occurredAt = maybeInstant(item.occurredAt);
    if (!id || !type || occurredAt === null) continue;
    events.push({ id, type, occurredAt, payload: isBag(item.payload) ? item.payload : {} });
  }
  return { available: true, reason: null, events };
}

// ---------------------------------------------------------------- /v1/measurement/stats

export interface RecordValue {
  value: bigint;
  occurredAt: number | null;
  coverage: string | null;
}

export interface Lifetime {
  distanceMm: bigint;
  acceptedWork: bigint;
  settledBlocks: bigint;
  settlements: bigint;
  activeDays: number | null;
}

export interface Records {
  topSpeedMmps: RecordValue | null;
  peakRpmMilli: RecordValue | null;
  bestDayMm: RecordValue | null;
  busiestHalfHourWork: RecordValue | null;
  longestWindowMinutes: RecordValue | null;
  longestStreakDays: RecordValue | null;
}

export interface TypicalSlot {
  minute: number;
  meanWorkMilli: bigint;
}

/** One half hour of accepted work on absolute (server) time. */
export interface HalfHour {
  from: number;
  to: number;
  /** Work units in the accepted rounds; null when the half hour is missing or still in the future. */
  work: number | null;
}

export interface StatsSnap {
  lifetime: Lifetime | null;
  records: Records;
  typicalDay: TypicalSlot[];
  /** Every half hour of the window, oldest first. */
  halfHours: HalfHour[];
  /** Minute of the UTC day where the wheel day starts (720: noon). */
  dayStartMinute: number;
}

const NOON = 720;

/**
 * Put the per-day buckets on a real timeline. A day runs from its start minute
 * (noon UTC) to the same minute the next day and is named after the date it
 * starts on, so a bucket before that minute belongs to the following morning.
 */
function readHalfHours(activity: Bag | null, dayStartMinute: number, bucketMs: number): HalfHour[] {
  const out: HalfHour[] = [];
  if (!activity || !Array.isArray(activity.days)) return out;
  for (const day of activity.days) {
    if (!isBag(day) || typeof day.date !== 'string' || !Array.isArray(day.buckets)) continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.date);
    if (!m) continue;
    const dayStart = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + dayStartMinute * 60_000;
    for (const b of day.buckets) {
      if (!isBag(b) || typeof b.startMinuteUtc !== 'number' || !Number.isInteger(b.startMinuteUtc)) continue;
      const offset = (((b.startMinuteUtc - dayStartMinute) % 1440) + 1440) % 1440;
      const from = dayStart + offset * 60_000;
      const counted = b.coverage === 'complete' || b.coverage === 'partial';
      const work = counted ? big(b.workUnits) : null;
      out.push({ from, to: from + bucketMs, work: work === null || work > 1_000_000n ? null : Number(work) });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

function readRecord(v: unknown): RecordValue | null {
  if (!isBag(v)) return null;
  const value = big(v.value);
  if (value === null) return null;
  return { value, occurredAt: maybeInstant(v.occurredAt), coverage: maybeText(v.coverage) };
}

export function readStats(raw: unknown): StatsSnap {
  const r = bag(raw, 'stats');
  if (r.status === 'unavailable') {
    return { lifetime: null, records: emptyRecords(), typicalDay: [], halfHours: [], dayStartMinute: NOON };
  }
  const l = bag(r.lifetime, 'stats.lifetime');
  const lifetime: Lifetime = {
    distanceMm: decimal(l.observedDistanceMm, 'lifetime.observedDistanceMm'),
    acceptedWork: decimal(l.acceptedWorkUnits, 'lifetime.acceptedWorkUnits'),
    settledBlocks: decimal(l.settledBlockCount, 'lifetime.settledBlockCount'),
    settlements: decimal(l.settlementCount, 'lifetime.settlementCount'),
    activeDays: typeof l.activeDayCount === 'number' ? l.activeDayCount : null,
  };
  const rec = bag(r.records, 'stats.records');
  const records: Records = {
    topSpeedMmps: readRecord(rec.peakObservedSpeedMmPerSecond),
    peakRpmMilli: readRecord(rec.peakObservedRpmMilli),
    bestDayMm: readRecord(rec.maximumDailyDistanceMm),
    busiestHalfHourWork: readRecord(rec.mostWorkHalfHour),
    longestWindowMinutes: readRecord(rec.longestActiveWindowMinutes),
    longestStreakDays: readRecord(rec.longestActiveDayStreak),
  };
  const typicalDay: TypicalSlot[] = [];
  const activity = isBag(r.activity) ? r.activity : null;
  if (activity && Array.isArray(activity.typicalDay)) {
    for (const slot of activity.typicalDay) {
      if (!isBag(slot) || typeof slot.startMinuteUtc !== 'number') continue;
      const mean = big(slot.meanWorkMilli);
      if (mean !== null) typicalDay.push({ minute: slot.startMinuteUtc, meanWorkMilli: mean });
    }
  }
  const window = isBag(r.window) ? r.window : null;
  const windowStart = window ? maybeInstant(window.startAt) : null;
  const dayStartMinute =
    windowStart === null ? NOON : Math.round((((windowStart % 86_400_000) + 86_400_000) % 86_400_000) / 60_000) % 1440;
  const bucketMs =
    window && typeof window.bucketSeconds === 'number' && window.bucketSeconds > 0 ? window.bucketSeconds * 1000 : 1_800_000;
  const halfHours = readHalfHours(activity, dayStartMinute, bucketMs);
  return { lifetime, records, typicalDay, halfHours, dayStartMinute };
}

function emptyRecords(): Records {
  return {
    topSpeedMmps: null,
    peakRpmMilli: null,
    bestDayMm: null,
    busiestHalfHourWork: null,
    longestWindowMinutes: null,
    longestStreakDays: null,
  };
}

// ---------------------------------------------------------------- /v1/settlements?range=now

export interface SettlementView {
  settledThroughRound: bigint;
  completedBlockCount: bigint;
  workAdded: bigint | null;
  sqkMinted: bigint | null;
  at: number | null;
  transactionHash: string | null;
}

export interface SettlementsSnap {
  available: boolean;
  reason: string | null;
  latest: SettlementView | null;
}

export function readSettlements(raw: unknown): SettlementsSnap {
  const r = bag(raw, 'settlements');
  if (r.status === 'unavailable') return { available: false, reason: maybeText(r.reason) ?? 'unavailable', latest: null };
  if (!Array.isArray(r.recentSettlements)) throw new WireError('settlements.recentSettlements', 'expected an array');
  const first: unknown = r.recentSettlements[0];
  if (!isBag(first)) return { available: true, reason: null, latest: null };
  return {
    available: true,
    reason: null,
    latest: {
      settledThroughRound: decimal(first.settledThroughRound, 'settlement.settledThroughRound'),
      completedBlockCount: decimal(first.completedBlockCount, 'settlement.completedBlockCount'),
      workAdded: big(first.workAdded),
      sqkMinted: big(first.sqkMintedBaseUnits),
      at: maybeInstant(first.blockTimestamp),
      transactionHash: maybeText(first.transactionHash),
    },
  };
}

// ---------------------------------------------------------------- /v1/economy/state

export interface EconomySnap {
  available: boolean;
  reason: string | null;
  totalMinted: bigint | null;
}

export function readEconomy(raw: unknown): EconomySnap {
  const r = bag(raw, 'economy');
  if (r.status === 'unavailable') return { available: false, reason: maybeText(r.reason) ?? 'unavailable', totalMinted: null };
  const supply = bag(r.supply, 'economy.supply');
  return { available: true, reason: null, totalMinted: decimal(supply.totalMintedBaseUnits, 'supply.totalMintedBaseUnits') };
}
