// Corner bug: the wheel mark (turning at the real wheel speed), live rpm, and
// what Squeektoshi is up to. Swaps to a caution plate when the feed is lost.

import type { Hub } from '../feed/hub.ts';
import type { Corner } from '../logic/options.ts';
import { rpm } from '../logic/units.ts';
import { stateWords } from '../logic/wording.ts';
import { demoTag, el, isCalm, mark, onFrame, put, signalPlate, Spring, wheelGlyph } from './kit.ts';

export function mountBug(stage: HTMLElement, hub: Hub, corner: Corner): void {
  const root = el('div', 'bug enter');
  mark(root, 'corner', corner);

  const badge = el('div', 'bug-mark');
  const wheel = wheelGlyph(58);
  badge.appendChild(wheel.root);

  const body = el('div', 'bug-body');
  const live = el('div', 'bug-live');
  const reading = el('div', 'bug-reading');
  const value = el('span', 'bug-rpm', '--');
  const unit = el('span', 'bug-unit', 'rpm');
  reading.append(value, unit);
  const words = el('div', 'bug-words');
  const who = el('span', 'bug-who', 'Squeektoshi');
  const moodLine = el('span', 'bug-mood');
  const lamp = el('i', 'lamp');
  const mood = el('span', '', 'Tuning in');
  const zzz = el('span', 'zzz', 'zzz');
  moodLine.append(lamp, mood, zzz);
  words.append(who, moodLine);
  live.append(reading, words);
  const plate = signalPlate('bug-lost');
  body.append(live, plate.root);
  root.append(badge, body);

  let tag: HTMLElement | null = null;
  stage.appendChild(root);

  let targetRpm = 0;
  let spinning = false;
  const shown = new Spring(0);
  let angle = 0;

  hub.subscribe((s) => {
    mark(root, 'signal', s.signal.state);
    mark(root, 'mood', s.mood);
    plate.update(s.signal);
    const t = s.signal.state === 'ok' ? s.status?.telemetry ?? null : null;
    put(value, t ? rpm(t.rpmMilli) : '--');
    put(mood, stateWords(s.signal, s.mood));
    targetRpm = t ? t.rpmMilli / 1000 : 0;
    spinning = t !== null && t.rpmMilli > 0;
    if (s.demo && !tag) {
      tag = demoTag();
      root.appendChild(tag);
    }
  });

  onFrame((dt) => {
    if (isCalm()) return;
    const r = shown.step(spinning ? targetRpm : 0, dt, 18, 0.9);
    if (r < 0.2 && !spinning) return;
    angle = (angle + (r / 60) * 360 * dt) % 360;
    wheel.rotor.setAttribute('transform', `rotate(${angle.toFixed(1)})`);
  });
}
