// The overlay's single source of truth. Feeds (live API or demo script) push
// snapshots in; scenes subscribe to state and to alerts. All decisions about what
// is news are delegated to the pure functions in logic/rules.ts and logic/run.ts.

import {
  lastRunFromHalfHours,
  pictureOf,
  recapOf,
  RUN_START,
  seedRun,
  speedHints,
  stepRun,
  workScale,
} from '../logic/run.ts';
import type { RunMemory, RunPicture, RunTiming } from '../logic/run.ts';
import {
  admitEvents,
  alertFromEvent,
  allowed,
  assessSignal,
  BLOCKS_START,
  moodOf,
  ON_AIR_TIMING,
  PRESENCE_START,
  stepBlocks,
  stepPresence,
  wakeHint,
} from '../logic/rules.ts';
import type {
  AlertItem,
  AlertKind,
  BlockMemory,
  EventGate,
  Mood,
  PresenceMemory,
  PresenceTiming,
  SignalReport,
  WakeHint,
} from '../logic/rules.ts';
import { sampleAlert } from '../logic/samples.ts';
import type { EconomySnap, EventsSnap, SettlementsSnap, StatsSnap, StatusSnap, WireEvent } from '../logic/wire.ts';

export interface HubState {
  /** Local clock at the time of this update. */
  now: number;
  /** Best estimate of the API's clock at the time of this update. */
  serverNow: number;
  status: StatusSnap | null;
  stats: StatsSnap | null;
  settlements: SettlementsSnap | null;
  economy: EconomySnap | null;
  signal: SignalReport;
  mood: Mood | null;
  hint: WakeHint | null;
  /** The run in progress, else the last one watched, else the last one in the half-hour totals. */
  run: RunPicture | null;
  demo: boolean;
}

/** How long after tuning in mid-run the page keeps trying to estimate what it missed. */
const SEED_WINDOW_MS = 90_000;

export interface HubOptions {
  demo: boolean;
  timing?: PresenceTiming;
  muted?: ReadonlySet<AlertKind>;
}

type StateListener = (state: HubState) => void;
type AlertListener = (alert: AlertItem) => void;

