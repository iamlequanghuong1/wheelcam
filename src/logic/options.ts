// URL parameters in, URL parameters out. The studio builds OBS links with
// sceneLink(); every overlay reads its settings with readOptions().

import { parseAccent } from './colour.ts';
import { ALERT_KINDS, isAlertKind } from './rules.ts';
import type { AlertKind } from './rules.ts';

export const SCENES = ['bug', 'lowerthird', 'ticker', 'gauge', 'run', 'alerts', 'program', 'full'] as const;
export type SceneId = (typeof SCENES)[number];

/** Scenes that carry the corner bug, the alerts, or both. */
const WITH_BUG: ReadonlySet<SceneId> = new Set<SceneId>(['bug', 'program', 'full']);
const WITH_ALERTS: ReadonlySet<SceneId> = new Set<SceneId>(['alerts', 'program', 'full']);
export const carriesAlerts = (scene: SceneId): boolean => WITH_ALERTS.has(scene);

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type Theme = 'dark' | 'light';
/** Canvas shape. Only the program scene has a vertical (9:16) version. */
export type Layout = 'landscape' | 'vertical';

export interface Options {
  scene: SceneId | null;
  theme: Theme;
  scale: number;
  corner: Corner;
  sound: boolean;
  demo: boolean;
  /** Alert kinds to keep off air. */
  mute: AlertKind[];
  /** Force reduced motion even if the system does not ask for it. */
  calm: boolean;
  /** Accent colour as #rrggbb, or null for the stock signal yellow. */
  accent: string | null;
  /** Small-print size in percent (TYPE_MIN to TYPE_MAX, steps of 5). */
  type: number;
  layout: Layout;
}

export const DEFAULTS: Options = {
  scene: null,
  theme: 'dark',
  scale: 1,
  corner: 'tr',
  sound: false,
  demo: false,
  mute: [],
  calm: false,
  accent: null,
  type: 100,
  layout: 'landscape',
};

export const SCALE_MIN = 0.5;
export const SCALE_MAX = 2;
export const TYPE_MIN = 90;
export const TYPE_MAX = 130;

const isScene = (v: string | null): v is SceneId => v !== null && (SCENES as readonly string[]).includes(v);
const isCorner = (v: string | null): v is Corner => v === 'tl' || v === 'tr' || v === 'bl' || v === 'br';
const truthy = (v: string | null): boolean => v === '1' || v === 'true' || v === 'yes' || v === 'on';

export function clampScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, v)) * 100) / 100;
}

/** Small-print size in percent, kept to the range and snapped to steps of 5. */
export function clampType(v: number): number {
  if (!Number.isFinite(v)) return DEFAULTS.type;
  return Math.round(Math.min(TYPE_MAX, Math.max(TYPE_MIN, v)) / 5) * 5;
}

/** `type=115` and the like. Anything that is not a whole number keeps the default. */
function readType(raw: string | null): number {
  return raw !== null && /^\d{1,4}$/.test(raw.trim()) ? clampType(Number(raw.trim())) : DEFAULTS.type;
}

const readLayout = (v: string | null): Layout => (v === 'vertical' || v === 'portrait' ? 'vertical' : 'landscape');

