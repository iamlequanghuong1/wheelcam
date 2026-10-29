// Run card: this run as it happens. A live speed trace since he stepped on, the
// distance, the run clock, top and average speed. Between runs the last one
// stays up; anything pieced together from half-hour totals is stamped EST.

import type { Hub } from '../feed/hub.ts';
import type { RunPicture } from '../logic/run.ts';
import { kmh, stopwatch, utcClock, UNKNOWN } from '../logic/units.ts';
import { emptyRunWords, hintWords, runDistance, runNote, stateWords } from '../logic/wording.ts';
import { demoTag, el, mark, put, signalPlate, svg } from './kit.ts';

// Chart drawing area, in stage pixels.
const CW = 592;
const CH = 196;
const TOP = 22;
const BASE = CH - 3;
/** A young run fills the chart from the left until it is this old. */
const MIN_SPAN_MS = 120_000;
const KMH_PER_MMPS = 0.0036;
const GRID_KMH = [2, 4, 6, 8, 10, 12, 14];

interface Chart {
  root: SVGSVGElement;
  grid: Array<{ kmh: number; line: SVGLineElement; label: SVGTextElement }>;
  record: SVGLineElement;
  recordLabel: SVGTextElement;
  bars: SVGPathElement;
  estLabel: SVGTextElement;
  area: SVGPathElement;
  line: SVGPathElement;
  top: SVGCircleElement;
  topLabel: SVGTextElement;
  now: SVGCircleElement;
}

function buildChart(): Chart {
  const root = svg('svg', { viewBox: `0 0 ${CW} ${CH}`, class: 'rc-chart', 'aria-hidden': 'true' });
  // Painted first, so the grid stays readable over it.
  const area = svg('path', { class: 'rc-area' });
  root.appendChild(area);
  const grid = GRID_KMH.map((v) => {
    const line = svg('line', { x1: 0, x2: CW, class: 'rc-grid' });
    const label = svg('text', { x: 2, class: 'rc-grid-label' });
    root.append(line, label);
    return { kmh: v, line, label };
  });
  const record = svg('line', { x1: 0, x2: CW, class: 'rc-record' });
  const recordLabel = svg('text', { x: CW - 2, class: 'rc-record-label' });
  const bars = svg('path', { class: 'rc-bars' });
  const estLabel = svg('text', { class: 'rc-est-label' });
  estLabel.textContent = 'EST.';
  const line = svg('path', { class: 'rc-line' });
  const top = svg('circle', { r: 8, class: 'rc-top' });
  const topLabel = svg('text', { class: 'rc-top-label' });
  const now = svg('circle', { r: 9, class: 'rc-now' });
  root.append(record, recordLabel, bars, estLabel, line, top, topLabel, now);
  return { root, grid, record, recordLabel, bars, estLabel, area, line, top, topLabel, now };
}

const f1 = (n: number): string => n.toFixed(1);

function show(node: SVGElement, on: boolean): void {
  if (on) node.removeAttribute('display');
  else node.setAttribute('display', 'none');
}

