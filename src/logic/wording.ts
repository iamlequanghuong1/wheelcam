// Everything the graphics say, in one place. Pure functions from data to text.
// Unknown values are left out or printed as UNKNOWN; they never become zeros.

import {
  ago,
  blockFraction,
  count,
  dayLabel,
  durationWords,
  grouped,
  km,
  kmh,
  minuteClock,
  rpm,
  scaled,
  sqk,
  utcClock,
  UNKNOWN,
} from './units.ts';
import type { AlertItem, Mood, SignalReport, WakeHint } from './rules.ts';
import type { RunPicture } from './run.ts';
import type { EconomySnap, SettlementsSnap, StatsSnap, StatusSnap } from './wire.ts';

export type Tone = 'record' | 'milestone' | 'status' | 'chain';

export interface AlertCopy {
  tag: string;
  headline: string;
  detail: string;
  tone: Tone;
}

const MARATHON_MM = 42_195_000n;
const TRACK_LAP_MM = 400_000n;

/** Whole kilometres when the value is whole, one decimal otherwise. */
export function kmShort(mm: bigint): string {
  return mm % 1_000_000n === 0n ? scaled(mm, 6, 0) : scaled(mm, 6, 1);
}

/** Run distance split for the card: whole metres under a kilometre, then km with two decimals. */
export function runDistance(mm: number | null): { value: string; unit: string } {
  if (mm === null || !Number.isFinite(mm) || mm < 0) return { value: UNKNOWN, unit: 'km' };
  if (mm < 999_500) return { value: String(Math.floor(mm / 1000)), unit: 'm' };
  return { value: km(mm), unit: 'km' };
}

function marathonLine(mm: bigint): string {
  if (mm < MARATHON_MM) {
    const pct = (mm * 100n + MARATHON_MM / 2n) / MARATHON_MM;
    return `That is ${pct}% of a marathon.`;
  }
  return `That is ${scaled((mm * 10n) / MARATHON_MM, 1, 1)} marathons.`;
}

export function describeAlert(item: AlertItem): AlertCopy {
  switch (item.kind) {
    case 'wake': {
      const speed = item.rpmMilli !== null && item.rpmMilli > 0 ? `, already doing ${rpm(item.rpmMilli)} rpm` : '';
      return {
        tag: 'Wake-up call',
        headline: 'Squeektoshi is up',
        detail: `On the wheel at ${utcClock(item.at)} UTC${speed}.`,
        tone: 'status',
      };
    }
    case 'sleep':
      return {
        tag: 'Lights out',
        headline: 'Back to bed',
        detail:
          item.todayMm !== null
            ? `The wheel has gone quiet. ${km(item.todayMm)} km on today's clock.`
            : 'The wheel has gone quiet. Sweet dreams, champ.',
        tone: 'status',
      };
    case 'run_recap': {
      const d = runDistance(item.distanceMm);
      const top = item.topMmps !== null && item.topMmps > 0 ? `, top speed ${kmh(item.topMmps)} km/h` : '';
      const how = item.estimated
        ? ' Start estimated: this source tuned in mid-run.'
        : item.partial
          ? ` Counted from ${utcClock(item.startedAt)} UTC, when this source tuned in.`
          : ` Started ${utcClock(item.startedAt)} UTC.`;
      return {
        tag: 'Run recap',
        // Plates are set in capitals, where "140 M" would read as millions.
        headline: `${item.estimated ? 'About ' : ''}${d.value} ${d.unit === 'm' ? 'metres' : d.unit}`,
        detail: `${durationWords(item.durationMs)} on the wheel${top}.${how}`,
        tone: 'milestone',
      };
    }
    case 'speed_record':
      return {
        tag: 'New record',
        headline: `${kmh(item.recordMmps)} km/h`,
        detail:
          item.previousMmps !== null
            ? `Fastest Squeektoshi has ever run. Old mark: ${kmh(item.previousMmps)} km/h.`
            : 'Fastest Squeektoshi has ever run.',
        tone: 'record',
      };
    case 'distance_milestone':
      return {
        tag: 'Lifetime milestone',
        headline: `${kmShort(item.thresholdMm)} km`,
        detail: `Lifetime on the WHEELY9000. ${marathonLine(item.thresholdMm)}`,
        tone: 'milestone',
      };
    case 'daily_distance_milestone':
      return {
        tag: 'Daily milestone',
        headline: `${kmShort(item.thresholdMm)} km today`,
        detail:
          item.observedMm !== null
            ? `${km(item.observedMm)} km on the clock and the legs are still going.`
            : 'And the legs are still going.',
        tone: 'milestone',
      };
    case 'speed_milestone':
      return {
        tag: 'Speed trap',
        headline: `${kmh(item.thresholdMmps, 0)} km/h`,
        detail:
          item.observedMmps !== null
            ? `Clocked at ${kmh(item.observedMmps, 2)} km/h on the WHEELY9000.`
            : 'Clocked on the WHEELY9000.',
        tone: 'milestone',
      };
    case 'distance_streak': {
      const floor = item.minimumMm !== null ? `${kmShort(item.minimumMm)} km or more` : 'Real distance';
      const through = dayLabel(item.endingUtcDate);
      return {
        tag: 'Streak',
        headline: `${item.days} days in a row`,
        detail: `${floor} every day${through ? ` through ${through}` : ''}. Consistency is a hamster virtue.`,
        tone: 'record',
      };
    }
    case 'blocks': {
      const one = item.count === 1n;
      return {
        tag: 'Squeek blocks',
        headline: `+${grouped(item.count)} ${one ? 'block' : 'blocks'}`,
        detail: one
          ? `Block #${grouped(item.last)} settled on Sepolia.`
          : `Blocks #${grouped(item.first)} to #${grouped(item.last)} settled on Sepolia.`,
        tone: 'chain',
      };
    }
  }
}