export class Hub {
  readonly startedAt = Date.now();
  private readonly demo: boolean;
  private readonly timing: PresenceTiming;
  private readonly muted: ReadonlySet<AlertKind>;
  private offsetMs = 0;
  private offsetKnown = false;
  private statusOkAt: number | null = null;
  private status: StatusSnap | null = null;
  private stats: StatsSnap | null = null;
  private settlements: SettlementsSnap | null = null;
  private economy: EconomySnap | null = null;
  private presence: PresenceMemory = PRESENCE_START;
  private blocks: BlockMemory = BLOCKS_START;
  private gate: EventGate | null = null;
  private run: RunMemory = RUN_START;
  private readonly runTiming: RunTiming;
  private recentEvents: WireEvent[] = [];
  private testSeq = 0;
  private readonly stateListeners: StateListener[] = [];
  private readonly alertListeners: AlertListener[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(options: HubOptions) {
    this.demo = options.demo;
    this.timing = options.timing ?? ON_AIR_TIMING;
    this.muted = options.muted ?? new Set();
    // A run ends when "went to sleep" would, and one too short to count as waking up gets no recap.
    this.runTiming = { endHoldMs: this.timing.sleepHoldMs, minRunMs: this.timing.wakeHoldMs };
  }

  /** Re-evaluate time-based state (signal age, "x min ago") once a second. */
  start(): void {
    if (this.ticker === null) this.ticker = setInterval(() => this.emit(), 1000);
  }

  subscribe(fn: StateListener): void {
    this.stateListeners.push(fn);
    fn(this.snapshot(Date.now()));
  }

  onAlert(fn: AlertListener): void {
    this.alertListeners.push(fn);
  }

  get serverOffsetMs(): number {
    return this.offsetMs;
  }

  // ------------------------------------------------------------ ingestion

  statusOk(snap: StatusSnap, changed: boolean, at: number): void {
    if (changed && snap.generatedAt !== null) {
      const sample = snap.generatedAt - at;
      this.offsetMs = this.offsetKnown ? this.offsetMs * 0.8 + sample * 0.2 : sample;
      this.offsetKnown = true;
    }
    this.status = snap;
    this.statusOkAt = at;

    const signal = this.signalAt(at);
    const t = snap.telemetry;
    const core = signal.state === 'ok' ? (t?.coreStatus ?? null) : null;

    // The run goes first, so its recap airs before "back to bed" when both land on one reading.
    const serverAt = at + this.offsetMs;
    const reading =
      core !== null && t
        ? { at: serverAt, observedAt: t.observedAt, coreStatus: core, mmps: t.speedMmPerSecond, dayMm: t.distanceMm }
        : null;
    const runStep = stepRun(this.run, reading, this.runTiming);
    this.run = runStep.memory;
    this.seedJoinedRun(serverAt);
    const recap = runStep.ended ? recapOf(runStep.ended, this.runTiming) : null;
    if (runStep.ended && recap) {
      this.raise({
        kind: 'run_recap',
        key: `run:${runStep.ended.trackedFrom}`,
        at: recap.endedAt,
        startedAt: recap.startedAt,
        durationMs: recap.durationMs,
        distanceMm: recap.distanceMm,
        topMmps: recap.topMmps,
        estimated: recap.estimated,
        partial: recap.partial,
      });
    }

    const before = this.presence;
    const step = stepPresence(before, core, at, this.timing);
    this.presence = step.memory;
    if (step.flipped) {
      // Date the change from when it started, not from when the hold ran out.
      const startedAt = (before.pending === step.flipped ? before.pendingSince : at) + this.offsetMs;
      if (step.flipped === 'awake') {
        this.raise({ kind: 'wake', key: `wake:${startedAt}`, at: startedAt, rpmMilli: snap.telemetry?.rpmMilli ?? null });
      } else {
        this.raise({ kind: 'sleep', key: `sleep:${startedAt}`, at: startedAt, todayMm: snap.telemetry?.distanceMm ?? null });
      }
    }

    const height = snap.builder.ok ? snap.builder.anchor.blockHeight : null;
    const blocks = stepBlocks(this.blocks, height, snap.installationId);
    this.blocks = blocks.memory;
    if (blocks.gained) {
      const g = blocks.gained;
      this.raise({ kind: 'blocks', key: `blocks:${g.first}-${g.last}`, count: g.count, first: g.first, last: g.last });
    }
    this.emit(at);
  }

  statusFailed(at: number): void {
    // Keep stepping the presence machine with "no reading" so a pending change
    // cannot complete across an outage.
    if (this.signalAt(at).state !== 'ok') {
      this.presence = stepPresence(this.presence, null, at, this.timing).memory;
      this.run = stepRun(this.run, null, this.runTiming).memory;
    }
    this.emit(at);
  }

  eventsOk(snap: EventsSnap): void {
    if (!snap.available) return;
    this.recentEvents = snap.events;
    this.seedJoinedRun(Date.now() + this.offsetMs);
    if (this.gate === null) this.gate = { openedAt: this.startedAt + this.offsetMs, seen: [] };
    const result = admitEvents(this.gate, snap.events);
    this.gate = result.gate;
    for (const ev of result.fresh) {
      const alert = alertFromEvent(ev);
      if (alert) this.raise(alert);
    }
  }

  statsOk(snap: StatsSnap): void {
    this.stats = snap;
    this.seedJoinedRun(Date.now() + this.offsetMs);
    this.emit();
  }

  /**
   * A run already under way when the page tuned in gets its unseen start
   * estimated from the half-hour totals, once, in the first minute or so.
   */
  private seedJoinedRun(serverNow: number): void {
    const run = this.run.current;
    if (!run || !run.joinedLate || run.seed !== null || !this.stats) return;
    if (serverNow - run.trackedFrom > SEED_WINDOW_MS) return;
    const seed = seedRun({
      ...workScale(this.stats),
      halfHours: this.stats.halfHours,
      trackedFrom: run.trackedFrom,
      dayMmAtStart: run.dayMmAtStart,
      dayStartMinute: this.stats.dayStartMinute,
      hints: speedHints(this.stats, this.recentEvents),
    });
    if (seed) this.run = { ...this.run, current: { ...run, seed } };
  }

  private runPicture(serverNow: number): RunPicture | null {
    const stats = this.stats;
    const past =
      this.run.current || this.run.last || !stats
        ? null
        : lastRunFromHalfHours({
            ...workScale(stats),
            halfHours: stats.halfHours,
            now: serverNow,
            hints: speedHints(stats, this.recentEvents),
          });
    return pictureOf(this.run, past, serverNow);
  }

  settlementsOk(snap: SettlementsSnap): void {
    this.settlements = snap;
    this.emit();
  }

  economyOk(snap: EconomySnap): void {
    this.economy = snap;
    this.emit();
  }

  /** Studio test buttons: a believable alert built from current numbers, marked as a test. */
  fireTest(kind: AlertKind): void {
    this.testSeq += 1;
    const now = Date.now() + this.offsetMs;
    const alert = sampleAlert(kind, {
      now,
      seq: this.testSeq,
      status: this.status,
      stats: this.stats,
      run: this.runPicture(now),
    });
    for (const fn of this.alertListeners) fn(alert);
  }

  // ------------------------------------------------------------ output

  private raise(alert: AlertItem): void {
    if (!allowed(alert, this.muted)) return;
    for (const fn of this.alertListeners) fn(alert);
  }

  private signalAt(now: number): SignalReport {
    return assessSignal({
      now,
      serverOffsetMs: this.offsetMs,
      startedAt: this.startedAt,
      lastOkAt: this.statusOkAt,
      telemetry: this.status?.telemetry ?? null,
    });
  }

  snapshot(now: number): HubState {
    const signal = this.signalAt(now);
    const core = signal.state === 'ok' ? (this.status?.telemetry?.coreStatus ?? null) : null;
    const serverNow = now + this.offsetMs;
    return {
      now,
      serverNow,
      status: this.status,
      stats: this.stats,
      settlements: this.settlements,
      economy: this.economy,
      signal,
      mood: moodOf(this.presence, core),
      hint: this.stats ? wakeHint(this.stats.typicalDay, serverNow) : null,
      run: this.runPicture(serverNow),
      demo: this.demo,
    };
  }

  private emit(now = Date.now()): void {
    if (this.stateListeners.length === 0) return;
    const state = this.snapshot(now);
    for (const fn of this.stateListeners) fn(state);
  }
}