export function readOptions(search: string): Options {
  const q = new URLSearchParams(search);
  const scene = q.get('scene');
  const theme = q.get('theme');
  const corner = q.get('corner');
  const scaleRaw = q.get('scale');
  const mute = (q.get('mute') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(isAlertKind);
  return {
    scene: isScene(scene) ? scene : null,
    theme: theme === 'light' ? 'light' : 'dark',
    scale: scaleRaw === null ? 1 : clampScale(Number(scaleRaw)),
    corner: isCorner(corner) ? corner : DEFAULTS.corner,
    sound: truthy(q.get('sound')),
    demo: truthy(q.get('demo')),
    mute: ALERT_KINDS.filter((k) => mute.includes(k)),
    calm: q.get('motion') === 'reduce',
    accent: parseAccent(q.get('accent')),
    type: readType(q.get('type')),
    layout: readLayout(q.get('layout')),
  };
}

/** Query string for a scene with only the settings that differ from the defaults. */
export function sceneQuery(scene: SceneId, o: Omit<Options, 'scene'>): string {
  const q = new URLSearchParams();
  q.set('scene', scene);
  if (scene === 'program' && o.layout === 'vertical') q.set('layout', 'vertical');
  if (o.theme !== DEFAULTS.theme) q.set('theme', o.theme);
  const accent = parseAccent(o.accent);
  if (accent) q.set('accent', accent.slice(1));
  if (clampType(o.type) !== DEFAULTS.type) q.set('type', String(clampType(o.type)));
  if (clampScale(o.scale) !== 1) q.set('scale', String(clampScale(o.scale)));
  if (WITH_BUG.has(scene) && o.corner !== DEFAULTS.corner) q.set('corner', o.corner);
  if (o.sound && WITH_ALERTS.has(scene)) q.set('sound', '1');
  if (o.demo) q.set('demo', '1');
  const mute = ALERT_KINDS.filter((k) => o.mute.includes(k));
  if (mute.length && WITH_ALERTS.has(scene)) q.set('mute', mute.join(','));
  if (o.calm) q.set('motion', 'reduce');
  // URLSearchParams encodes the comma; OBS users read these links, so keep it plain.
  return `?${q.toString().replace(/%2C/g, ',')}`;
}

export interface SceneCard {
  /** Unique per card: the vertical program shares its scene id with the landscape one. */
  key: string;
  id: SceneId;
  layout: Layout;
  title: string;
  blurb: string;
  width: number;
  height: number;
}

export const SCENE_CARDS: SceneCard[] = [
  {
    key: 'program',
    id: 'program',
    layout: 'landscape',
    title: 'Program',
    blurb: 'What viewers see: the bug, lower third, ticker and alerts stacked over a stand-in for the camera. The link is all four in one source.',
    width: 1920,
    height: 1080,
  },
  {
    key: 'program-vertical',
    id: 'program',
    layout: 'vertical',
    title: 'Program, vertical',
    blurb: 'For phone-shaped streams: the bug and run card up top, alerts mid-frame, the lower third above the strip where phone apps put their chat. One source on a 1080 x 1920 canvas.',
    width: 1080,
    height: 1920,
  },
  {
    key: 'bug',
    id: 'bug',
    layout: 'landscape',
    title: 'Corner bug',
    blurb: 'Live rpm and whether Squeektoshi is up. Sits in the corner you pick.',
    width: 1920,
    height: 1080,
  },
  {
    key: 'lowerthird',
    id: 'lowerthird',
    layout: 'landscape',
    title: 'Lower third',
    blurb: 'Distance today, top speed, Squeek block height with progress, and how fresh the last settlement is.',
    width: 1920,
    height: 1080,
  },
  {
    key: 'ticker',
    id: 'ticker',
    layout: 'landscape',
    title: 'Ticker',
    blurb: 'A crawl of lifetime numbers, records, settlements and SQK minted, with opinions.',
    width: 1920,
    height: 1080,
  },
  {
    key: 'gauge',
    id: 'gauge',
    layout: 'landscape',
    title: 'RPM gauge',
    blurb: 'Big analog dial with a sprung needle and a rolling odometer for today. Square source, put it anywhere.',
    width: 720,
    height: 720,
  },
  {
    key: 'run',
    id: 'run',
    layout: 'landscape',
    title: 'Run card',
    blurb: 'This run as it happens: a live speed trace, distance, run clock, top and average speed. Between runs it keeps the last one up. Square source.',
    width: 720,
    height: 720,
  },
  {
    key: 'alerts',
    id: 'alerts',
    layout: 'landscape',
    title: 'Alerts',
    blurb: 'Wake-ups, bedtimes, run recaps, records, milestones, streaks and new Squeek blocks. One plate at a time.',
    width: 1920,
    height: 1080,
  },
  {
    key: 'full',
    id: 'full',
    layout: 'landscape',
    title: 'Full package',
    blurb: 'Every graphic in one 1920 x 1080 layout that never overlaps itself.',
    width: 1920,
    height: 1080,
  },
];