// ---------------------------------------------------------------- state words

export function moodWords(mood: Mood | null): string {
  switch (mood) {
    case 'running':
      return 'On the wheel';
    case 'breather':
      return 'Quick breather';
    case 'stirring':
      return 'Stirring';
    case 'asleep':
      return 'Asleep';
    default:
      return 'Tuning in';
  }
}

/** The short state line: the signal problem if there is one, otherwise the mood. */
export function stateWords(report: SignalReport, mood: Mood | null): string {
  if (report.state === 'lost') return 'No signal';
  if (report.state === 'fault') return 'Sensor fault';
  return moodWords(mood);
}

export function signalWords(report: SignalReport): { title: string; detail: string } {
  if (report.state === 'fault') return { title: 'Sensor fault', detail: 'The wheel counter reported a fault.' };
  if (report.state === 'tuning') return { title: 'Tuning in', detail: 'Finding the wheel feed.' };
  const since = report.lastSeenAt !== null ? ` Last reading ${utcClock(report.lastSeenAt)} UTC.` : '';
  switch (report.reason) {
    case 'device-quiet':
      return { title: 'Signal lost', detail: `The wheel sensor went quiet.${since}` };
    case 'no-measurement':
      return { title: 'Signal lost', detail: 'No wheel reading available yet.' };
    default:
      return { title: 'Signal lost', detail: `No answer from the wheel feed. Retrying.${since}` };
  }
}

/** When he usually turns up. `short` drops "usually" for tight spaces. */
export function hintWords(hint: WakeHint | null, short = false): string | null {
  if (!hint) return null;
  if (hint.kind === 'overdue') return 'Running late';
  return `${short ? 'Up' : 'Usually up'} around ${minuteClock(hint.minute)} UTC`;
}

// ---------------------------------------------------------------- run card

/** Where the run card's numbers come from, in one line. */
export function runNote(p: RunPicture): string {
  if (p.source === 'history') return 'Pieced together from half-hour totals, so times are approximate.';
  const tunedIn = utcClock(p.trackedFrom ?? p.startedAt);
  if (p.estimated) return `Tuned in mid-run at ${tunedIn} UTC. The earlier part is estimated from half-hour totals.`;
  if (p.partial) return `Tuned in mid-run at ${tunedIn} UTC and counting from there.`;
  if (p.phase === 'finished' && p.endedAt !== null) {
    return `Watched live from ${utcClock(p.startedAt)} to ${utcClock(p.endedAt)} UTC.`;
  }
  return `Live since ${utcClock(p.startedAt)} UTC. Short breathers stay in the run.`;
}

export interface EmptyRunInput {
  signal: SignalReport;
  mood: Mood | null;
  hint: WakeHint | null;
  /** The stats feed answered, so "no run on record" is a fact rather than a gap. */
  historyKnown: boolean;
}

