// Full package: every graphic on one 1920 x 1080 canvas. The bug stays in a top
// corner, alerts in the upper third, the run card in the left column under the
// bug, the lower third bottom left, the gauge bottom right and the ticker along
// the bottom, so nothing ever covers anything else. Program is the everyday
// subset; its vertical version restacks it for a 1080 x 1920 phone canvas.

import type { Hub } from '../feed/hub.ts';
import type { Corner } from '../logic/options.ts';
import { mountAlerts } from './alerts.ts';
import { mountBug } from './bug.ts';
import { mountGauge } from './gauge.ts';
import { mountLowerThird } from './lowerthird.ts';
import { mountRun } from './run.ts';
import { mountTicker } from './ticker.ts';

/** The bottom corners belong to the lower third and the gauge in this layout. */
export function topCorner(corner: Corner): Corner {
  if (corner === 'bl') return 'tl';
  if (corner === 'br') return 'tr';
  return corner;
}

/** Program: the four graphics a stream needs, on the same layout as the full package. */
export function mountProgram(stage: HTMLElement, hub: Hub, corner: Corner, sound: boolean): void {
  mountTicker(stage, hub);
  mountLowerThird(stage, hub);
  mountBug(stage, hub, topCorner(corner));
  mountAlerts(stage, hub, sound);
}

/**
 * Program, vertical: bug in a top corner with the run card stacked under it on
 * the same side, alerts mid-frame, the lower third above the strip phone apps
 * cover with chat. No ticker: a 952 px crawl shows a few words at a time, and
 * the bottom strip it would need belongs to the app. Positions live in the CSS.
 */
export function mountProgramVertical(stage: HTMLElement, hub: Hub, corner: Corner, sound: boolean): void {
  const top = topCorner(corner);
  mountRun(stage, hub, `run-stacked ${top === 'tl' ? 'run-left' : 'run-right'}`);
  mountLowerThird(stage, hub);
  mountBug(stage, hub, top);
  mountAlerts(stage, hub, sound);
}

export function mountFull(stage: HTMLElement, hub: Hub, corner: Corner, sound: boolean): void {
  mountTicker(stage, hub);
  mountLowerThird(stage, hub);
  mountGauge(stage, hub, 'gauge-docked');
  mountRun(stage, hub, 'run-docked');
  mountBug(stage, hub, topCorner(corner));
  mountAlerts(stage, hub, sound);
}