/** Redraw the speed trace. Only numbers reach the SVG; labels go in as textContent. */
function drawChart(c: Chart, p: RunPicture | null, serverNow: number, recordMmps: number | null, live: boolean): void {
  const topKmh = (p?.topMmps ?? 0) * KMH_PER_MMPS;
  const recKmh = (recordMmps ?? 0) * KMH_PER_MMPS;
  const maxKmh = Math.max(6, Math.ceil(Math.max(topKmh * 1.12, recKmh * 1.06) / 2) * 2);
  const y = (mmps: number): number => BASE - Math.min(1, Math.max(0, (mmps * KMH_PER_MMPS) / maxKmh)) * (BASE - TOP);

  const visible = c.grid.filter((g) => g.kmh < maxKmh || g.kmh === maxKmh);
  const highest = visible[visible.length - 1];
  for (const g of c.grid) {
    const on = visible.includes(g);
    show(g.line, on);
    show(g.label, on);
    if (!on) continue;
    const gy = y(g.kmh / KMH_PER_MMPS);
    g.line.setAttribute('y1', f1(gy));
    g.line.setAttribute('y2', f1(gy));
    g.label.setAttribute('y', f1(gy - 6));
    g.label.textContent = g === highest ? `${g.kmh} KM/H` : String(g.kmh);
  }

  const hasRecord = recordMmps !== null && recordMmps > 0;
  show(c.record, hasRecord);
  show(c.recordLabel, hasRecord);
  if (hasRecord) {
    const ry = y(recordMmps);
    c.record.setAttribute('y1', f1(ry));
    c.record.setAttribute('y2', f1(ry));
    c.recordLabel.setAttribute('y', f1(ry - 8));
    c.recordLabel.textContent = `7-DAY BEST ${kmh(recordMmps)}`;
  }

  if (!p) {
    for (const node of [c.bars, c.estLabel, c.area, c.line, c.top, c.topLabel, c.now]) show(node, false);
    return;
  }

  const from = p.startedAt;
  const span = Math.max(MIN_SPAN_MS, (p.endedAt ?? serverNow) - from);
  const x = (t: number): number => Math.min(CW, Math.max(0, ((t - from) / span) * CW));

  // Estimated half-hour averages: a dashed step line.
  let bd = '';
  let prevTo: number | null = null;
  for (const b of p.bars) {
    const by = f1(y(b.mmps));
    bd += prevTo !== null && Math.abs(b.from - prevTo) < 1_000 ? `V${by}H${f1(x(b.to))}` : `M${f1(x(b.from))} ${by}H${f1(x(b.to))}`;
    prevTo = b.to;
  }
  c.bars.setAttribute('d', bd);
  show(c.bars, bd !== '');
  const firstBar = p.bars[0];
  const lastBar = p.bars[p.bars.length - 1];
  const estWide = firstBar && lastBar ? x(lastBar.to) - x(firstBar.from) : 0;
  show(c.estLabel, estWide >= 56);
  if (firstBar && lastBar) {
    c.estLabel.setAttribute('x', f1((x(firstBar.from) + x(lastBar.to)) / 2));
    c.estLabel.setAttribute('y', String(TOP + 2));
  }

  // The live trace, broken wherever readings stopped coming.
  const gapMs = Math.max(20_000, (4 * span) / Math.max(1, p.points.length));
  let d = '';
  let fill = '';
  let prevT = Number.NEGATIVE_INFINITY;
  let lastX = 0;
  let open = false;
  for (const pt of p.points) {
    const px = f1(x(pt.t));
    const py = f1(y(pt.mmps));
    if (pt.t - prevT > gapMs) {
      if (open) fill += `L${f1(lastX)} ${BASE}Z`;
      d += `M${px} ${py}`;
      fill += `M${px} ${BASE}L${px} ${py}`;
      open = true;
    } else {
      d += `L${px} ${py}`;
      fill += `L${px} ${py}`;
    }
    prevT = pt.t;
    lastX = x(pt.t);
  }
  if (open) fill += `L${f1(lastX)} ${BASE}Z`;
  c.line.setAttribute('d', d);
  c.area.setAttribute('d', fill);
  show(c.line, d !== '');
  show(c.area, fill !== '');

  const hasTop = p.topMmps !== null && p.topMmps > 0 && p.topAt !== null && p.topAt >= from;
  show(c.top, hasTop);
  show(c.topLabel, hasTop);
  if (hasTop && p.topMmps !== null && p.topAt !== null) {
    const tx = x(p.topAt);
    const ty = y(p.topMmps);
    c.top.setAttribute('cx', f1(tx));
    c.top.setAttribute('cy', f1(ty));
    c.topLabel.setAttribute('x', f1(Math.min(CW - 34, Math.max(34, tx))));
    c.topLabel.setAttribute('y', f1(Math.max(16, ty - 16)));
    c.topLabel.textContent = kmh(p.topMmps);
  }

  const latest = p.points[p.points.length - 1];
  const showNow = live && p.phase !== 'finished' && latest !== undefined;
  show(c.now, showNow);
  if (showNow && latest) {
    c.now.setAttribute('cx', f1(x(latest.t)));
    c.now.setAttribute('cy', f1(y(latest.mmps)));
  }
}

function figure(label: string, className: string): { root: HTMLElement; chip: HTMLElement; value: HTMLElement; unit: HTMLElement } {
  const root = el('div', `run-fig ${className}`);
  const head = el('div', 'run-label');
  const chip = el('b', 'run-chip');
  head.append(el('span', '', label), chip);
  const row = el('div', 'run-figrow');
  const value = el('span', 'run-value', UNKNOWN);
  const unit = el('span', 'run-unit');
  row.append(value, unit);
  root.append(head, row);
  return { root, chip, value, unit };
}

function cell(label: string): { root: HTMLElement; label: HTMLElement; value: HTMLElement; unit: HTMLElement } {
  const root = el('div', 'run-cell');
  const head = el('div', 'run-label', label);
  const row = el('div', 'run-cellrow');
  const value = el('span', 'run-cellvalue', UNKNOWN);
  const unit = el('span', 'run-unit', 'km/h');
  row.append(value, unit);
  root.append(head, row);
  return { root, label: head, value, unit };
}

