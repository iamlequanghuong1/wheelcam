// Rehearsal feed: a scripted 160-second night on the wheel, built as API-shaped
// JSON and pushed through the same readers and rules as the live feed. It wakes
// up, runs, breaks a record, passes milestones, settles blocks, steps off for
// the run recap, goes to bed and briefly drops the signal, then starts over.
// Every scene shows a DEMO tag.

import type { Hub } from './hub.ts';
import type { Needs } from './live.ts';
import { readEconomy, readEvents, readSettlements, readStats, readStatus } from '../logic/wire.ts';
import type { PresenceTiming } from '../logic/rules.ts';

/** Shorter holds so the whole script fits in under three minutes. */
export const REHEARSAL_TIMING: PresenceTiming = { wakeHoldMs: 8_000, sleepHoldMs: 20_000 };

const LOOP_S = 160;
const MM_PER_REV = 878; // about one work unit of wheel travel
const WORK_PER_THOUSAND_BLOCKS = 10_875;
const UNITS_PER_BLOCK = 1_000_000_000;
const SQK_PER_BLOCK = 3_981n * 10n ** 18n;

interface Phase {
  until: number;
  core: 'IDLE' | 'ACTIVE';
  online: boolean;
}

const SCRIPT: Phase[] = [
  { until: 12, core: 'IDLE', online: true },
  { until: 70, core: 'ACTIVE', online: true },
  { until: 74, core: 'IDLE', online: true }, // a breather
  { until: 118, core: 'ACTIVE', online: true },
  { until: 148, core: 'IDLE', online: true }, // bedtime
  { until: LOOP_S, core: 'IDLE', online: false }, // the feed drops out
];

const SETTLE_AT = [44, 112];

interface ScriptedEvent {
  at: number;
  type: string;
  payload: (w: World) => Record<string, unknown>;
}

const EVENTS: ScriptedEvent[] = [
  {
    at: 30,
    type: 'measurement.speed_milestone',
    payload: (w) => ({ thresholdSpeedMmPerSecond: '1667', observedSpeedMmPerSecond: String(Math.max(1667, Math.round(w.speed))) }),
  },
  {
    at: 58,
    type: 'measurement.speed_record',
    payload: (w) => {
      // The sprint that started at 55 s sets the record; stats pick it up from here.
      const record = Math.max(1700, Math.round(w.sprintPeak));
      w.topSpeed = record;
      w.peakRpm = Math.round((record / MM_PER_REV) * 60 * 1000);
      return {
        previousRecordMmPerSecond: '1628',
        recordMmPerSecond: String(record),
        observedSpeedMmPerSecond: String(Math.round(w.speed)),
      };
    },
  },
  {
    at: 72,
    type: 'measurement.daily_distance_milestone',
    payload: (w) => ({
      thresholdDistanceMm: '3000000',
      observedDayDistanceMm: String(Math.max(3_000_000, Math.round(w.todayMm))),
      utcDate: wheelDay(Date.now()),
    }),
  },
  {
    at: 86,
    type: 'measurement.distance_milestone',
    payload: (w) => ({
      thresholdDistanceMm: '20000000',
      observedLifetimeDistanceMm: String(Math.max(20_000_000, Math.round(w.lifetimeMm))),
    }),
  },
  {
    at: 100,
    type: 'measurement.distance_streak',
    payload: () => ({ days: 3, minimumDailyDistanceMm: '5000000', endingUtcDate: wheelDay(Date.now() - 86_400_000) }),
  },
];

/** Wheel days run noon to noon UTC and are named after the noon they start on. */
function wheelDay(ms: number): string {
  return new Date(ms - 12 * 3_600_000).toISOString().slice(0, 10);
}

interface World {
  loop: number;
  t: number;
  rpm: number;
  speed: number;
  todayMm: number;
  lifetimeMm: number;
  work: number;
  projectedUnits: number;
  anchorUnits: number;
  anchorRound: number;
  anchorConfirmedAt: number;
  lastOnlineAt: number;
  settlements: number;
  minted: bigint;
  lastSettlement: { round: number; blocks: number; at: number } | null;
  topSpeed: number;
  peakRpm: number;
  sprintPeak: number;
  events: Array<{ id: string; type: string; occurredAt: string; payload: Record<string, unknown> }>;
}

function phaseAt(t: number): Phase {
  for (const p of SCRIPT) if (t < p.until) return p;
  return SCRIPT[SCRIPT.length - 1] as Phase;
}

function rpmAt(t: number, active: boolean): number {
  if (!active) return 0;
  if ((t >= 28 && t < 33) || (t >= 55 && t < 60)) return 117 + Math.sin(t * 3) * 1.5; // sprints
  return 92 + 9 * Math.sin(t / 7) + 5 * Math.sin(t / 2.3) + 2 * Math.sin(t * 1.7);
}