/** The run card with no run to show: the normal state for most of the day. */
export function emptyRunWords(input: EmptyRunInput): { title: string; detail: string } {
  if (input.signal.state === 'tuning') return { title: 'Tuning in', detail: 'Finding the wheel feed.' };
  if (input.signal.state !== 'ok') {
    return { title: 'Waiting for the wheel', detail: 'Runs are tracked again once the feed is back.' };
  }
  const when =
    input.hint?.kind === 'overdue'
      ? 'He is usually on the wheel by now.'
      : input.hint
        ? `${hintWords(input.hint)}.`
        : 'The wheel waits.';
  const asleep = input.mood === 'asleep' ? `Squeektoshi is asleep. ${when}` : 'The trace starts with his first lap.';
  if (!input.historyKnown) return { title: "Wheel's quiet", detail: asleep };
  return { title: 'No runs this week', detail: input.mood === 'asleep' ? asleep : 'Not a lap on record yet. The trace starts with his first one.' };
}

// ---------------------------------------------------------------- lower third footer

export interface SettledLine {
  text: string;
  late: boolean;
}

/** "Round 334 settled 9 min ago", flagged late after 25 minutes (settlements land about every 10). */
export function settledLine(status: StatusSnap | null, serverNow: number): SettledLine | null {
  if (!status || !status.builder.ok) return null;
  const a = status.builder.anchor;
  if (a.confirmedAt === null) return { text: `Settled through round ${grouped(a.settledThroughRound)}`, late: false };
  const age = serverNow - a.confirmedAt;
  return { text: `Round ${grouped(a.settledThroughRound)} settled ${ago(age)}`, late: age > 25 * 60_000 };
}

/** Blocks the builder has projected but not settled yet. */
export function queuedBlocks(status: StatusSnap | null): bigint | null {
  if (!status || !status.builder.ok || !status.builder.projected) return null;
  const gap = status.builder.projected.blockHeight - status.builder.anchor.blockHeight;
  return gap > 0n ? gap : null;
}

export function progressWords(status: StatusSnap | null): { height: string; next: string; fraction: number | null } {
  if (!status || !status.builder.ok) return { height: UNKNOWN, next: 'Chain data unavailable', fraction: null };
  const a = status.builder.anchor;
  const fraction = blockFraction(a.blockProgress);
  const pct = fraction === null ? UNKNOWN : `${Math.floor(fraction * 100)}%`;
  return { height: grouped(a.blockHeight), next: `${pct} to #${grouped(a.blockHeight + 1n)}`, fraction };
}

// ---------------------------------------------------------------- ticker

export interface Fact {
  key: string;
  tag: string;
  text: string;
}

export interface FactInput {
  serverNow: number;
  status: StatusSnap | null;
  signal: SignalReport;
  mood: Mood | null;
  stats: StatsSnap | null;
  settlements: SettlementsSnap | null;
  economy: EconomySnap | null;
  hint: WakeHint | null;
}

/** Metres of wheel travel per work unit, measured from lifetime totals. */
function metresPerWork(stats: StatsSnap | null): number | null {
  const l = stats?.lifetime;
  if (!l || l.acceptedWork === 0n) return null;
  return Number(l.distanceMm) / Number(l.acceptedWork) / 1000;
}

function nowFact(input: FactInput): Fact | null {
  const { signal, mood, status } = input;
  if (signal.state === 'lost') {
    return { key: 'now', tag: 'Wheel feed', text: 'Signal lost. Live numbers return the moment the sensor checks in.' };
  }
  if (signal.state === 'fault') {
    return { key: 'now', tag: 'Wheel feed', text: 'The wheel counter reported a fault. Live numbers are paused.' };
  }
  if (signal.state !== 'ok' || !mood) return null;
  switch (mood) {
    case 'running':
      return {
        key: 'now',
        tag: 'Now',
        text: `Squeektoshi is on the wheel at ${rpm(status?.telemetry?.rpmMilli)} rpm. Do not tap the glass.`,
      };
    case 'breather':
      return { key: 'now', tag: 'Now', text: 'Quick breather. The wheel is coasting, the hamster is thinking.' };
    case 'stirring':
      return { key: 'now', tag: 'Now', text: 'Something is stirring in the bedding.' };
    case 'asleep': {
      const h = input.hint;
      const tail =
        h?.kind === 'later'
          ? `Usually back on the wheel around ${minuteClock(h.minute)} UTC.`
          : h?.kind === 'overdue'
            ? 'He is usually on the wheel by now. The wheel waits.'
            : 'The wheel waits.';
      return { key: 'now', tag: 'Now', text: `Squeektoshi is asleep. ${tail}` };
    }
  }
}

