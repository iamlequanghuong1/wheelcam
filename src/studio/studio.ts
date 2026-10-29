// The studio: live previews of every scene, OBS links with their sizes, test
// alerts fired into the previews, and a short guide. Plain DOM, no framework.

import '../styles/studio.css';
import { ACCENT_PRESETS, ACCENT_TOKENS, accentTokens, parseAccent, SIGNAL_YELLOW } from '../logic/colour.ts';
import { clampScale, clampType, SCENE_CARDS, sceneQuery, TYPE_MAX, TYPE_MIN } from '../logic/options.ts';
import type { Corner, Options, SceneCard, Theme } from '../logic/options.ts';
import { ALERT_KINDS } from '../logic/rules.ts';
import type { AlertKind } from '../logic/rules.ts';
import { el, wheelGlyph } from '../scenes/kit.ts';
import { standInFrame } from './standin.ts';

type Backdrop = 'checker' | 'dark' | 'light';

const ALERT_LABELS: Record<AlertKind, string> = {
  wake: 'Woke up',
  sleep: 'Went to sleep',
  run_recap: 'Run recap',
  speed_record: 'Speed record',
  distance_milestone: 'Distance milestone',
  daily_distance_milestone: 'Daily milestone',
  speed_milestone: 'Speed milestone',
  distance_streak: 'Distance streak',
  blocks: 'Squeek blocks',
};

/** Card keys in page order. The tall vertical card sits beside the run and alerts cards. */
const ORDER: string[] = ['program', 'program-vertical', 'run', 'alerts', 'full', 'gauge', 'bug', 'lowerthird', 'ticker'];

/** Previews drawn over the stand-in camera frame instead of the chosen backdrop. */
const onStandIn = (card: SceneCard): boolean => card.id === 'program';

interface CardView {
  card: SceneCard;
  frame: HTMLIFrameElement;
  link: HTMLInputElement;
  open: HTMLAnchorElement;
}

function pageBase(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

function segmented<T extends string>(
  name: string,
  choices: Array<[T, string]>,
  current: T,
  onPick: (value: T) => void,
  extraClass = '',
): HTMLElement {
  const group = el('div', `seg ${extraClass}`.trim());
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', name);
  const buttons: HTMLButtonElement[] = [];
  for (const [value, label] of choices) {
    const b = el('button', 'seg-btn', label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(value === current));
    b.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-checked', String(other === b));
      onPick(value);
    });
    buttons.push(b);
    group.appendChild(b);
  }
  return group;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = el('div', 'field');
  const name = el('span', 'field-name', label);
  wrap.append(name, control);
  if (hint) wrap.appendChild(el('span', 'field-hint', hint));
  return wrap;
}

function toggle(label: string, checked: boolean, hint: string, onChange: (on: boolean) => void): HTMLElement {
  const wrap = el('label', 'switch');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  const text = el('span', 'switch-text');
  text.append(el('b', '', label), el('span', '', hint));
  wrap.append(box, text);
  return wrap;
}

/**
 * Accent swatches (a radio group) plus a free colour field. Swatch colours are
 * the presets' own constants; the field's value goes through parseAccent.
 */
function accentPicker(current: string | null, onPick: (accent: string | null) => void): HTMLElement {
  const wrap = el('div', 'accent');
  const group = el('div', 'swatches');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Accent colour');
  const custom = el('input', 'swatch-field');
  custom.type = 'color';
  custom.setAttribute('aria-label', 'Any colour');
  const readout = el('output', 'accent-value');
  const swatches: Array<{ button: HTMLButtonElement; accent: string | null }> = [];

  const show = (accent: string | null): void => {
    for (const s of swatches) s.button.setAttribute('aria-checked', String(s.accent === accent));
    custom.value = accent ?? SIGNAL_YELLOW;
    readout.textContent = accent ? accent : `${SIGNAL_YELLOW} (stock)`;
  };

  for (const preset of ACCENT_PRESETS) {
    const accent = parseAccent(preset.hex);
    const b = el('button', 'swatch');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', preset.name);
    b.title = `${preset.name}, ${preset.hex}`;
    b.style.backgroundColor = preset.hex;
    b.addEventListener('click', () => {
      show(accent);
      onPick(accent);
    });
    swatches.push({ button: b, accent });
    group.appendChild(b);
  }
  custom.addEventListener('input', () => {
    const accent = parseAccent(custom.value);
    show(accent);
    onPick(accent);
  });
  const customWrap = el('label', 'swatch-custom');
  customWrap.append(custom, el('span', '', 'Any colour'));
  const row = el('div', 'accent-row');
  row.append(customWrap, readout);
  wrap.append(group, row);
  show(current);
  return wrap;
}

