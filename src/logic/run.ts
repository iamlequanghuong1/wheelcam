// Run tracking, kept free of timers and DOM like the alert rules. A run starts
// with the first ACTIVE reading and ends once the wheel has stayed out of ACTIVE
// for the end hold (the same three minutes as "went to sleep"), so a breather
// shorter than that is part of the run. All times are server-clock milliseconds.
//
// A browser source that opens while Squeektoshi is already running cannot know
// when he started. It estimates the missing part from the stats feed's
// half-hour work totals, and everything built on that estimate is flagged.

import { presenceOf } from './rules.ts';
import { big } from './units.ts';
import type { HalfHour, StatsSnap, WireEvent } from './wire.ts';

// ---------------------------------------------------------------- shapes

export interface SpeedPoint {
  t: number;
  mmps: number;
}

/** Estimated average speed over a stretch nobody here watched. */
export interface SpeedBar {
  from: number;
  to: number;
  mmps: number;
}

/** A speed a feed reported at a known moment (the 7-day record, speed events). */
export interface SpeedHint {
  at: number;
  mmps: number;
}

/** What the half-hour totals say about a run before this page joined it. */
export interface RunSeed {
  startedAt: number;
  distanceMm: number;
  topMmps: number | null;
  topAt: number | null;
  bars: SpeedBar[];
}

export interface RunTrack {
  /** First reading of this run that the page saw. */
  trackedFrom: number;
  lastActiveAt: number;
  endedAt: number | null;
  /** Travel counted from live readings since trackedFrom. */
  distanceMm: number;
  topMmps: number;
  topAt: number | null;
  points: SpeedPoint[];
  dayMmAtStart: number;
  lastDayMm: number;
  lastObservedAt: number;
  /** He was already on the wheel when the page tuned in. */
  joinedLate: boolean;
  seed: RunSeed | null;
}

export interface RunMemory {
  current: RunTrack | null;
  /** The latest run that ended while the page was watching. */
  last: RunTrack | null;
  /** Poll time of the first reading out of ACTIVE during the current run. */
  idleSince: number | null;
  /** At least one good reading has arrived. */
  seen: boolean;
}

export const RUN_START: RunMemory = { current: null, last: null, idleSince: null, seen: false };

export interface RunTiming {
  /** Out of ACTIVE this long ends the run. */
  endHoldMs: number;
  /** Shorter runs do not get a recap. */
  minRunMs: number;
}

export interface RunReading {
  /** Poll time on the server clock; drives the end hold. */
  at: number;
  /** When the wheel took the measurement (server clock); dates the samples. */
  observedAt: number;
  coreStatus: string;
  mmps: number;
  /** The wheel's day counter, which resets at noon UTC. */
  dayMm: number;
}

/** Faster than this is a counter glitch, not a hamster. His record is about 1.6 m/s. */
export const MAX_SPEED_MMPS = 4_000;
/** Reading-to-reading jitter allowed on top of the speed limit. */
const SLACK_MM = 5_000;
/** Speed samples kept per run before the history is thinned. */
export const POINT_CAP = 480;
/** A recap needs at least this much wheel travel. */
export const MIN_RECAP_MM = 10_000;
/** The smallest stretch of half-hour work worth calling a run (about 50 m). */
export const MIN_PAST_WORK = 60;

const ROUND_MS = 600_000;

// ---------------------------------------------------------------- live tracking

/** Distance gained between two readings of the day counter. */
export function travelled(beforeMm: number, afterMm: number, dtMs: number): number {
  if (!Number.isFinite(beforeMm) || !Number.isFinite(afterMm) || afterMm < 0) return 0;
  // A smaller reading means the wheel day rolled over at noon and counts from zero again.
  const gained = afterMm >= beforeMm ? afterMm - beforeMm : afterMm;
  // More than any hamster could cover in the time between readings is a counter jump.
  const ceiling = (MAX_SPEED_MMPS * Math.max(0, dtMs)) / 1000 + SLACK_MM;
  return gained <= ceiling ? gained : 0;
}

const plausible = (mmps: number): number | null =>
  Number.isFinite(mmps) && mmps >= 0 && mmps <= MAX_SPEED_MMPS ? mmps : null;