function freshWorld(): World {
  const anchorUnits = 2_070_384_421_937;
  return {
    loop: 0,
    t: 0,
    rpm: 0,
    speed: 0,
    todayMm: 2_950_000,
    lifetimeMm: 19_950_000,
    work: 0,
    projectedUnits: anchorUnits,
    anchorUnits,
    anchorRound: 334,
    anchorConfirmedAt: Date.now() - 6 * 60_000,
    lastOnlineAt: Date.now(),
    settlements: 291,
    minted: 8_106_342n * 10n ** 18n,
    lastSettlement: null,
    topSpeed: 1628,
    peakRpm: 111_256,
    sprintPeak: 0,
    events: [],
  };
}

function typicalDay(): Array<Record<string, unknown>> {
  const busy = (minute: number): number => {
    if (minute >= 1260 || minute < 180) return 1_350_000; // 21:00 to 03:00 UTC
    if (minute >= 330 && minute < 420) return 900_000; // 05:30 to 07:00 UTC
    return 0;
  };
  return Array.from({ length: 48 }, (_, i) => ({
    startMinuteUtc: i * 30,
    totalWorkUnits: '0',
    observedDayCount: 3,
    meanWorkMilli: String(busy(i * 30)),
  }));
}

function statusJson(w: World): unknown {
  const p = phaseAt(w.t);
  const now = Date.now();
  const receivedAt = p.online ? now - 400 : w.lastOnlineAt;
  const anchorHeight = Math.floor(w.anchorUnits / UNITS_PER_BLOCK);
  const projectedHeight = Math.floor(w.projectedUnits / UNITS_PER_BLOCK);
  return {
    installationId: 'rehearsal',
    generatedAt: new Date(now).toISOString(),
    measurement: {
      freshness: p.online ? 'online' : 'stale',
      observedAt: new Date(receivedAt - 300).toISOString(),
      receivedAt: new Date(receivedAt).toISOString(),
      staleAfterSeconds: 120,
      provenance: 'simulated',
      coreStatus: p.core,
      rpmMilli: Math.round(w.rpm * 1000),
      speedMmPerSecond: Math.round(w.speed),
      distanceMm: Math.round(w.todayMm),
    },
    builder: {
      status: 'available',
      anchor: {
        settledThroughRound: String(w.anchorRound),
        cumulativeWork: String(22_542 + Math.floor(w.work)),
        blockHeight: String(anchorHeight),
        blockProgress: String(w.anchorUnits % UNITS_PER_BLOCK),
        workPerThousandBlocks: String(WORK_PER_THOUSAND_BLOCKS),
        cumulativeBlockUnits: String(w.anchorUnits),
        confirmedAt: new Date(w.anchorConfirmedAt).toISOString(),
        transactionHash: null,
      },
      projected: {
        blockHeight: String(projectedHeight),
        blockProgress: String(w.projectedUnits % UNITS_PER_BLOCK),
      },
    },
  };
}

const HALF_HOUR = 1_800_000;

/**
 * Half-hour totals for yesterday's and today's wheel day (noon to noon UTC), with
 * an earlier session that ended half an hour ago. Until the first scripted lap,
 * the run card shows that session as an estimated last run.
 */
function halfHourDays(now: number): { window: Record<string, unknown>; days: Array<Record<string, unknown>> } {
  const noon = 12 * 3_600_000;
  const today = Math.floor((now - noon) / 86_400_000) * 86_400_000 + noon;
  const slot = Math.floor(now / HALF_HOUR) * HALF_HOUR;
  const earlier = new Map<number, number>([
    [slot - 5 * HALF_HOUR, 520],
    [slot - 4 * HALF_HOUR, 1_410],
    [slot - 3 * HALF_HOUR, 980],
    [slot - 2 * HALF_HOUR, 260],
  ]);
  const days = [today - 86_400_000, today].map((start) => ({
    date: new Date(start).toISOString().slice(0, 10),
    buckets: Array.from({ length: 48 }, (_, k) => {
      const from = start + k * HALF_HOUR;
      const d = new Date(from);
      const future = from > now;
      return {
        startMinuteUtc: d.getUTCHours() * 60 + d.getUTCMinutes(),
        coverage: future ? 'future' : from === slot ? 'partial' : 'complete',
        observedRoundCount: future ? 0 : from === slot ? Math.floor((now - slot) / 600_000) : 3,
        workUnits: future ? null : String(earlier.get(from) ?? 0),
      };
    }),
  }));
  return {
    window: { startAt: new Date(today - 86_400_000).toISOString(), bucketSeconds: 1800, roundSeconds: 600 },
    days,
  };
}