/** A tiny tab-and-plate sample next to the controls, painted with the same tokens as the overlays. */
function lookSample(): { root: HTMLElement; paint: (theme: Theme, accent: string | null, type: number) => void } {
  const root = el('div', 'look-sample');
  root.setAttribute('aria-hidden', 'true');
  const name = el('div', 'ls-name');
  const tab = el('span', 'ls-tab', 'Squeektoshi');
  const status = el('span', 'ls-status');
  status.append(el('i', 'ls-lamp'), el('span', '', 'On the wheel'));
  name.append(tab, status);
  const body = el('div', 'ls-body');
  const label = el('span', 'ls-label', 'Today');
  const figure = el('span', 'ls-figure');
  figure.append(el('b', '', '3.42'), el('span', 'ls-unit', 'km'));
  const bar = el('span', 'ls-bar');
  bar.appendChild(el('i'));
  body.append(label, figure, bar);
  root.append(name, body);
  return {
    root,
    paint(theme, accent, type) {
      root.setAttribute('data-theme', theme);
      const tokens = accentTokens(accent, theme);
      for (const token of ACCENT_TOKENS) {
        const value = tokens[token];
        if (value) root.style.setProperty(token, value);
        else root.style.removeProperty(token);
      }
      root.style.setProperty('--t', String(clampType(type) / 100));
    },
  };
}

