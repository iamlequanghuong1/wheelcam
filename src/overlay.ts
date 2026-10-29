// Boots one overlay scene: theme, stage, hub, feed, and the studio's test-alert
// channel. Loaded only when the URL has a scene, so OBS never pulls studio code.

import './styles/overlay.css';
import { Hub } from './feed/hub.ts';
import { REHEARSAL_TIMING, startDemoFeed } from './feed/demo.ts';
import { startLiveFeed } from './feed/live.ts';
import type { Needs } from './feed/live.ts';
import { ACCENT_TOKENS, accentTokens, parseAccent } from './logic/colour.ts';
import { carriesAlerts, clampType } from './logic/options.ts';
import type { Options, SceneId, Theme } from './logic/options.ts';
import { isAlertKind, ON_AIR_TIMING } from './logic/rules.ts';
import { mountAlerts } from './scenes/alerts.ts';
import { mountBug } from './scenes/bug.ts';
import { mountFull, mountProgram, mountProgramVertical } from './scenes/full.ts';
import { mountGauge } from './scenes/gauge.ts';
import { mountStage, setupMotion } from './scenes/kit.ts';
import { mountLowerThird } from './scenes/lowerthird.ts';
import { mountRun } from './scenes/run.ts';
import { mountTicker } from './scenes/ticker.ts';

// Alerts read stats too: the run recap estimates a run that was under way when the source opened.
const NEEDS: Record<SceneId, Needs> = {
  bug: { events: false, stats: false, settlements: false, economy: false },
  lowerthird: { events: false, stats: true, settlements: false, economy: false },
  ticker: { events: false, stats: true, settlements: true, economy: true },
  gauge: { events: false, stats: true, settlements: false, economy: false },
  run: { events: false, stats: true, settlements: false, economy: false },
  alerts: { events: true, stats: true, settlements: false, economy: false },
  program: { events: true, stats: true, settlements: true, economy: true },
  full: { events: true, stats: true, settlements: true, economy: true },
};

const TITLES: Record<SceneId, string> = {
  bug: 'Corner bug',
  lowerthird: 'Lower third',
  ticker: 'Ticker',
  gauge: 'RPM gauge',
  run: 'Run card',
  alerts: 'Alerts',
  program: 'Program',
  full: 'Full package',
};

const SQUARE: ReadonlySet<SceneId> = new Set<SceneId>(['gauge', 'run']);

/** Hold the first frame until Barlow is in, so the broadcast never shows a fallback font. */
async function fontsReady(): Promise<void> {
  if (!('fonts' in document)) return;
  const wanted = ['700 40px "Barlow Condensed"', '600 40px "Barlow Condensed"', '500 30px "Barlow"'];
  await Promise.race([
    Promise.all(wanted.map((f) => document.fonts.load(f))).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 2_500)),
  ]).catch(() => undefined);
}

/**
 * The accent's theme tokens go inline on the root element (inline beats the
 * theme rules), the small-print size on the stage. Both come out of the
 * validators, never straight from a URL or a message.
 */
function applyLook(stage: HTMLElement, theme: Theme, accent: string | null, type: number): void {
  const html = document.documentElement;
  const tokens = accentTokens(accent, theme);
  for (const name of ACCENT_TOKENS) {
    const value = tokens[name];
    if (value) html.style.setProperty(name, value);
    else html.style.removeProperty(name);
  }
  stage.style.setProperty('--t', String(clampType(type) / 100));
}

export function bootOverlay(options: Options, scene: SceneId): void {
  const html = document.documentElement;
  html.classList.add('wc-overlay', 'fonts-pending');
  html.setAttribute('data-theme', options.theme);
  const vertical = scene === 'program' && options.layout === 'vertical';
  document.title = `WheelCam / ${TITLES[scene]}${vertical ? ', vertical' : ''}`;
  setupMotion(options.calm);

  const app = document.getElementById('app');
  if (!app) return;
  const square = SQUARE.has(scene);
  const [width, height] = square ? [720, 720] : vertical ? [1080, 1920] : [1920, 1080];
  const stage = mountStage(app, width, height, vertical ? `scene-${scene} layout-vertical` : `scene-${scene}`);
  // Square sources and the busy vertical canvas only shrink: growing would collide.
  stage.style.setProperty('--k', String(square || vertical ? Math.min(1, options.scale) : options.scale));
  applyLook(stage, options.theme, options.accent, options.type);

  const hub = new Hub({
    demo: options.demo,
    timing: options.demo ? REHEARSAL_TIMING : ON_AIR_TIMING,
    muted: new Set(options.mute),
  });

  switch (scene) {
    case 'bug':
      mountBug(stage, hub, options.corner);
      break;
    case 'lowerthird':
      mountLowerThird(stage, hub);
      break;
    case 'ticker':
      mountTicker(stage, hub);
      break;
    case 'gauge':
      mountGauge(stage, hub);
      break;
    case 'run':
      mountRun(stage, hub);
      break;
    case 'alerts':
      mountAlerts(stage, hub, options.sound);
      break;
    case 'program':
      if (vertical) mountProgramVertical(stage, hub, options.corner, options.sound);
      else mountProgram(stage, hub, options.corner, options.sound);
      break;
    case 'full':
      mountFull(stage, hub, options.corner, options.sound);
      break;
  }

  if (options.demo) startDemoFeed(hub, NEEDS[scene]);
  else startLiveFeed(hub, NEEDS[scene]);
  hub.start();

  // Messages from the studio page that embeds this scene. Same origin, parent only:
  // test alerts, and the look picker's accent and type size, re-validated here.
  const alerts = carriesAlerts(scene);
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (window.parent === window || event.source !== window.parent) return;
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (typeof data !== 'object' || data === null) return;
    const message = data as { wheelcam?: unknown; kind?: unknown; accent?: unknown; type?: unknown };
    if (message.wheelcam === 'test-alert' && alerts && isAlertKind(message.kind)) hub.fireTest(message.kind);
    if (message.wheelcam === 'look') {
      const type = typeof message.type === 'number' ? message.type : options.type;
      applyLook(stage, options.theme, parseAccent(message.accent), type);
    }
  });
  // Tell an embedding studio this preview is listening, so it can send the current look.
  // Only a same-origin parent hears it; reading a foreign parent's location throws.
  const studioParent = ((): boolean => {
    try {
      return window.parent !== window && window.parent.location.origin === window.location.origin;
    } catch {
      return false;
    }
  })();
  if (studioParent) window.parent.postMessage({ wheelcam: 'ready' }, window.location.origin);

  void fontsReady().then(() => html.classList.remove('fonts-pending'));
}
