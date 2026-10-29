// Alerts: full-frame-safe plates in the upper third, strictly one at a time.
// Incoming alerts wait in a queue (see enqueueAlert); block alerts that have not
// aired yet merge so a busy night does not stack up "+12 blocks" three times.

import type { Hub } from '../feed/hub.ts';
import { enqueueAlert } from '../logic/rules.ts';
import type { AlertItem } from '../logic/rules.ts';
import { describeAlert } from '../logic/wording.ts';
import { el, isCalm } from './kit.ts';
import { Blips } from './sound.ts';

const OUT_MS = 380;
const GAP_MS = 650;

function holdMs(item: AlertItem): number {
  switch (item.kind) {
    case 'blocks':
      return 5_200;
    case 'wake':
    case 'sleep':
      return 6_200;
    default:
      return 7_200;
  }
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function mountAlerts(stage: HTMLElement, hub: Hub, sound: boolean): void {
  const zone = el('div', 'al-zone');
  stage.appendChild(zone);
  const blips = sound ? new Blips() : null;
  let queue: AlertItem[] = [];
  let airing = false;
  let demo = false;

  hub.subscribe((s) => {
    demo = s.demo;
  });

  const build = (item: AlertItem): HTMLElement => {
    const copy = describeAlert(item);
    const node = el('div', 'al');
    node.setAttribute('data-tone', copy.tone);
    node.setAttribute('data-kind', item.kind);
    const tagWrap = el('div', 'al-tagwrap');
    const tag = el('div', 'al-tag');
    tag.appendChild(el('span', '', copy.tag));
    const stamp = item.test ? 'Test' : demo ? 'Demo' : null;
    if (stamp) tag.appendChild(el('b', 'al-stamp', stamp));
    tagWrap.appendChild(tag);
    const plateWrap = el('div', 'al-platewrap');
    const plate = el('div', 'al-plate');
    const headLine = el('div', 'al-line');
    headLine.appendChild(el('div', 'al-head', copy.headline));
    const detailLine = el('div', 'al-line');
    detailLine.appendChild(el('div', 'al-detail', copy.detail));
    plate.append(headLine, detailLine);
    plateWrap.appendChild(plate);
    node.append(tagWrap, plateWrap);
    return node;
  };

  const air = async (item: AlertItem): Promise<void> => {
    const node = build(item);
    zone.appendChild(node);
    // Force a style flush so the entrance animation always runs from its first frame.
    void node.offsetWidth;
    node.classList.add('is-in');
    blips?.play(item.kind);
    await pause(holdMs(item));
    node.classList.remove('is-in');
    node.classList.add('is-out');
    await pause(isCalm() ? 160 : OUT_MS);
    node.remove();
  };

  const pump = (): void => {
    if (airing) return;
    const next = queue[0];
    if (!next) return;
    queue = queue.slice(1);
    airing = true;
    void air(next).finally(() => {
      setTimeout(() => {
        airing = false;
        pump();
      }, GAP_MS);
    });
  };

  hub.onAlert((item) => {
    queue = enqueueAlert(queue, item);
    pump();
  });
}