/** Append a speed sample; past the cap, neighbouring pairs are averaged so a long run still fits. */
export function addPoint(points: readonly SpeedPoint[], p: SpeedPoint, cap = POINT_CAP): SpeedPoint[] {
  const next = [...points, p];
  if (next.length <= Math.max(2, cap)) return next;
  const out: SpeedPoint[] = [];
  for (let i = 0; i < next.length; i += 2) {
    const a = next[i];
    const b = next[i + 1];
    if (!a) break;
    // The newest sample always survives untouched, so the trace ends on the live value.
    if (!b || i + 1 === next.length - 1) {
      out.push(a);
      if (b) out.push(b);
      break;
    }
    out.push({ t: a.t, mmps: (a.mmps + b.mmps) / 2 });
  }
  return out;
}

function startRun(r: RunReading, joinedLate: boolean): RunTrack {
  const mmps = plausible(r.mmps);
  return {
    trackedFrom: r.observedAt,
    lastActiveAt: r.observedAt,
    endedAt: null,
    distanceMm: 0,
    topMmps: mmps ?? 0,
    topAt: mmps !== null && mmps > 0 ? r.observedAt : null,
    points: mmps === null ? [] : [{ t: r.observedAt, mmps }],
    dayMmAtStart: r.dayMm,
    lastDayMm: r.dayMm,
    lastObservedAt: r.observedAt,
    joinedLate,
    seed: null,
  };
}

function advance(run: RunTrack, r: RunReading, active: boolean): RunTrack {
  // The same measurement polled twice adds nothing.
  if (!(r.observedAt > run.lastObservedAt)) return run;
  const mmps = plausible(r.mmps);
  const faster = mmps !== null && mmps > run.topMmps;
  return {
    ...run,
    distanceMm: run.distanceMm + travelled(run.lastDayMm, r.dayMm, r.observedAt - run.lastObservedAt),
    topMmps: faster ? mmps : run.topMmps,
    topAt: faster ? r.observedAt : run.topAt,
    lastActiveAt: active ? r.observedAt : run.lastActiveAt,
    points: mmps === null ? run.points : addPoint(run.points, { t: r.observedAt, mmps }),
    lastDayMm: r.dayMm,
    lastObservedAt: r.observedAt,
  };
}

/** Close a run at its last ACTIVE reading and drop the idle tail from the trace. */
function closeRun(run: RunTrack): RunTrack {
  return { ...run, endedAt: run.lastActiveAt, points: run.points.filter((p) => p.t <= run.lastActiveAt) };
}

/**
 * Feed one status reading (null while the signal is lost or faulted). The first
 * ACTIVE reading starts a run; the run ends once readings have stayed out of
 * ACTIVE for the end hold, measured from the first such reading. A lost signal
 * keeps the run open and restarts the hold, so an outage can never end a run.
 * A run too short to count (see isRealRun) is dropped when it ends, so a twitch
 * of the wheel never replaces the last real run.
 */
export function stepRun(
  memory: RunMemory,
  reading: RunReading | null,
  timing: RunTiming,
): { memory: RunMemory; ended: RunTrack | null } {
  const seen = reading === null ? null : presenceOf(reading.coreStatus);
  if (reading === null || seen === null) {
    return { memory: { ...memory, idleSince: null }, ended: null };
  }
  const run = memory.current;
  if (seen === 'awake') {
    const next = run === null ? startRun(reading, !memory.seen) : advance(run, reading, true);
    return { memory: { current: next, last: memory.last, idleSince: null, seen: true }, ended: null };
  }
  if (run === null) return { memory: { ...memory, seen: true }, ended: null };
  const next = advance(run, reading, false);
  const idleSince = memory.idleSince ?? reading.at;
  if (reading.at - idleSince >= timing.endHoldMs) {
    const done = closeRun(next);
    const real = isRealRun(done, timing);
    return {
      memory: { current: null, last: real ? done : memory.last, idleSince: null, seen: true },
      ended: real ? done : null,
    };
  }
  return { memory: { current: next, last: memory.last, idleSince, seen: true }, ended: null };
}

// ---------------------------------------------------------------- totals and recap