function statsJson(w: World): unknown {
  const iso = (ms: number): string => new Date(ms).toISOString();
  const now = Date.now();
  const history = halfHourDays(now);
  return {
    window: history.window,
    lifetime: {
      observedDistanceMm: String(Math.round(w.lifetimeMm)),
      acceptedWorkUnits: String(22_592 + Math.floor(w.work)),
      settledBlockCount: String(Math.floor(w.anchorUnits / UNITS_PER_BLOCK)),
      settlementCount: String(w.settlements),
      activeDayCount: 3,
    },
    records: {
      peakObservedSpeedMmPerSecond: { value: String(w.topSpeed), occurredAt: iso(now - 3_600_000), coverage: 'partial' },
      peakObservedRpmMilli: { value: String(w.peakRpm), occurredAt: iso(now - 3_600_000), coverage: 'partial' },
      maximumDailyDistanceMm: { value: '9817796', occurredAt: iso(now - 2 * 86_400_000), coverage: 'partial' },
      mostWorkHalfHour: { value: '1827', occurredAt: iso(now - 86_400_000), coverage: 'complete' },
      longestActiveWindowMinutes: { value: '90', occurredAt: iso(now - 2 * 86_400_000), coverage: 'partial' },
      longestActiveDayStreak: { value: '3', occurredAt: iso(now - 2 * 86_400_000), coverage: 'partial' },
    },
    activity: { typicalDay: typicalDay(), days: history.days },
  };
}

function settlementsJson(w: World): unknown {
  const s = w.lastSettlement;
  return {
    status: 'available',
    recentSettlements: s
      ? [
          {
            settledThroughRound: String(s.round),
            completedBlockCount: String(s.blocks),
            workAdded: '0',
            sqkMintedBaseUnits: String(BigInt(s.blocks) * SQK_PER_BLOCK),
            blockTimestamp: new Date(s.at).toISOString(),
            transactionHash: null,
          },
        ]
      : [],
  };
}

export function startDemoFeed(hub: Hub, needs: Needs): () => void {
  const w = freshWorld();
  let last = Date.now();
  let lastT = 0;

  const step = (): void => {
    const now = Date.now();
    const dt = Math.min(5, (now - last) / 1000);
    last = now;
    lastT = w.t;
    w.t += dt;
    if (w.t >= LOOP_S) {
      const keep = { minted: w.minted, settlements: w.settlements, events: w.events, loop: w.loop + 1 };
      Object.assign(w, freshWorld(), keep, { t: w.t - LOOP_S });
      lastT = 0;
    }
    const p = phaseAt(w.t);
    if (p.online) w.lastOnlineAt = now - 400;
    w.rpm = rpmAt(w.t, p.core === 'ACTIVE');
    w.speed = (w.rpm / 60) * MM_PER_REV;
    const travelled = w.speed * dt;
    w.todayMm += travelled;
    w.lifetimeMm += travelled;
    const work = travelled / MM_PER_REV;
    w.work += work;
    w.projectedUnits += Math.round((work * 1000 * UNITS_PER_BLOCK) / WORK_PER_THOUSAND_BLOCKS);
    if (w.t >= 55 && w.t < 58) w.sprintPeak = Math.max(w.sprintPeak, w.speed);

    for (const at of SETTLE_AT) {
      if (lastT < at && w.t >= at) {
        const before = Math.floor(w.anchorUnits / UNITS_PER_BLOCK);
        w.anchorUnits = w.projectedUnits;
        const blocks = Math.floor(w.anchorUnits / UNITS_PER_BLOCK) - before;
        w.anchorRound += 2;
        w.anchorConfirmedAt = now;
        w.settlements += 1;
        w.minted += BigInt(blocks) * SQK_PER_BLOCK;
        w.lastSettlement = { round: w.anchorRound, blocks, at: now };
        if (needs.settlements) hub.settlementsOk(readSettlements(settlementsJson(w)));
        if (needs.economy) {
          hub.economyOk(readEconomy({ status: 'available', supply: { totalMintedBaseUnits: w.minted.toString() } }));
        }
      }
    }
    for (const ev of EVENTS) {
      if (lastT < ev.at && w.t >= ev.at) {
        w.events.unshift({
          id: `rehearsal:${w.loop}:${ev.type}`,
          type: ev.type,
          occurredAt: new Date(now).toISOString(),
          payload: ev.payload(w),
        });
        w.events = w.events.slice(0, 40);
      }
    }

    hub.statusOk(readStatus(statusJson(w)), true, now);
  };

  step();
  const statusTimer = setInterval(step, 1000);
  const timers: Array<ReturnType<typeof setInterval>> = [statusTimer];
  if (needs.events) {
    timers.push(setInterval(() => hub.eventsOk(readEvents({ status: 'available', events: w.events })), 1500));
  }
  if (needs.stats) {
    hub.statsOk(readStats(statsJson(w)));
    timers.push(setInterval(() => hub.statsOk(readStats(statsJson(w))), 5000));
  }
  if (needs.settlements) hub.settlementsOk(readSettlements(settlementsJson(w)));
  if (needs.economy) {
    hub.economyOk(readEconomy({ status: 'available', supply: { totalMintedBaseUnits: w.minted.toString() } }));
  }
  return () => {
    for (const t of timers) clearInterval(t);
  };
}