async function copyText(text: string, input: HTMLInputElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    input.focus();
    input.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export function bootStudio(initial: Options): void {
  const html = document.documentElement;
  html.classList.add('wc-studio');
  document.title = 'WheelCam studio';
  const app = document.getElementById('app');
  if (!app) return;

  const settings: Omit<Options, 'scene'> = {
    theme: initial.theme,
    scale: initial.scale,
    corner: initial.corner,
    sound: initial.sound,
    demo: initial.demo,
    mute: initial.mute.slice(),
    calm: initial.calm,
    accent: initial.accent,
    type: initial.type,
    // Each card sets its own layout.
    layout: 'landscape',
  };
  let backdrop: Backdrop = 'checker';
  const views: CardView[] = [];

  // ------------------------------------------------------------ header
  const header = el('header', 'st-head');
  const brand = el('div', 'st-brand');
  const mark = el('span', 'st-mark');
  mark.appendChild(wheelGlyph(34).root);
  brand.append(mark, el('span', 'st-word', 'WheelCam'));
  const lede = el(
    'p',
    'st-lede',
    "Broadcast graphics for Squeektoshi's wheel stream. Add them to OBS as browser sources: they read the live wheel telemetry and settled Squeekchain data, and they say so plainly when the feed goes quiet.",
  );
  header.append(brand, lede);

  // ------------------------------------------------------------ settings
  const controls = el('section', 'st-panel st-settings');
  controls.setAttribute('aria-labelledby', 'settings-title');
  const settingsTitle = el('h2', 'st-h2', 'Look and behaviour');
  settingsTitle.id = 'settings-title';

  const scaleValue = el('output', 'scale-value', `${clampScale(settings.scale).toFixed(2)}x`);
  const scaleInput = el('input', 'scale-input');
  scaleInput.type = 'range';
  scaleInput.min = '0.5';
  scaleInput.max = '2';
  scaleInput.step = '0.05';
  scaleInput.value = String(clampScale(settings.scale));
  scaleInput.setAttribute('aria-label', 'Graphics scale');
  scaleInput.addEventListener('input', () => {
    settings.scale = clampScale(Number(scaleInput.value));
    scaleValue.textContent = `${settings.scale.toFixed(2)}x`;
    refresh();
  });
  const scaleRow = el('div', 'scale-row');
  scaleRow.append(scaleInput, scaleValue);

  const typeValue = el('output', 'scale-value', `${clampType(settings.type)}%`);
  const typeInput = el('input', 'scale-input');
  typeInput.type = 'range';
  typeInput.min = String(TYPE_MIN);
  typeInput.max = String(TYPE_MAX);
  typeInput.step = '5';
  typeInput.value = String(clampType(settings.type));
  typeInput.setAttribute('aria-label', 'Small print size');
  typeInput.addEventListener('input', () => {
    settings.type = clampType(Number(typeInput.value));
    typeValue.textContent = `${settings.type}%`;
    restyle();
  });
  const typeRow = el('div', 'scale-row');
  typeRow.append(typeInput, typeValue);

  const sample = lookSample();
  const picker = accentPicker(settings.accent, (accent) => {
    settings.accent = accent;
    restyle();
  });

  const muteBox = el('div', 'mute-list');
  for (const kind of ALERT_KINDS) {
    const item = el('label', 'mute-item');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = !settings.mute.includes(kind);
    box.addEventListener('change', () => {
      settings.mute = ALERT_KINDS.filter((k) => (k === kind ? !box.checked : settings.mute.includes(k)));
      refresh();
    });
    item.append(box, el('span', '', ALERT_LABELS[kind]));
    muteBox.appendChild(item);
  }

  const grid = el('div', 'settings-grid');
  grid.append(
    field(
      'Theme',
      segmented<Theme>('Theme', [['dark', 'Dark plates'], ['light', 'Light plates']], settings.theme, (v) => {
        settings.theme = v;
        sample.paint(settings.theme, settings.accent, settings.type);
        refresh();
      }),
    ),
    field(
      'Accent colour',
      picker,
      'Takes over from the signal yellow in every scene. Lettering on it flips between black and cream to stay readable, and a colour too dark for the black plates is lifted until it shows. The hazard stripes stay yellow.',
    ),
    field('Small print', typeRow, 'Labels, units, notes, the ticker and alert details, for viewers on phones. The big figures keep their size.'),
    sample.root,
    field('Size', scaleRow, 'Scales every plate around its anchor. The gauge, the run card and the vertical program only shrink; resize their sources instead.'),
    field(
      'Bug corner',
      segmented<Corner>(
        'Bug corner',
        [
          ['tl', 'Top left'],
          ['tr', 'Top right'],
          ['bl', 'Bottom left'],
          ['br', 'Bottom right'],
        ],
        settings.corner,
        (v) => {
          settings.corner = v;
          refresh();
        },
        'seg-grid',
      ),
      'The full package keeps the bug in a top corner.',
    ),
    field(
      'Preview backdrop',
      segmented<Backdrop>(
        'Preview backdrop',
        [
          ['checker', 'Checker'],
          ['dark', 'Dark'],
          ['light', 'Light'],
        ],
        backdrop,
        (v) => {
          backdrop = v;
          for (const view of views) {
            if (!onStandIn(view.card)) view.frame.parentElement?.setAttribute('data-backdrop', v);
          }
        },
      ),
    ),
  );

  const switches = el('div', 'switches');
  switches.append(
    toggle('Rehearsal mode', settings.demo, 'demo=1: a scripted night with every alert and a signal drop, tagged DEMO on screen.', (on) => {
      settings.demo = on;
      refresh();
    }),
    toggle('Alert sounds', settings.sound, 'sound=1: short synthesized blips. Previews play them from the Alerts card only.', (on) => {
      settings.sound = on;
      refresh();
    }),
    toggle('Calm motion', settings.calm, 'motion=reduce: cuts and fades instead of wipes, a paged ticker.', (on) => {
      settings.calm = on;
      refresh();
    }),
  );

  controls.append(settingsTitle, grid, switches, field('Alerts that go on air', muteBox, 'Unticked kinds are added to mute= in the Alerts and Full links.'));

  // ------------------------------------------------------------ test alerts
  const tests = el('section', 'st-panel st-tests');
  tests.setAttribute('aria-labelledby', 'tests-title');
  const testsTitle = el('h2', 'st-h2', 'Fire a test alert');
  testsTitle.id = 'tests-title';
  const testRow = el('div', 'test-row');
  for (const kind of ALERT_KINDS) {
    const b = el('button', 'test-btn', ALERT_LABELS[kind]);
    b.type = 'button';
    b.addEventListener('click', () => {
      for (const view of views) {
        view.frame.contentWindow?.postMessage({ wheelcam: 'test-alert', kind }, window.location.origin);
      }
    });
    testRow.appendChild(b);
  }
  tests.append(
    testsTitle,
    el('p', 'st-note', 'Lands in the Program, Alerts and Full previews on this page only, stamped TEST. Nothing reaches OBS.'),
    testRow,
  );

  // ------------------------------------------------------------ scene cards
  const cards = el('section', 'st-cards');
  cards.setAttribute('aria-label', 'Scenes');
  for (const key of ORDER) {
    const card = SCENE_CARDS.find((c) => c.key === key);
    if (!card) continue;
    const article = el('article', `card card-${card.key}`);
    const head = el('div', 'card-head');
    head.append(el('h3', 'card-title', card.title), el('span', 'card-size', `${card.width} x ${card.height}`));
    const preview = el('div', 'card-preview');
    const standIn = onStandIn(card);
    preview.setAttribute('data-backdrop', standIn ? 'standin' : backdrop);
    if (standIn) preview.appendChild(standInFrame(card.layout));
    if (card.width === card.height) preview.classList.add('is-square');
    if (card.height > card.width) preview.classList.add('is-tall');
    const frame = el('iframe', 'card-frame');
    frame.title = `${card.title} preview`;
    frame.setAttribute('allow', 'autoplay');
    frame.setAttribute('scrolling', 'no');
    preview.appendChild(frame);

    const linkRow = el('div', 'card-link');
    const link = el('input', 'card-url');
    link.readOnly = true;
    link.setAttribute('aria-label', `${card.title} OBS URL`);
    link.addEventListener('focus', () => link.select());
    const copy = el('button', 'copy-btn', 'Copy URL');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      void copyText(link.value, link).then((ok) => {
        copy.textContent = ok ? 'Copied' : 'Select and copy';
        setTimeout(() => {
          copy.textContent = 'Copy URL';
        }, 1600);
      });
    });
    linkRow.append(link, copy);

    const meta = el('div', 'card-meta');
    meta.append(
      el('span', '', `OBS browser source: width ${card.width}, height ${card.height}`),
    );
    const open = el('a', 'card-open', 'Open alone');
    open.target = '_blank';
    open.rel = 'noopener';
    meta.appendChild(open);

    article.append(head, el('p', 'card-blurb', card.blurb), preview, linkRow, meta);
    cards.appendChild(article);
    views.push({ card, frame, link, open });
  }

  // ------------------------------------------------------------ guide
  const guide = el('section', 'st-panel st-guide');
  guide.setAttribute('aria-labelledby', 'guide-title');
  const guideTitle = el('h2', 'st-h2', 'Putting it on air');
  guideTitle.id = 'guide-title';
  const steps = el('ol', 'steps');
  const lines = [
    'Pick a look above: plates, accent colour, small print. Every link and preview follows your settings, and the accent and small print repaint the previews without reloading them.',
    'In OBS, add a Browser source, paste the scene URL and enter the width and height from its card. Leave Custom CSS as it is.',
    'Untick "Shutdown source when not visible". The alerts need to keep watching the wheel to know when Squeektoshi wakes up or turns in.',
    'Using sound? Tick "Control audio via OBS" so the blips run through your mixer instead of straight to your speakers.',
    'The 1920 x 1080 scenes are transparent and laid out to stack: add several at full canvas size and they will not collide. Program is the four everyday graphics in one source; Full adds the gauge and the run card. The gauge and run card are square, so place them wherever they look good.',
    'Streaming to phones? Set the OBS canvas to 1080 x 1920 and add Program, vertical at full canvas size. It keeps the top 150 px and the bottom 240 px clear for the app\'s own header, chat and buttons.',
    'Rehearse with Rehearsal mode. It loops a 160-second night with every alert type and a signal drop, and keeps a DEMO tag on screen so a rehearsal link cannot slip onto a real broadcast unnoticed.',
    'Times are UTC. "Today" follows the wheel\'s own day, which runs noon to noon UTC. Settled numbers trail the live wheel by about 10 to 20 minutes; that is the chain catching up, not a bug.',
  ];
  for (const line of lines) steps.appendChild(el('li', '', line));
  guide.append(guideTitle, steps);

  // ------------------------------------------------------------ footer
  const footer = el('footer', 'st-foot');
  const credit = el('p');
  credit.append(
    'Squeektoshi is the hamster on the WHEELY9000 and the entire point of this. WheelCam is a fan-made overlay kit, not an official product; the official home of the project is ',
  );
  const site = el('a', '', 'squeekchain.com');
  site.href = 'https://squeekchain.com';
  site.target = '_blank';
  site.rel = 'noopener';
  credit.append(site, '. Data comes from the public API at api.squeekchain.com. Sepolia testnet only: SQK here has no real-money value.');
  footer.append(credit, el('p', 'st-small', 'MIT licensed. Made for streamers, by people who watch a hamster run at 3 a.m.'));

  const layout = el('main', 'st-main');
  const side = el('div', 'st-side');
  side.append(controls, tests);
  layout.append(side, cards);
  app.append(header, layout, guide, footer);

  // ------------------------------------------------------------ wiring
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  /** What each frame was last loaded with, minus the look (which travels by message). */
  const loaded = new Map<HTMLIFrameElement, string>();

  function updateLinks(): void {
    for (const view of views) {
      const query = sceneQuery(view.card.id, { ...settings, layout: view.card.layout });
      view.link.value = `${pageBase()}${query}`;
      view.open.href = query;
    }
  }

  function previewQuery(view: CardView, withLook: boolean): string {
    // Only the Alerts card makes noise in the studio, so a test does not blip twice.
    const preview = { ...settings, layout: view.card.layout, sound: settings.sound && view.card.key === 'alerts' };
    return sceneQuery(view.card.id, withLook ? preview : { ...preview, accent: null, type: 100 });
  }

  function postLook(view: CardView): void {
    view.frame.contentWindow?.postMessage({ wheelcam: 'look', accent: settings.accent, type: settings.type }, window.location.origin);
  }

  /** Settings that change what a scene does: links now, previews reloaded once the clicking stops. */
  function refresh(): void {
    updateLinks();
    if (reloadTimer !== null) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reloadPreviews, 350);
  }

  /** Accent and small print only change paint: links and the sample now, previews repainted in place. */
  function restyle(): void {
    updateLinks();
    sample.paint(settings.theme, settings.accent, settings.type);
    for (const view of views) postLook(view);
  }

  function reloadPreviews(): void {
    reloadTimer = null;
    for (const view of views) {
      const key = previewQuery(view, false);
      if (loaded.get(view.frame) !== key) {
        loaded.set(view.frame, key);
        view.frame.src = previewQuery(view, true);
      }
    }
  }

  // A preview says hello once it is listening; answer with the current look, in
  // case the picker moved while it was still loading.
  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin) return;
    const view = views.find((v) => v.frame.contentWindow === event.source);
    const data = event.data;
    if (!view || typeof data !== 'object' || data === null) return;
    if ((data as { wheelcam?: unknown }).wheelcam === 'ready') postLook(view);
  });

  sample.paint(settings.theme, settings.accent, settings.type);
  refresh();
  reloadPreviews();
}