export interface RunTotals {
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  distanceMm: number;
  topMmps: number | null;
  topAt: number | null;
  avgMmps: number | null;
  /** The start and part of the distance come from half-hour totals. */
  estimated: boolean;
  /** Joined mid-run without an estimate: the totals only cover what the page saw. */
  partial: boolean;
}

export function runTotals(run: RunTrack, now: number): RunTotals {
  const seed = run.seed;
  const startedAt = seed ? Math.min(seed.startedAt, run.trackedFrom) : run.trackedFrom;
  const until = run.endedAt ?? Math.max(now, run.lastActiveAt);
  const durationMs = Math.max(0, until - startedAt);
  const distanceMm = run.distanceMm + (seed ? seed.distanceMm : 0);
  let topMmps: number | null = run.topMmps > 0 ? run.topMmps : null;
  let topAt = topMmps === null ? null : run.topAt;
  if (seed && seed.topMmps !== null && seed.topMmps > (topMmps ?? 0)) {
    topMmps = seed.topMmps;
    topAt = seed.topAt;
  }
  return {
    startedAt,
    endedAt: run.endedAt,
    durationMs,
    distanceMm,
    topMmps,
    topAt,
    avgMmps: durationMs >= 1000 ? distanceMm / (durationMs / 1000) : null,
    estimated: seed !== null,
    partial: run.joinedLate && seed === null,
  };
}

export interface RunRecap {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  distanceMm: number;
  topMmps: number | null;
  estimated: boolean;
  partial: boolean;
}

/** Long and far enough to be a run rather than a twitch of the wheel. */
export function isRealRun(run: RunTrack, timing: RunTiming): boolean {
  const t = runTotals(run, run.endedAt ?? run.lastActiveAt);
  return t.durationMs >= timing.minRunMs && t.distanceMm >= MIN_RECAP_MM;
}

/** The recap for a finished run, or null when it was too short to be worth a plate. */
export function recapOf(run: RunTrack, timing: RunTiming): RunRecap | null {
  if (run.endedAt === null || !isRealRun(run, timing)) return null;
  const t = runTotals(run, run.endedAt);
  return {
    startedAt: t.startedAt,
    endedAt: run.endedAt,
    durationMs: t.durationMs,
    distanceMm: t.distanceMm,
    topMmps: t.topMmps,
    estimated: t.estimated,
    partial: t.partial,
  };
}

// ---------------------------------------------------------------- estimates from half-hour totals

/** How the stats feed converts work to distance and what a steady half hour looks like. */
export interface WorkScale {
  mmPerWork: number;
  /** Work in a half hour of steady running, used to guess how much of a half hour he ran. */
  fullHalfHourWork: number;
}

export function workScale(stats: StatsSnap | null): WorkScale {
  const l = stats?.lifetime;
  const ratio = l && l.acceptedWork > 0n ? Number(l.distanceMm) / Number(l.acceptedWork) : Number.NaN;
  const best = stats?.records.busiestHalfHourWork ? Number(stats.records.busiestHalfHourWork.value) : Number.NaN;
  return {
    mmPerWork: ratio >= 300 && ratio <= 3_000 ? ratio : 878,
    fullHalfHourWork: best >= 600 && best <= 6_000 ? best : 1_700,
  };
}

/** Speeds the feeds pinned to a time: the 7-day record plus speed records and milestones. */
export function speedHints(stats: StatsSnap | null, events: readonly WireEvent[]): SpeedHint[] {
  const hints: SpeedHint[] = [];
  const top = stats?.records.topSpeedMmps;
  if (top && top.occurredAt !== null) hints.push({ at: top.occurredAt, mmps: Number(top.value) });
  for (const ev of events) {
    const v =
      ev.type === 'measurement.speed_record'
        ? big(ev.payload.recordMmPerSecond)
        : ev.type === 'measurement.speed_milestone'
          ? big(ev.payload.observedSpeedMmPerSecond)
          : null;
    if (v !== null && v <= BigInt(MAX_SPEED_MMPS)) hints.push({ at: ev.occurredAt, mmps: Number(v) });
  }
  return hints;
}

const busy = (h: HalfHour | undefined): h is HalfHour => h !== undefined && h.work !== null && h.work > 0;

/** Time of steady running that would produce a half hour's work. */
function activeMs(h: HalfHour, fullHalfHourWork: number): number {
  const span = h.to - h.from;
  return Math.min(span, ((h.work ?? 0) / Math.max(1, fullHalfHourWork)) * span);
}

