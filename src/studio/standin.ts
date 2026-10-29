// The stand-in for the camera behind the studio's Program previews: the
// enclosure drawn as flat shapes on the same canvas as the graphics (1920 x
// 1080, or 1080 x 1920 for the vertical program), so a visitor without OBS sees
// them over something stream-shaped. Static on purpose: the overlays on top are
// what moves.

import type { Layout } from '../logic/options.ts';
import { svg } from '../scenes/kit.ts';

const INK = '#111214';
const SIGNAL = '#f4c20d';
const HAMSTER = '#d9792b';
const CREAM = '#f3e3c6';

type Attrs = Record<string, string | number>;
type Tag = 'rect' | 'circle' | 'ellipse' | 'line' | 'path' | 'text';

/** Where things stand in each frame. Props are drawn at their landscape spots, then shifted. */
interface Plan {
  width: number;
  height: number;
  /** Top edge of the bedding. */
  bedding: number;
  wheel: { cx: number; cy: number; r: number };
  house: [number, number];
  hamster: [number, number];
  bottle: [number, number];
  shavings: number;
  label: { x: number; y: number; anchor: 'end' | 'middle'; lines: [string, string] };
}

const PLANS: Record<Layout, Plan> = {
  landscape: {
    width: 1920,
    height: 1080,
    bedding: 700,
    wheel: { cx: 1190, cy: 410, r: 300 },
    house: [0, 0],
    hamster: [0, 0],
    bottle: [0, 0],
    shavings: 150,
    label: { x: 1852, y: 626, anchor: 'end', lines: ['STAND-IN FRAME', 'YOUR CAMERA GOES HERE'] },
  },
  // A phone crop of the same enclosure: wheel mid-frame, house and hamster on
  // the bedding below it, and the bottom strip labelled for the app's chat.
  vertical: {
    width: 1080,
    height: 1920,
    bedding: 1270,
    wheel: { cx: 640, cy: 990, r: 270 },
    house: [-120, 570],
    hamster: [260, 570],
    bottle: [-1540, 300],
    shavings: 220,
    label: { x: 540, y: 1776, anchor: 'middle', lines: ['STAND-IN FRAME', 'PHONE APPS PUT THEIR CHAT DOWN HERE'] },
  },
};