/** The EST. / PARTIAL stamp next to a figure, or nothing. */
function chipFor(p: RunPicture | null): string | null {
  if (!p) return null;
  if (p.estimated) return 'Est.';
  if (p.partial) return 'Partial';
  return null;
}

export function mountRun(stage: HTMLElement, hub: Hub, className = ''): void {
  const root = el('div', `run enter ${className}`.trim());
  const card = el('div', 'run-card');

  const nameRow = el('div', 'run-name');
  const tab = el('div', 'run-tab', 'This run');
  const status = el('div', 'run-status');
  const lamp = el('i', 'lamp');
  const mood = el('span', 'run-mood', 'Tuning in');
  const zzz = el('span', 'zzz', 'zzz');
  const detail = el('span', 'run-detail');
  status.append(lamp, mood, zzz, detail);
  const plate = signalPlate('run-lost');
  nameRow.append(tab, status, plate.root);

  const body = el('div', 'run-body');
  const hero = el('div', 'run-hero');
  const distance = figure('Distance', 'run-distance');
  const clock = figure('Run time', 'run-clock');
  hero.append(distance.root, clock.root);

  const chartBox = el('div', 'run-chartbox');
  const chart = buildChart();
  const empty = el('div', 'run-empty');
  const emptyTitle = el('div', 'run-empty-title');
  const emptyDetail = el('div', 'run-empty-detail');
  empty.append(emptyTitle, emptyDetail);
  chartBox.append(chart.root, empty);

  const axis = el('div', 'run-axis');
  const axisFrom = el('span');
  const axisTo = el('span');
  axis.append(axisFrom, axisTo);

  const cells = el('div', 'run-cells');
  const top = cell('Top speed');
  const avg = cell('Average');
  const third = cell('Now');
  cells.append(top.root, avg.root, third.root);
  body.append(hero, chartBox, axis, cells);

  const foot = el('div', 'run-foot');
  const note = el('span', 'run-note');
  foot.appendChild(note);

  card.append(nameRow, body, foot);
  root.appendChild(card);
  stage.appendChild(root);
  let tagged = false;

  hub.subscribe((s) => {
    const p = s.run;
    const ok = s.signal.state === 'ok';
    mark(root, 'signal', s.signal.state);
    mark(root, 'mood', s.mood);
    mark(root, 'phase', p ? p.phase : 'none');
    mark(root, 'source', p ? p.source : null);
    plate.update(s.signal);
    put(mood, stateWords(s.signal, s.mood));
    put(detail, s.mood === 'asleep' ? (hintWords(s.hint, true) ?? '') : '');
    put(tab, p && p.phase === 'finished' ? 'Last run' : 'This run');

    const d = runDistance(p ? p.distanceMm : null);
    put(distance.value, d.value);
    put(distance.unit, d.unit);
    put(clock.value, p ? stopwatch(p.durationMs) : UNKNOWN);
    const chip = chipFor(p);
    for (const fig of [distance, clock]) {
      put(fig.chip, chip ?? '');
      mark(fig.root, 'chip', chip ? 'yes' : null);
    }

    put(top.value, p && p.topMmps !== null ? kmh(p.topMmps) : UNKNOWN);
    put(avg.value, p && p.avgMmps !== null ? kmh(p.avgMmps) : UNKNOWN);
    if (p && p.phase === 'finished') {
      put(third.label, p.source === 'history' ? 'Ended about' : 'Ended');
      put(third.value, p.endedAt !== null ? utcClock(p.endedAt) : UNKNOWN);
      put(third.unit, 'UTC');
    } else {
      const t = ok ? (s.status?.telemetry ?? null) : null;
      put(third.label, 'Now');
      put(third.value, t ? kmh(t.speedMmPerSecond) : UNKNOWN);
      put(third.unit, 'km/h');
    }

    put(axisFrom, p ? `${p.source === 'history' ? 'About ' : ''}${utcClock(p.startedAt)} UTC` : '');
    put(axisTo, p ? (p.phase === 'finished' && p.endedAt !== null ? `${utcClock(p.endedAt)} UTC` : 'Now') : '');

    mark(chartBox, 'empty', p ? null : 'yes');
    if (!p) {
      const words = emptyRunWords({
        signal: s.signal,
        mood: s.mood,
        hint: s.hint,
        historyKnown: s.stats !== null && s.stats.halfHours.length > 0,
      });
      put(emptyTitle, words.title);
      put(emptyDetail, words.detail);
    }
    put(note, p ? runNote(p) : 'Runs are tracked live from the WHEELY9000.');

    const record = s.stats?.records.topSpeedMmps ?? null;
    drawChart(chart, p, s.serverNow, record ? Number(record.value) : null, ok);

    if (s.demo && !tagged) {
      tagged = true;
      foot.appendChild(demoTag());
    }
  });
}