/** Start of the wheel day (noon UTC by default) that contains `t`. */
export function wheelDayStart(t: number, dayStartMinute: number): number {
  const offset = dayStartMinute * 60_000;
  return Math.floor((t - offset) / 86_400_000) * 86_400_000 + offset;
}

/** Index of the first half hour in the unbroken busy stretch that ends at `last`. */
function streakStart(hh: readonly HalfHour[], last: number): number {
  let first = last;
  for (;;) {
    const prev = hh[first - 1];
    const cur = hh[first];
    if (!busy(prev) || !cur || prev.to !== cur.from) return first;
    first -= 1;
  }
}

function bestHint(hints: readonly SpeedHint[], from: number, to: number): SpeedHint | null {
  let best: SpeedHint | null = null;
  for (const h of hints) {
    if (!(h.at >= from && h.at <= to) || !(h.mmps > 0) || h.mmps > MAX_SPEED_MMPS) continue;
    if (!best || h.mmps > best.mmps) best = h;
  }
  return best;
}

/**
 * Average speed per half hour of a stretch. An average can never beat his top
 * speed, so the fastest speed on record caps it (a half hour still filling up
 * can otherwise look impossibly quick).
 */
function barsFor(
  hh: readonly HalfHour[],
  first: number,
  last: number,
  from: number,
  to: number,
  coveredTo: number,
  scale: WorkScale,
  hints: readonly SpeedHint[],
): SpeedBar[] {
  let ceiling = MAX_SPEED_MMPS;
  const fastest = Math.max(0, ...hints.map((h) => h.mmps));
  if (fastest > 0 && fastest < ceiling) ceiling = fastest;
  const bars: SpeedBar[] = [];
  for (let k = first; k <= last; k += 1) {
    const h = hh[k];
    if (!h || h.work === null) continue;
    const start = Math.max(h.from, from);
    const covered = Math.min(h.to, coveredTo) - start;
    const end = Math.min(h.to, to);
    if (covered < 60_000 || end <= start) continue;
    const mmps = Math.min(ceiling, (h.work * scale.mmPerWork) / (covered / 1000));
    bars.push({ from: start, to: end, mmps });
  }
  return bars;
}

export interface SeedInput extends WorkScale {
  halfHours: readonly HalfHour[];
  /** When the page started watching the run. */
  trackedFrom: number;
  /** The day counter at that moment. */
  dayMmAtStart: number;
  dayStartMinute: number;
  hints: readonly SpeedHint[];
}

/**
 * Estimate the part of a run that happened before the page tuned in. The run is
 * the unbroken stretch of busy half hours that reaches the present; it is
 * assumed to have started as late as its first half hour's work allows at a
 * steady pace. The distance before tune-in is the day counter at tune-in minus
 * the work the same wheel day had logged before the stretch began. Null when the
 * totals show no such stretch (he started too recently for a round to close).
 */
export function seedRun(input: SeedInput): RunSeed | null {
  const hh = input.halfHours;
  const t = input.trackedFrom;
  const i = hh.findIndex((h) => h.from <= t && t < h.to);
  const cur = hh[i];
  if (!cur) return null;
  let last = i;
  if (cur.work === null || cur.work <= 0) {
    // Rounds close every ten minutes, so early in a half hour its work is not in yet.
    if (t - cur.from >= ROUND_MS + 120_000) return null;
    last = i - 1;
  }
  if (!busy(hh[last])) return null;
  const first = streakStart(hh, last);
  const head = hh[first];
  if (!head) return null;
  // Only closed rounds are counted, so the work in progress stops at the last round boundary.
  const closedTo = Math.floor(t / ROUND_MS) * ROUND_MS;
  const headEnd = Math.max(head.from, Math.min(head.to, closedTo));
  const startedAt = Math.max(head.from, headEnd - activeMs(head, input.fullHalfHourWork));
  if (!(startedAt < t)) return null;

  const dayStart = wheelDayStart(t, input.dayStartMinute);
  let before = 0; // work the same wheel day logged before the stretch
  let carried = 0; // stretch work from before the noon roll-over
  for (const h of hh) {
    if (h.work === null) continue;
    if (h.from >= dayStart && h.to <= head.from) before += h.work;
    else if (h.from >= head.from && h.to <= dayStart) carried += h.work;
  }
  const raw = input.dayMmAtStart + (carried - before) * input.mmPerWork;
  const distanceMm = Math.min(Math.max(0, raw), (MAX_SPEED_MMPS * (t - startedAt)) / 1000);
  const top = bestHint(input.hints, startedAt, t);
  return {
    startedAt,
    distanceMm,
    topMmps: top ? top.mmps : null,
    topAt: top ? top.at : null,
    bars: barsFor(hh, first, last, startedAt, t, closedTo, input, input.hints),
  };
}

