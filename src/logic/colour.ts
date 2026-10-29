// The accent colour: one hex value from the URL, turned into the handful of
// theme tokens it replaces. The accent takes the place of WheelCam's signal
// yellow and nothing else: hazard stripes stay yellow and black, and record
// orange stays orange, so warnings and records still look like themselves.
// Every output is rebuilt from numbers, so no URL text ever reaches the CSS.

import type { Theme } from './options.ts';

export const SIGNAL_YELLOW = '#f4c20d';
/** Plate and tab black, shared by both themes. */
export const INK = '#111214';
/** Warm white lettering for dark accents. */
export const PAPER = '#f3eee4';

/** Inline custom properties an accent may set on the overlay's root element. */
export const ACCENT_TOKENS = ['--accent', '--on-accent', '--tab', '--on-tab', '--fill'] as const;
export type AccentToken = (typeof ACCENT_TOKENS)[number];

/** Six lowercase hex digits after a #, nothing else. */
const HEX6 = /^#[0-9a-f]{6}$/;

/**
 * Reads an accent from a URL parameter: `f4c20d`, `#f4c20d` or `fc0`, any
 * case. Anything else is ignored, and the stock yellow counts as no accent.
 */
export function parseAccent(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim());
  const digits = m?.[1]?.toLowerCase();
  if (!digits) return null;
  const hex = `#${digits.length === 3 ? Array.from(digits, (c) => c + c).join('') : digits}`;
  return hex === SIGNAL_YELLOW ? null : hex;
}

type Rgb = [number, number, number];

function rgbOf(hex: string): Rgb {
  if (!HEX6.test(hex)) return [0, 0, 0];
  return [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16)) as Rgb;
}

function hexOf(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Ink or paper, whichever reads better on the given colour. */
export function readableOn(background: string): string {
  return contrast(background, INK) >= contrast(background, PAPER) ? INK : PAPER;
}

/**
 * The colour itself if it already stands `min`:1 off the background, else the
 * first 5 % step towards white (on dark) or black (on light) that does.
 */
export function ensureContrast(colour: string, background: string, min: number): string {
  const from = rgbOf(colour);
  const to: Rgb = luminance(background) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  for (let step = 0; step <= 20; step += 1) {
    const w = step / 20;
    const candidate = hexOf([0, 1, 2].map((i) => from[i]! + (to[i]! - from[i]!) * w) as Rgb);
    if (contrast(candidate, background) >= min) return candidate;
  }
  return hexOf(to);
}

/**
 * The tokens an accent sets for a theme. Dark plates: the accent fills the
 * tabs, bars, arcs and trace, lifted until it stands 3:1 off the black plates.
 * Light plates keep black tabs and ink bars; the accent becomes the tab
 * lettering, lifted until it reads 4.5:1 on black. Lettering placed on the
 * accent is ink or paper, whichever is clearer. No accent, no tokens.
 */
export function accentTokens(accent: string | null, theme: Theme): Partial<Record<AccentToken, string>> {
  if (accent === null || !HEX6.test(accent)) return {};
  if (theme === 'dark') {
    const a = ensureContrast(accent, INK, 3);
    const on = readableOn(a);
    return { '--accent': a, '--on-accent': on, '--tab': a, '--on-tab': on, '--fill': a };
  }
  const a = ensureContrast(accent, INK, 4.5);
  return { '--accent': a, '--on-accent': readableOn(a), '--on-tab': a };
}

/** Quick picks for the studio. Any other hex works through the colour field or the URL. */
export const ACCENT_PRESETS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Signal yellow', hex: SIGNAL_YELLOW },
  { name: 'Water-bottle blue', hex: '#5aa9e6' },
  { name: 'Cucumber green', hex: '#7cc35a' },
  { name: 'Chew-toy pink', hex: '#ff6fa8' },
  { name: 'Pellet violet', hex: '#9a7cf5' },
  { name: 'Night-shift red', hex: '#e8483e' },
  { name: 'Bedding white', hex: '#f3eee4' },
];
