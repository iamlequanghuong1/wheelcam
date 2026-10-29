// RPM gauge: an analog dial (0 to 140 rpm over 240 degrees) with a sprung needle,
// a live arc, the 7-day rpm record marked in hamster orange, and a rolling
// odometer for today's distance whose drums carry like a real one.

import type { Hub } from '../feed/hub.ts';
import { km, rpm, UNKNOWN } from '../logic/units.ts';
import { hintWords, stateWords } from '../logic/wording.ts';
import { demoTag, el, isCalm, mark, onFrame, put, signalPlate, Spring, svg } from './kit.ts';

const SIZE = 720;
const C = SIZE / 2;
const MAX_RPM = 140;
const SWEEP = 240;
const START = -SWEEP / 2;
const BAND_R = 286;
const DRUM_H = 58;
const DRUMS = 5; // two kilometre digits, three for metres
const GLIDE_MS = 1_900;

const angleOf = (value: number): number => START + (Math.min(MAX_RPM, Math.max(0, value)) / MAX_RPM) * SWEEP;

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}

function arc(r: number, from: number, to: number): string {
  const [x0, y0] = polar(r, from);
  const [x1, y1] = polar(r, Math.max(to, from + 0.01));
  const large = to - from > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Position of one odometer drum (0..10, fractional while rolling). Drum 0 is metres. */
export function drumPosition(metres: number, drum: number, rolling: boolean): number {
  const place = 10 ** drum;
  const digit = Math.floor(metres / place) % 10;
  if (!rolling) return digit;
  if (drum === 0) return metres % 10;
  const below = metres % place;
  return digit + (below > place - 1 ? below - (place - 1) : 0);
}

function buildDial(): {
  face: SVGSVGElement;
  live: SVGPathElement;
  needle: SVGGElement;
  record: SVGGElement;
} {
  const face = svg('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'g-dial', 'aria-hidden': 'true' });
  face.appendChild(svg('circle', { cx: C, cy: C, r: 344, class: 'g-face' }));
  face.appendChild(svg('circle', { cx: C, cy: C, r: 336, class: 'g-rim' }));
  face.appendChild(svg('path', { d: arc(BAND_R, START, START + SWEEP), class: 'g-track' }));
  const live = svg('path', { d: arc(BAND_R, START, START), class: 'g-live' });
  face.appendChild(live);

  for (let v = 0; v <= MAX_RPM; v += 5) {
    const major = v % 20 === 0;
    const mid = !major && v % 10 === 0;
    const [x0, y0] = polar(major ? 304 : mid ? 308 : 311, angleOf(v));
    const [x1, y1] = polar(major ? 332 : mid ? 328 : 325, angleOf(v));
    face.appendChild(
      svg('line', {
        x1: x0.toFixed(2),
        y1: y0.toFixed(2),
        x2: x1.toFixed(2),
        y2: y1.toFixed(2),
        class: major ? 'g-tick g-tick-major' : mid ? 'g-tick g-tick-mid' : 'g-tick',
      }),
    );
    // The resting needle lies across zero, so zero gets a tick but no numeral.
    if (major && v > 0) {
      const [tx, ty] = polar(236, angleOf(v));
      const label = svg('text', { x: tx.toFixed(2), y: (ty + 12).toFixed(2), class: 'g-num' });
      label.textContent = String(v);
      face.appendChild(label);
    }
  }

  const brand = svg('text', { x: C, y: 232, class: 'g-brand' });
  brand.textContent = 'WHEELY9000';
  const unit = svg('text', { x: C, y: 266, class: 'g-unit' });
  unit.textContent = 'RPM';
  face.append(brand, unit);

  const record = svg('g', { class: 'g-record' });
  record.appendChild(svg('path', { d: `M ${C} ${C - 300} L ${C - 11} ${C - 330} L ${C + 11} ${C - 330} Z` }));
  record.appendChild(svg('line', { x1: C, y1: C - BAND_R - 14, x2: C, y2: C - BAND_R + 14 }));
  face.appendChild(record);

  const needle = svg('g', { class: 'g-needle' });
  needle.appendChild(svg('path', { d: `M ${C - 9} ${C} L ${C - 2.5} ${C - 268} L ${C + 2.5} ${C - 268} L ${C + 9} ${C} L ${C + 6} ${C + 30} L ${C - 6} ${C + 30} Z` }));
  face.appendChild(needle);
  face.appendChild(svg('circle', { cx: C, cy: C, r: 30, class: 'g-hub' }));
  face.appendChild(svg('circle', { cx: C, cy: C, r: 10, class: 'g-hub-dot' }));
  return { face, live, needle, record };
}

export function mountGauge(stage: HTMLElement, hub: Hub, className = ''): void {
  const root = el('div', `gauge enter ${className}`.trim());
  const dial = buildDial();
  root.appendChild(dial.face);

  const readout = el('div', 'g-readout', UNKNOWN);
  const plate = signalPlate('g-lost');

  const odo = el('div', 'g-odo');
  const drumsEl = el('div', 'g-drums');
  const reels: HTMLElement[] = [];
  for (let i = DRUMS - 1; i >= 0; i -= 1) {
    const drum = el('span', i < 3 ? 'g-drum g-drum-fine' : 'g-drum');
    const reel = el('span', 'g-reel');
    for (const digit of '01234567890') reel.appendChild(el('span', '', digit));
    drum.appendChild(reel);
    drumsEl.appendChild(drum);
    reels[i] = reel;
    if (i === 3) drumsEl.appendChild(el('span', 'g-point', '.'));
  }
  const odoUnit = el('span', 'g-odo-unit');
  odoUnit.append(el('b', '', 'km'), el('span', '', 'today'));
  odo.append(drumsEl, odoUnit);

  const life = el('div', 'g-life');
  const chip = el('div', 'g-chip');
  const lamp = el('i', 'lamp');
  const chipText = el('span');
  chip.append(lamp, chipText);
  root.append(readout, plate.root, odo, life, chip);
  stage.appendChild(root);

  const needle = new Spring(0);
  let target = 0;
  let known = false;
  let tagged = false;
  let recordAngle: number | null = null;

  // Odometer glide between readings (never past the newest reading).
  let odoShown = 0;
  let odoFrom = 0;
  let odoTo = 0;
  let odoStart = 0;
  let odoKnown = false;
  const lastDrum: string[] = [];

  hub.subscribe((s) => {
    mark(root, 'signal', s.signal.state);
    mark(root, 'mood', s.mood);
    plate.update(s.signal);
    const t = s.signal.state === 'ok' ? s.status?.telemetry ?? null : null;
    known = t !== null;
    target = t ? t.rpmMilli / 1000 : 0;
    put(readout, t ? rpm(t.rpmMilli) : UNKNOWN);

    if (t) {
      // Whole metres, so the drums always come to rest on a digit.
      const metres = Math.floor(t.distanceMm / 1000);
      if (!odoKnown || metres < odoTo - 1 || isCalm()) {
        odoShown = odoFrom = odoTo = metres;
        odoKnown = true;
      } else if (metres !== odoTo) {
        odoFrom = odoShown;
        odoTo = metres;
        odoStart = performance.now();
      }
    }
    mark(odo, 'known', t ? 'yes' : 'no');

    const peak = s.stats?.records.peakRpmMilli ?? null;
    recordAngle = peak ? angleOf(Number(peak.value) / 1000) : null;
    if (recordAngle === null) dial.record.setAttribute('display', 'none');
    else {
      dial.record.removeAttribute('display');
      dial.record.setAttribute('transform', `rotate(${recordAngle.toFixed(2)} ${C} ${C})`);
    }
    const lifetime = s.stats?.lifetime;
    const parts: string[] = [];
    if (lifetime) parts.push(`Lifetime ${km(lifetime.distanceMm)} km`);
    if (peak) parts.push(`Record ${rpm(peak.value)} rpm`);
    put(life, parts.join('  /  '));

    const hint = s.mood === 'asleep' ? hintWords(s.hint, true) : null;
    const state = stateWords(s.signal, s.mood);
    put(chipText, hint ? `${state} · ${hint}` : state);

    if (s.demo && !tagged) {
      tagged = true;
      root.appendChild(demoTag());
    }
  });

  let drawnAngle = Number.NaN;
  onFrame((dt, now) => {
    const value = needle.step(known ? target : 0, dt);
    const a = angleOf(value);
    // A sleeping hamster means hours of a still needle; skip the redraw then.
    if (!(Math.abs(a - drawnAngle) < 0.01)) {
      drawnAngle = a;
      dial.needle.setAttribute('transform', `rotate(${a.toFixed(2)} ${C} ${C})`);
      dial.live.setAttribute('d', arc(BAND_R, START, a));
    }

    if (odoKnown) {
      const k = isCalm() ? 1 : Math.min(1, (now - odoStart) / GLIDE_MS);
      odoShown = odoFrom + (odoTo - odoFrom) * k;
      const rolling = !isCalm();
      for (let i = 0; i < DRUMS; i += 1) {
        const pos = drumPosition(odoShown % 100_000, i, rolling);
        const css = `translateY(${(-pos * DRUM_H).toFixed(1)}px)`;
        if (lastDrum[i] !== css) {
          lastDrum[i] = css;
          const reel = reels[i];
          if (reel) reel.style.transform = css;
        }
      }
    }
  });
}