export function tickerFacts(input: FactInput): Fact[] {
  const facts: Fact[] = [];
  const push = (f: Fact | null): void => {
    if (f) facts.push(f);
  };
  const { status, stats, settlements, economy } = input;
  const live = input.signal.state === 'ok' ? status?.telemetry ?? null : null;
  const perWork = metresPerWork(stats);

  push(nowFact(input));

  if (live) {
    push({
      key: 'today',
      tag: 'Today',
      text:
        live.distanceMm > 0
          ? `${km(live.distanceMm)} km on today's wheel clock, which resets at noon UTC.`
          : 'Not a single metre on the wheel today. Yet.',
    });
  }

  const lifetime = stats?.lifetime;
  if (lifetime) {
    const laps = lifetime.distanceMm / TRACK_LAP_MM;
    push({
      key: 'lifetime',
      tag: 'Lifetime',
      text: `${km(lifetime.distanceMm)} km on the WHEELY9000. That is ${grouped(laps)} laps of a running track.`,
    });
    push({
      key: 'settled',
      tag: 'On chain',
      text: `${count(lifetime.settledBlocks)} Squeek blocks settled on Sepolia across ${count(lifetime.settlements)} settlements.`,
    });
  }

  const queued = queuedBlocks(status);
  if (queued !== null) {
    push({
      key: 'queued',
      tag: 'In the oven',
      text: `${grouped(queued)} more ${queued === 1n ? 'block is' : 'blocks are'} baked and waiting for the next settlement.`,
    });
  }

  const latest = settlements?.available ? settlements.latest : null;
  if (latest) {
    const when = latest.at !== null ? ` ${ago(input.serverNow - latest.at)}` : '';
    const minted = latest.sqkMinted !== null ? ` and ${sqk(latest.sqkMinted)} test SQK` : '';
    push({
      key: 'payday',
      tag: 'Latest settlement',
      text:
        latest.completedBlockCount > 0n
          ? `Round ${grouped(latest.settledThroughRound)} paid out${when}: ${grouped(latest.completedBlockCount)} blocks${minted}.`
          : `Round ${grouped(latest.settledThroughRound)} settled${when}. No new blocks that time.`,
    });
  }

  if (economy?.available && economy.totalMinted !== null) {
    push({
      key: 'minted',
      tag: 'SQK',
      text: `${sqk(economy.totalMinted)} test SQK minted so far. Sepolia only: zero real money, maximum hamster.`,
    });
  }

  const r = stats?.records;
  if (r?.topSpeedMmps) {
    const when = r.topSpeedMmps.occurredAt;
    push({
      key: 'top-speed',
      tag: 'Record',
      text: `7-day top speed: ${kmh(r.topSpeedMmps.value)} km/h${when !== null ? `, set ${dayLabel(when)} at ${utcClock(when)} UTC` : ''}.`,
    });
  }
  if (r?.bestDayMm) {
    const when = r.bestDayMm.occurredAt;
    push({
      key: 'best-day',
      tag: 'Record',
      text: `Best day this week: ${km(r.bestDayMm.value)} km${when !== null ? ` on the ${dayLabel(when)} shift` : ''}.`,
    });
  }
  if (r?.busiestHalfHourWork) {
    const distance =
      perWork !== null ? `, roughly ${(Number(r.busiestHalfHourWork.value) * perWork / 1000).toFixed(1)} km of running` : '';
    push({
      key: 'half-hour',
      tag: 'Record',
      text: `Busiest half hour: ${grouped(r.busiestHalfHourWork.value)} work units${distance}.`,
    });
  }
  if (r?.longestWindowMinutes) {
    push({
      key: 'shift',
      tag: 'Record',
      text: `Longest shift: ${grouped(r.longestWindowMinutes.value)} minutes on the wheel without clocking off.`,
    });
  }
  if (r?.peakRpmMilli) {
    push({ key: 'peak-rpm', tag: 'Record', text: `Peak ${rpm(r.peakRpmMilli.value)} rpm. The WHEELY9000 survived.` });
  }
  if (r?.longestStreakDays && r.longestStreakDays.value > 1n) {
    push({
      key: 'streak',
      tag: 'Streak',
      text: `${grouped(r.longestStreakDays.value)} active days in a row is the streak to beat.`,
    });
  }

  if (status?.builder.ok && perWork !== null) {
    const perBlock = (Number(status.builder.anchor.workPerThousandBlocks) / 1000) * perWork;
    if (perBlock > 0 && Number.isFinite(perBlock)) {
      push({
        key: 'cost',
        tag: 'Difficulty',
        text: `One Squeek block costs about ${perBlock.toFixed(1)} m of running right now.`,
      });
    }
  }

  push({ key: 'lore', tag: 'Lore', text: 'The founder says Squeektoshi is named after a postal worker in LA.' });
  push({ key: 'credit', tag: 'WheelCam', text: 'Fan-made graphics. Live data from api.squeekchain.com.' });
  return facts;
}