export function standInFrame(layout: Layout = 'landscape'): SVGSVGElement {
  const plan = PLANS[layout];
  const { width, height, bedding } = plan;
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'standin', 'aria-hidden': 'true' });
  const add = (tag: Tag, attrs: Attrs, parent: SVGElement = root): SVGElement => {
    const node = svg(tag, attrs);
    parent.appendChild(node);
    return node;
  };
  const shifted = ([dx, dy]: [number, number]): SVGGElement => {
    const g = svg('g', { transform: `translate(${dx} ${dy})` });
    root.appendChild(g);
    return g;
  };

  // Back wall and bedding.
  add('rect', { width, height, fill: '#e7ddcb' });
  add('rect', { y: bedding, width, height: height - bedding, fill: '#d5bf91' });
  // Wood shavings from a fixed recipe, so the frame is the same every time.
  let seed = 11;
  const next = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < plan.shavings; i += 1) {
    const x = next() * width;
    const y = bedding + 12 + next() * (height - bedding - 20);
    const len = 14 + next() * 28;
    const a = (next() - 0.5) * 1.3;
    add('line', {
      x1: x.toFixed(0),
      y1: y.toFixed(0),
      x2: (x + Math.cos(a) * len).toFixed(0),
      y2: (y + Math.sin(a) * len).toFixed(0),
      stroke: i % 3 === 0 ? '#ecdcb3' : '#bfa16a',
      'stroke-width': 5,
      'stroke-linecap': 'round',
    });
  }

  // The WHEELY9000 on its stand: running track of rungs, six spokes, yellow hub.
  const { cx, cy, r } = plan.wheel;
  const feet = bedding + 60;
  add('path', {
    d: `M ${cx} ${cy} L ${cx - 140} ${feet} M ${cx} ${cy} L ${cx + 140} ${feet}`,
    stroke: INK,
    'stroke-width': 22,
    'stroke-linecap': 'round',
    fill: 'none',
  });
  add('circle', { cx, cy, r, fill: 'none', stroke: INK, 'stroke-width': 22 });
  add('circle', { cx, cy, r: r - 36, fill: 'none', stroke: INK, 'stroke-width': 8 });
  for (let i = 0; i < 48; i += 1) {
    const a = (i / 48) * Math.PI * 2;
    add('line', {
      x1: (cx + Math.cos(a) * (r - 36)).toFixed(1),
      y1: (cy + Math.sin(a) * (r - 36)).toFixed(1),
      x2: (cx + Math.cos(a) * r).toFixed(1),
      y2: (cy + Math.sin(a) * r).toFixed(1),
      stroke: INK,
      'stroke-width': 5,
    });
  }
  for (let i = 0; i < 6; i += 1) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    add('line', {
      x1: cx,
      y1: cy,
      x2: (cx + Math.cos(a) * (r - 36)).toFixed(1),
      y2: (cy + Math.sin(a) * (r - 36)).toFixed(1),
      stroke: INK,
      'stroke-width': 10,
    });
  }
  add('circle', { cx, cy, r: 36, fill: SIGNAL, stroke: INK, 'stroke-width': 9 });

  // The house, with a doorway.
  const house = shifted(plan.house);
  add('rect', { x: 170, y: 500, width: 330, height: 220, fill: '#b9844f' }, house);
  add('path', { d: 'M 140 512 L 335 372 L 530 512 Z', fill: '#8a582c' }, house);
  add('path', { d: 'M 280 720 L 280 618 A 55 55 0 0 1 390 618 L 390 720 Z', fill: INK }, house);

  // Squeektoshi, curled up asleep in the bedding: the usual state of things.
  const hamster = shifted(plan.hamster);
  add('ellipse', { cx: 640, cy: 690, rx: 96, ry: 60, fill: HAMSTER }, hamster);
  add('ellipse', { cx: 600, cy: 742, rx: 22, ry: 10, fill: CREAM }, hamster);
  add('ellipse', { cx: 676, cy: 744, rx: 22, ry: 10, fill: CREAM }, hamster);
  add('ellipse', { cx: 688, cy: 704, rx: 42, ry: 30, fill: CREAM }, hamster);
  add('circle', { cx: 686, cy: 640, r: 17, fill: '#e9a46b' }, hamster);
  add('path', { d: 'M 690 676 q 11 9 22 0', stroke: INK, 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round' }, hamster);
  add('circle', { cx: 732, cy: 692, r: 6, fill: '#7a3d1c' }, hamster);

  // Water bottle on the wall.
  const bottle = shifted(plan.bottle);
  add('rect', { x: 1660, y: 150, width: 92, height: 300, rx: 30, fill: '#d5e6ea', stroke: INK, 'stroke-width': 8 }, bottle);
  add('rect', { x: 1668, y: 290, width: 76, height: 152, rx: 22, fill: '#9fc6d1' }, bottle);
  add('rect', { x: 1680, y: 120, width: 52, height: 36, fill: INK }, bottle);
  add('path', { d: 'M 1706 450 L 1706 540', stroke: '#8d949a', 'stroke-width': 12, 'stroke-linecap': 'round' }, bottle);

  const { x, y, anchor, lines } = plan.label;
  const label = (dy: number, size: number, text: string): void => {
    const node = add('text', {
      x,
      y: y + dy,
      fill: '#857a67',
      'text-anchor': anchor,
      'font-family': "'Barlow Condensed', 'Arial Narrow', sans-serif",
      'font-weight': 700,
      'font-size': size,
      'letter-spacing': 4,
    });
    node.textContent = text;
  };
  label(0, 34, lines[0]);
  label(38, 24, lines[1]);
  return root;
}
