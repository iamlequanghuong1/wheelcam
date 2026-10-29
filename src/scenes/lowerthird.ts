// Lower third: who is on the wheel, distance today, the 7-day top speed, the
// settled Squeek block with progress to the next one, and settlement freshness.

import type { Hub, HubState } from '../feed/hub.ts';
import { grouped, km, kmh, rpm, UNKNOWN, utcClock } from '../logic/units.ts';
import { hintWords, progressWords, queuedBlocks, settledLine, stateWords } from '../logic/wording.ts';
import { demoTag, el, mark, put, signalPlate } from './kit.ts';

function cell(label: string, unitText: string): {
  root: HTMLElement;
  label: HTMLElement;
  value: HTMLElement;
  unit: HTMLElement;
  note: HTMLElement;
} {
  const root = el('div', 'lt-cell');
  const head = el('div', 'lt-label', label);
  const row = el('div', 'lt-value');
  const value = el('span', 'lt-number', UNKNOWN);
  const unit = el('span', 'lt-unit', unitText);
  row.append(value, unit);
  const note = el('div', 'lt-note');
  root.append(head, row, note);
  return { root, label: head, value, unit, note };
}

function statusDetail(s: HubState): string {
  const t = s.status?.telemetry;
  switch (s.mood) {
    case 'running':
    case 'breather':
      return t ? `${rpm(t.rpmMilli)} rpm` : '';
    case 'stirring':
      return 'Something moves in the bedding';
    case 'asleep':
      return hintWords(s.hint) ?? 'The wheel waits';
    default:
      return 'Finding the wheel feed';
  }
}

export function mountLowerThird(stage: HTMLElement, hub: Hub): void {
  const root = el('div', 'lt enter');

  const nameRow = el('div', 'lt-name');
  const tab = el('div', 'lt-tab', 'Squeektoshi');
  const status = el('div', 'lt-status');
  const lamp = el('i', 'lamp');
  const mood = el('span', 'lt-mood', 'Tuning in');
  const detail = el('span', 'lt-detail');
  status.append(lamp, mood, detail);
  const plate = signalPlate('lt-lost');
  nameRow.append(tab, status, plate.root);

  const body = el('div', 'lt-body');
  const today = cell('Today', 'km');
  const speed = cell('Top speed', 'km/h');
  put(speed.note, '7-day peak');
  const block = el('div', 'lt-cell lt-block');
  const blockHead = el('div', 'lt-label');
  const blockLabel = el('span', '', 'Squeek block');
  const queued = el('span', 'lt-queued');
  blockHead.append(blockLabel, queued);
  const blockRow = el('div', 'lt-value');
  const height = el('span', 'lt-number', UNKNOWN);
  const next = el('span', 'lt-next');
  blockRow.append(height, next);
  const bar = el('div', 'lt-bar');
  const fill = el('i');
  bar.appendChild(fill);
  block.append(blockHead, blockRow, bar);
  body.append(today.root, speed.root, block);

  const foot = el('div', 'lt-foot');
  const settled = el('span', 'lt-settled');
  const flag = el('span', 'lt-flag');
  foot.append(settled, flag);

  root.append(nameRow, body, foot);
  stage.appendChild(root);
  let tagged = false;

  hub.subscribe((s) => {
    mark(root, 'signal', s.signal.state);
    mark(root, 'mood', s.mood);
    plate.update(s.signal);
    put(mood, stateWords(s.signal, s.mood));
    put(detail, statusDetail(s));

    const t = s.signal.state === 'ok' ? s.status?.telemetry ?? null : null;
    put(today.value, t ? km(t.distanceMm) : UNKNOWN);
    const last = s.status?.telemetry;
    put(
      today.note,
      t
        ? 'Since noon UTC'
        : last && s.signal.state !== 'tuning'
          ? `Last ${km(last.distanceMm)} km at ${utcClock(last.receivedAt)} UTC`
          : '',
    );

    const top = s.stats?.records.topSpeedMmps ?? null;
    put(speed.value, top ? kmh(top.value) : UNKNOWN);

    const p = progressWords(s.status);
    put(height, p.height);
    put(next, p.next);
    fill.style.width = p.fraction === null ? '0%' : `${(p.fraction * 100).toFixed(2)}%`;
    mark(block, 'known', p.fraction === null ? 'no' : 'yes');
    const q = queuedBlocks(s.status);
    put(queued, q !== null ? `+${grouped(q)} queued` : '');

    const line = settledLine(s.status, s.serverNow);
    put(settled, line ? line.text : 'Settlement data unavailable');
    put(flag, line?.late ? 'Running late' : '');
    mark(foot, 'late', line?.late ? 'yes' : null);
    const provenance = s.status?.telemetry?.provenance;
    mark(root, 'simulated', !s.demo && provenance && provenance !== 'hardware' ? provenance : null);

    if (s.demo && !tagged) {
      tagged = true;
      foot.appendChild(demoTag());
    }
  });
}
