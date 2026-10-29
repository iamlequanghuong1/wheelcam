// Small DOM toolkit for the overlays. Data only ever reaches the page through
// textContent and numeric attributes; there is no innerHTML anywhere.

import { signalWords } from '../logic/wording.ts';
import type { SignalReport } from '../logic/rules.ts';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

/** Set text only when it changed, so idle updates do not touch layout. */
export function put(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Set (or clear) a data attribute only when it changed. */
export function mark(node: HTMLElement, name: string, value: string | null): void {
  const current = node.getAttribute(`data-${name}`);
  if (value === null) {
    if (current !== null) node.removeAttribute(`data-${name}`);
  } else if (current !== value) {
    node.setAttribute(`data-${name}`, value);
  }
}

// ---------------------------------------------------------------- motion

let calm = false;

/** True when motion should be kept to cuts and fades. */
export const isCalm = (): boolean => calm;

export function setupMotion(forced: boolean): void {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const apply = (): void => {
    calm = forced || query.matches;
    document.documentElement.setAttribute('data-motion', calm ? 'calm' : 'full');
  };
  apply();
  query.addEventListener('change', apply);
}

type FrameFn = (dt: number, now: number) => void;
const frameFns: FrameFn[] = [];
let lastFrame = 0;

function frame(now: number): void {
  const dt = lastFrame === 0 ? 0 : Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  for (const fn of frameFns) fn(dt, now);
  requestAnimationFrame(frame);
}

/** One shared animation loop for needles, wheels and the ticker. */
export function onFrame(fn: FrameFn): void {
  if (frameFns.length === 0) requestAnimationFrame(frame);
  frameFns.push(fn);
}

// ---------------------------------------------------------------- stage

/**
 * A fixed design canvas (1920 x 1080 or 720 x 720) that scales to whatever size
 * the browser source is, keeping its aspect ratio and centring the leftover.
 */
export function mountStage(host: HTMLElement, width: number, height: number, className: string): HTMLElement {
  const stage = el('div', `stage ${className}`);
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  host.appendChild(stage);
  const fit = (): void => {
    const w = window.innerWidth || width;
    const h = window.innerHeight || height;
    const s = Math.min(w / width, h / height);
    const x = (w - width * s) / 2;
    const y = (h - height * s) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  };
  fit();
  window.addEventListener('resize', fit);
  return stage;
}

// ---------------------------------------------------------------- shared pieces

/** The WheelCam mark: a hamster wheel with six spokes. Returns the svg and the part that turns. */
export function wheelGlyph(size: number): { root: SVGSVGElement; rotor: SVGGElement } {
  const root = svg('svg', { viewBox: '-50 -50 100 100', width: size, height: size, 'aria-hidden': 'true' });
  const rotor = svg('g');
  rotor.appendChild(svg('circle', { r: 40, fill: 'none', stroke: 'currentColor', 'stroke-width': 9 }));
  for (let i = 0; i < 6; i += 1) {
    const a = (i * Math.PI) / 3;
    rotor.appendChild(
      svg('line', {
        x1: 0,
        y1: 0,
        x2: (36 * Math.cos(a)).toFixed(2),
        y2: (36 * Math.sin(a)).toFixed(2),
        stroke: 'currentColor',
        'stroke-width': 6,
        'stroke-linecap': 'square',
      }),
    );
  }
  rotor.appendChild(svg('circle', { r: 9, fill: 'currentColor' }));
  root.appendChild(rotor);
  return { root, rotor };
}

/** Yellow and black caution plate used everywhere the feed is lost. */
export function signalPlate(className: string): { root: HTMLElement; update: (report: SignalReport) => void } {
  const root = el('div', `lost ${className}`);
  const stripes = el('span', 'lost-stripes');
  const words = el('span', 'lost-words');
  const title = el('span', 'lost-title');
  const detail = el('span', 'lost-detail');
  words.append(title, detail);
  root.append(stripes, words);
  return {
    root,
    update(report) {
      const w = signalWords(report);
      put(title, w.title);
      put(detail, w.detail);
    },
  };
}

export function demoTag(): HTMLElement {
  return el('span', 'demo-tag', 'Demo feed');
}

/** Spring-damped follower for needles: slightly underdamped so it settles like a real one. */
export class Spring {
  value: number;
  private velocity = 0;
  constructor(start = 0) {
    this.value = start;
  }
  step(target: number, dt: number, stiffness = 26, damping = 0.72): number {
    if (isCalm()) {
      this.value = target;
      this.velocity = 0;
      return this.value;
    }
    const c = 2 * Math.sqrt(stiffness) * damping;
    let left = dt;
    while (left > 0) {
      const h = Math.min(left, 1 / 120);
      const accel = stiffness * (target - this.value) - c * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
      left -= h;
    }
    return this.value;
  }
  snap(v: number): void {
    this.value = v;
    this.velocity = 0;
  }
}
