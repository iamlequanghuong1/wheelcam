// The decision logic behind the alerts, kept free of timers and DOM so it can be
// tested with plain numbers. Every function takes the previous memory plus a new
// observation and returns the next memory plus what (if anything) should go on air.

import { big } from './units.ts';
import type { Telemetry, TypicalSlot, WireEvent } from './wire.ts';

// ---------------------------------------------------------------- alert items

export const ALERT_KINDS = [
  'wake',
  'sleep',
  'run_recap',
  'speed_record',
  'distance_milestone',
  'daily_distance_milestone',
  'speed_milestone',
  'distance_streak',
  'blocks',
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export const isAlertKind = (v: unknown): v is AlertKind =>
  typeof v === 'string' && (ALERT_KINDS as readonly string[]).includes(v);

interface AlertBase {
  key: string;
  test?: boolean;
}

export interface WakeAlert extends AlertBase {
  kind: 'wake';
  at: number;
  rpmMilli: number | null;
}
export interface SleepAlert extends AlertBase {
  kind: 'sleep';
  at: number;
  todayMm: number | null;
}
/** A run that just ended (see logic/run.ts). `at` is when he stepped off. */
export interface RunRecapAlert extends AlertBase {
  kind: 'run_recap';
  at: number;
  startedAt: number;
  durationMs: number;
  distanceMm: number;
  topMmps: number | null;
  /** Start and part of the distance estimated from half-hour totals. */
  estimated: boolean;
  /** Counted only from when the source tuned in. */
  partial: boolean;
}
export interface BlocksAlert extends AlertBase {
  kind: 'blocks';
  count: bigint;
  first: bigint;
  last: bigint;
}
export interface SpeedRecordAlert extends AlertBase {
  kind: 'speed_record';
  at: number;
  recordMmps: bigint;
  previousMmps: bigint | null;
}
export interface DistanceMilestoneAlert extends AlertBase {
  kind: 'distance_milestone';
  at: number;
  thresholdMm: bigint;
  observedMm: bigint | null;
}
export interface DailyMilestoneAlert extends AlertBase {
  kind: 'daily_distance_milestone';
  at: number;
  thresholdMm: bigint;
  observedMm: bigint | null;
  utcDate: string | null;
}
export interface SpeedMilestoneAlert extends AlertBase {
  kind: 'speed_milestone';
  at: number;
  thresholdMmps: bigint;
  observedMmps: bigint | null;
}
export interface StreakAlert extends AlertBase {
  kind: 'distance_streak';
  at: number;
  days: number;
  minimumMm: bigint | null;
  endingUtcDate: string | null;
}

export type AlertItem =
  | WakeAlert
  | SleepAlert
  | RunRecapAlert
  | BlocksAlert
  | SpeedRecordAlert
  | DistanceMilestoneAlert
  | DailyMilestoneAlert
  | SpeedMilestoneAlert
  | StreakAlert;

// ---------------------------------------------------------------- awake / asleep

export type Presence = 'awake' | 'asleep';

export interface PresenceMemory {
  /** The state we have announced (or silently adopted at page load). */
  committed: Presence | null;
  /** A different state seen since `pendingSince`, waiting out its hold time. */
  pending: Presence | null;
  pendingSince: number;
}

export interface PresenceTiming {
  /** ACTIVE must hold this long before "woke up" is announced. */
  wakeHoldMs: number;
  /** IDLE must hold this long before "went to sleep" is announced. */
  sleepHoldMs: number;
}

export const ON_AIR_TIMING: PresenceTiming = { wakeHoldMs: 60_000, sleepHoldMs: 180_000 };

export const PRESENCE_START: PresenceMemory = { committed: null, pending: null, pendingSince: 0 };

/** coreStatus to presence. COUNTER_FAULT and anything unknown are "no reading". */
export function presenceOf(coreStatus: string | null | undefined): Presence | null {
  if (coreStatus === 'ACTIVE') return 'awake';
  if (coreStatus === 'IDLE') return 'asleep';
  return null;
}

/**
 * Feed one reading (coreStatus, or null while the signal is lost) taken at `at` ms.
 * The first good reading is adopted silently. A change is announced only after it
 * has held without interruption for its hold time; any reading of the committed
 * state resets the wait. Lost signal freezes the committed state and forgets the
 * pending one, so an outage can never produce an alert by itself.
 */
export function stepPresence(
  memory: PresenceMemory,
  coreStatus: string | null,
  at: number,
  timing: PresenceTiming = ON_AIR_TIMING,
): { memory: PresenceMemory; flipped: Presence | null } {
  const seen = presenceOf(coreStatus);
  if (seen === null) {
    return { memory: { committed: memory.committed, pending: null, pendingSince: 0 }, flipped: null };
  }
  if (memory.committed === null || seen === memory.committed) {
    return { memory: { committed: seen, pending: null, pendingSince: 0 }, flipped: null };
  }
  const since = memory.pending === seen ? memory.pendingSince : at;
  const hold = seen === 'awake' ? timing.wakeHoldMs : timing.sleepHoldMs;
  if (at - since >= hold) {
    return { memory: { committed: seen, pending: null, pendingSince: 0 }, flipped: seen };
  }
  return { memory: { committed: memory.committed, pending: seen, pendingSince: since }, flipped: null };
}

export type Mood = 'running' | 'breather' | 'stirring' | 'asleep';

/** What the graphics say right now, combining the announced state with the raw one. */
export function moodOf(memory: PresenceMemory, coreStatus: string | null): Mood | null {
  const seen = presenceOf(coreStatus);
  if (memory.committed === null || seen === null) return null;
  if (memory.committed === 'awake') return seen === 'awake' ? 'running' : 'breather';
  return seen === 'awake' ? 'stirring' : 'asleep';
}

// ---------------------------------------------------------------- squeek blocks

export interface BlockMemory {
  height: bigint | null;
  /** Installation the height belongs to; a new installation starts a new baseline. */
  scope: string | null;
}

export const BLOCKS_START: BlockMemory = { height: null, scope: null };

export interface BlockGain {
  count: bigint;
  first: bigint;
  last: bigint;
}

/**
 * Compare a newly settled block height with the last one. Only an increase on the
 * same installation is a gain; the first reading, a decrease or a new installation
 * just becomes the baseline. An unknown height leaves the memory untouched.
 */
export function stepBlocks(
  memory: BlockMemory,
  height: bigint | null,
  scope: string | null,
): { memory: BlockMemory; gained: BlockGain | null } {
  if (height === null) return { memory, gained: null };
  const sameScope = memory.scope === scope;
  if (memory.height === null || !sameScope || height <= memory.height) {
    return { memory: { height, scope }, gained: null };
  }
  return {
    memory: { height, scope },
    gained: { count: height - memory.height, first: memory.height + 1n, last: height },
  };
}

// ---------------------------------------------------------------- measurement events

const EVENT_KIND: Record<string, AlertKind> = {
  'measurement.speed_record': 'speed_record',
  'measurement.distance_milestone': 'distance_milestone',
  'measurement.daily_distance_milestone': 'daily_distance_milestone',
  'measurement.speed_milestone': 'speed_milestone',
  'measurement.distance_streak': 'distance_streak',
};

export interface EventGate {
  /** Server-time ms the page opened. Older events are history, not news. */
  openedAt: number;
  seen: readonly string[];
}

export const EVENT_MEMORY = 400;

/**
 * Pick the events worth announcing from one feed page: never seen before (by id),
 * occurred after the page opened, and of a type we can describe. Returned oldest
 * first so they air in the order they happened.
 */
export function admitEvents(gate: EventGate, events: readonly WireEvent[]): { gate: EventGate; fresh: WireEvent[] } {
  const seen = new Set(gate.seen);
  const added: string[] = [];
  const fresh: WireEvent[] = [];
  for (const ev of events) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    added.push(ev.id);
    if (!(ev.occurredAt > gate.openedAt)) continue;
    if (!(ev.type in EVENT_KIND)) continue;
    fresh.push(ev);
  }
  fresh.sort((a, b) => a.occurredAt - b.occurredAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const all = added.length ? [...gate.seen, ...added] : gate.seen;
  const kept = all.length > EVENT_MEMORY ? all.slice(all.length - EVENT_MEMORY) : all;
  return { gate: { openedAt: gate.openedAt, seen: kept }, fresh };
}

const dateText = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Turn a measurement event into an alert, or null when its payload is unusable. */
export function alertFromEvent(ev: WireEvent): AlertItem | null {
  const kind = EVENT_KIND[ev.type];
  const p = ev.payload;
  const key = `event:${ev.id}`;
  switch (kind) {
    case 'speed_record': {
      const recordMmps = big(p.recordMmPerSecond);
      if (recordMmps === null) return null;
      return { kind, key, at: ev.occurredAt, recordMmps, previousMmps: big(p.previousRecordMmPerSecond) };
    }
    case 'distance_milestone': {
      const thresholdMm = big(p.thresholdDistanceMm);
      if (thresholdMm === null) return null;
      return { kind, key, at: ev.occurredAt, thresholdMm, observedMm: big(p.observedLifetimeDistanceMm) };
    }
    case 'daily_distance_milestone': {
      const thresholdMm = big(p.thresholdDistanceMm);
      if (thresholdMm === null) return null;
      return {
        kind,
        key,
        at: ev.occurredAt,
        thresholdMm,
        observedMm: big(p.observedDayDistanceMm),
        utcDate: dateText(p.utcDate),
      };
    }
    case 'speed_milestone': {
      const thresholdMmps = big(p.thresholdSpeedMmPerSecond);
      if (thresholdMmps === null) return null;
      return { kind, key, at: ev.occurredAt, thresholdMmps, observedMmps: big(p.observedSpeedMmPerSecond) };
    }
    case 'distance_streak': {
      const days = big(p.days);
      if (days === null || days < 1n || days > 100_000n) return null;
      return {
        kind,
        key,
        at: ev.occurredAt,
        days: Number(days),
        minimumMm: big(p.minimumDailyDistanceMm),
        endingUtcDate: dateText(p.endingUtcDate),
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- the on-air queue

export const QUEUE_LIMIT = 12;

/**
 * Add an alert to the waiting line. The same key never queues twice, block alerts
 * that have not aired yet merge into one ("+42 blocks" instead of three plates),
 * and when the line is full the oldest block alert goes first, then the oldest item.
 */
export function enqueueAlert(queue: readonly AlertItem[], item: AlertItem, limit = QUEUE_LIMIT): AlertItem[] {
  if (queue.some((q) => q.key === item.key)) return queue.slice();
  if (item.kind === 'blocks') {
    const i = queue.findIndex((q) => q.kind === 'blocks');
    const waiting = queue[i];
    if (waiting && waiting.kind === 'blocks') {
      const first = waiting.first < item.first ? waiting.first : item.first;
      const last = waiting.last > item.last ? waiting.last : item.last;
      const merged: BlocksAlert = {
        kind: 'blocks',
        key: `blocks:${first}-${last}`,
        count: waiting.count + item.count,
        first,
        last,
        test: Boolean(waiting.test && item.test),
      };
      const next = queue.slice();
      next[i] = merged;
      return next;
    }
  }
  const next = [...queue, item];
  while (next.length > Math.max(1, limit)) {
    const b = next.findIndex((q) => q.kind === 'blocks');
    next.splice(b >= 0 && b < next.length - 1 ? b : 0, 1);
  }
  return next;
}

/** Remove muted kinds before they ever reach the queue. */
export const allowed = (item: AlertItem, muted: ReadonlySet<AlertKind>): boolean => !muted.has(item.kind);

// ---------------------------------------------------------------- signal

export type SignalState = 'tuning' | 'ok' | 'lost' | 'fault';
export type SignalReason = 'connecting' | 'no-response' | 'device-quiet' | 'no-measurement' | 'counter-fault';

export interface SignalReport {
  state: SignalState;
  reason: SignalReason | null;
  /** When the last good telemetry was received (server ms), if ever. */
  lastSeenAt: number | null;
}

export interface SignalInput {
  now: number;
  /** server time minus local time, ms */
  serverOffsetMs: number;
  startedAt: number;
  lastOkAt: number | null;
  telemetry: Telemetry | null;
  /** How long without a good poll before we call it lost. */
  silenceMs?: number;
  /** How long we show "tuning in" before calling the first connection lost. */
  tuneMs?: number;
}

/**
 * Decide whether live telemetry can be shown. A reading is only shown when the
 * API answered recently, the measurement exists, the API calls it online and it
 * is not older than its own stale window (checked again here in case our polls
 * are what stopped).
 */
export function assessSignal(input: SignalInput): SignalReport {
  const silence = input.silenceMs ?? 20_000;
  const tune = input.tuneMs ?? 12_000;
  const t = input.telemetry;
  const lastSeenAt = t ? t.receivedAt : null;
  if (input.lastOkAt === null) {
    return input.now - input.startedAt < tune
      ? { state: 'tuning', reason: 'connecting', lastSeenAt }
      : { state: 'lost', reason: 'no-response', lastSeenAt };
  }
  if (input.now - input.lastOkAt > silence) return { state: 'lost', reason: 'no-response', lastSeenAt };
  if (!t) return { state: 'lost', reason: 'no-measurement', lastSeenAt };
  const serverNow = input.now + input.serverOffsetMs;
  if (t.freshness !== 'online' || serverNow - t.receivedAt > t.staleAfterSeconds * 1000 + 5_000) {
    return { state: 'lost', reason: 'device-quiet', lastSeenAt };
  }
  if (t.coreStatus === 'COUNTER_FAULT') return { state: 'fault', reason: 'counter-fault', lastSeenAt };
  return { state: 'ok', reason: null, lastSeenAt };
}

// ---------------------------------------------------------------- schedule hint

export type WakeHint = { kind: 'later'; minute: number } | { kind: 'overdue' };

/**
 * Read the 48 half-hour slots of a typical day. A slot is "busy" when its mean work
 * is at least a quarter of the busiest slot. If the current slot is usually busy the
 * hamster is overdue; otherwise the hint is the next busy slot, as a minute of the
 * UTC day. Null when there is no usable history.
 */
export function wakeHint(typicalDay: readonly TypicalSlot[], now: number): WakeHint | null {
  let peak = 0n;
  for (const s of typicalDay) if (s.meanWorkMilli > peak) peak = s.meanWorkMilli;
  if (peak === 0n) return null;
  const busy = typicalDay.filter((s) => s.meanWorkMilli * 4n >= peak).map((s) => s.minute);
  const d = new Date(now);
  const nowMinute = d.getUTCHours() * 60 + d.getUTCMinutes();
  const slotNow = nowMinute - (nowMinute % 30);
  if (busy.includes(slotNow)) return { kind: 'overdue' };
  let best: number | null = null;
  let bestWait = Infinity;
  for (const minute of busy) {
    let wait = minute - nowMinute;
    if (wait <= 0) wait += 1440;
    if (wait < bestWait) {
      bestWait = wait;
      best = minute;
    }
  }
  return best === null ? null : { kind: 'later', minute: best };
}