export interface PastRun {
  startedAt: number;
  endedAt: number;
  distanceMm: number;
  topMmps: number | null;
  topAt: number | null;
  bars: SpeedBar[];
}

/**
 * The most recent run in the half-hour totals, for a page that has not watched
 * one yet: the latest unbroken stretch of busy half hours holding at least
 * MIN_PAST_WORK. The first half hour's work is packed against its end and the
 * last one's against its start, so the times are a steady-pace guess.
 */
export function lastRunFromHalfHours(
  input: WorkScale & { halfHours: readonly HalfHour[]; now: number; hints: readonly SpeedHint[] },
): PastRun | null {
  const hh = input.halfHours;
  for (let k = hh.length - 1; k >= 0; ) {
    const tail = hh[k];
    if (!busy(tail) || tail.from >= input.now) {
      k -= 1;
      continue;
    }
    const first = streakStart(hh, k);
    const head = hh[first];
    let work = 0;
    for (let j = first; j <= k; j += 1) work += hh[j]?.work ?? 0;
    if (!head || work < MIN_PAST_WORK) {
      k = first - 1;
      continue;
    }
    let startedAt: number;
    let endedAt: number;
    if (first === k) {
      const active = activeMs(head, input.fullHalfHourWork);
      startedAt = head.from + (head.to - head.from - active) / 2;
      endedAt = startedAt + active;
    } else {
      startedAt = head.to - activeMs(head, input.fullHalfHourWork);
      endedAt = tail.from + activeMs(tail, input.fullHalfHourWork);
    }
    endedAt = Math.max(startedAt, Math.min(endedAt, input.now));
    const top = bestHint(input.hints, head.from, Math.min(tail.to, input.now));
    return {
      startedAt,
      endedAt,
      distanceMm: work * input.mmPerWork,
      topMmps: top ? top.mmps : null,
      topAt: top ? top.at : null,
      bars: barsFor(hh, first, k, startedAt, endedAt, endedAt, input, input.hints),
    };
  }
  return null;
}

// ---------------------------------------------------------------- what the run card draws

export type RunPhase = 'running' | 'paused' | 'finished';

export interface RunPicture extends RunTotals {
  phase: RunPhase;
  /** 'live' when the page watched the run, 'history' when it was pieced together from half-hour totals. */
  source: 'live' | 'history';
  trackedFrom: number | null;
  points: readonly SpeedPoint[];
  bars: readonly SpeedBar[];
}

/** The run to show: the one in progress, else the last one watched, else the last one on record. */
export function pictureOf(memory: RunMemory, past: PastRun | null, now: number): RunPicture | null {
  const run = memory.current ?? memory.last;
  if (run) {
    const phase: RunPhase = memory.current === null ? 'finished' : memory.idleSince === null ? 'running' : 'paused';
    return {
      ...runTotals(run, now),
      phase,
      source: 'live',
      trackedFrom: run.trackedFrom,
      points: run.points,
      bars: run.seed ? run.seed.bars : [],
    };
  }
  if (!past) return null;
  const durationMs = past.endedAt - past.startedAt;
  return {
    phase: 'finished',
    source: 'history',
    startedAt: past.startedAt,
    endedAt: past.endedAt,
    durationMs,
    distanceMm: past.distanceMm,
    topMmps: past.topMmps,
    topAt: past.topAt,
    avgMmps: durationMs >= 1000 ? past.distanceMm / (durationMs / 1000) : null,
    estimated: true,
    partial: false,
    trackedFrom: null,
    points: [],
    bars: past.bars,
  };
}
