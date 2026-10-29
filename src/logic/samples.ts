// Believable sample alerts for the studio's test buttons. They borrow the live
// numbers when we have them so a test looks like the real thing would tonight.

import type { AlertItem, AlertKind } from './rules.ts';
import type { RunPicture } from './run.ts';
import type { StatsSnap, StatusSnap } from './wire.ts';

export interface SampleContext {
  now: number;
  seq: number;
  status: StatusSnap | null;
  stats: StatsSnap | null;
  run?: RunPicture | null;
}

/** Lifetime distance milestones the API announces: 1, 3, 5, 10, 15, 20, 30 ... 100 km, then every 50 km. */
export function nextDistanceMilestoneMm(lifetimeMm: bigint): bigint {
  const km = [1n, 3n, 5n, 10n, 15n, 20n, 30n, 40n, 50n, 60n, 70n, 80n, 90n, 100n];
  for (const k of km) if (k * 1_000_000n > lifetimeMm) return k * 1_000_000n;
  const step = 50_000_000n;
  return (lifetimeMm / step + 1n) * step;
}

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function sampleAlert(kind: AlertKind, ctx: SampleContext): AlertItem {
  const key = `test:${kind}:${ctx.seq}`;
  const at = ctx.now;
  const base = { key, test: true };
  switch (kind) {
    case 'wake':
      return { ...base, kind, at, rpmMilli: 96_400 };
    case 'sleep':
      return { ...base, kind, at, todayMm: ctx.status?.telemetry?.distanceMm ?? 4_210_000 };
    case 'run_recap': {
      // A run this source watched, if it is worth showing; otherwise a typical evening's.
      const r = ctx.run;
      const run = r && r.source === 'live' && r.distanceMm >= 10_000 && r.durationMs >= 60_000 ? r : null;
      if (run) {
        return {
          ...base,
          kind,
          at,
          startedAt: run.startedAt,
          durationMs: run.durationMs,
          distanceMm: run.distanceMm,
          topMmps: run.topMmps,
          estimated: run.estimated,
          partial: run.partial,
        };
      }
      const durationMs = 41 * 60_000;
      return {
        ...base,
        kind,
        at,
        startedAt: at - durationMs,
        durationMs,
        distanceMm: 2_310_400,
        topMmps: 1_590,
        estimated: false,
        partial: false,
      };
    }
    case 'speed_record': {
      const previous = ctx.stats?.records.topSpeedMmps?.value ?? 1_628n;
      return { ...base, kind, at, recordMmps: previous + 61n, previousMmps: previous };
    }
    case 'distance_milestone': {
      const lifetime = ctx.stats?.lifetime?.distanceMm ?? 19_835_776n;
      const threshold = nextDistanceMilestoneMm(lifetime);
      return { ...base, kind, at, thresholdMm: threshold, observedMm: threshold + 4_120n };
    }
    case 'daily_distance_milestone':
      return { ...base, kind, at, thresholdMm: 5_000_000n, observedMm: 5_001_966n, utcDate: utcDate(at) };
    case 'speed_milestone':
      return { ...base, kind, at, thresholdMmps: 1_667n, observedMmps: 1_694n };
    case 'distance_streak':
      return { ...base, kind, at, days: 3, minimumMm: 5_000_000n, endingUtcDate: utcDate(at - 86_400_000) };
    case 'blocks': {
      const height = ctx.status?.builder.ok ? ctx.status.builder.anchor.blockHeight : 2_070n;
      return { ...base, kind, count: 12n, first: height + 1n, last: height + 12n };
    }
  }
}
