// Ticker: a continuous crawl of facts. Items are written at the moment they join
// the crawl, so the numbers are always current, and recycled once they leave.
// With reduced motion it becomes a paged ticker that cuts between facts.

import type { Hub } from '../feed/hub.ts';
import { tickerFacts } from '../logic/wording.ts';
import type { Fact } from '../logic/wording.ts';
import { demoTag, el, isCalm, onFrame } from './kit.ts';

const CRAWL_PX_PER_SECOND = 120;
const PAGE_MS = 7_000;

export function mountTicker(stage: HTMLElement, hub: Hub): void {
  const root = el('div', 'tk enter');
  const label = el('div', 'tk-label', 'Wheel report');
  const windowEl = el('div', 'tk-window');
  const track = el('div', 'tk-track');
  windowEl.appendChild(track);
  root.append(label, windowEl);
  stage.appendChild(root);

  let facts: Fact[] = [];
  let lastKey: string | null = null;
  let tagged = false;
  // Nothing crawls until the first answer (or a lost signal), so the opening
  // seconds are not filled with the only facts that need no data.
  let ready = false;

  /** Next fact in rotation, skipping ones already on screen when there is a choice. */
  const nextFact = (): Fact | null => {
    if (!ready || facts.length === 0) return null;
    const onScreen = new Set(Array.from(track.children, (n) => (n as HTMLElement).dataset.key));
    const start = lastKey === null ? -1 : facts.findIndex((f) => f.key === lastKey);
    let pick: Fact | null = null;
    for (let step = 1; step <= facts.length; step += 1) {
      const candidate = facts[(start + step) % facts.length];
      if (candidate && !onScreen.has(candidate.key)) {
        pick = candidate;
        break;
      }
    }
    pick = pick ?? facts[(start + 1) % facts.length] ?? null;
    lastKey = pick ? pick.key : null;
    return pick;
  };

  const item = (fact: Fact): HTMLElement => {
    const node = el('span', 'tk-item');
    node.dataset.key = fact.key;
    node.append(el('b', 'tk-tag', fact.tag), el('span', 'tk-text', fact.text));
    return node;
  };

  hub.subscribe((s) => {
    if (s.signal.state !== 'tuning') ready = true;
    facts = tickerFacts({
      serverNow: s.serverNow,
      status: s.status,
      signal: s.signal,
      mood: s.mood,
      stats: s.stats,
      settlements: s.settlements,
      economy: s.economy,
      hint: s.hint,
    });
    if (s.demo && !tagged) {
      tagged = true;
      root.appendChild(demoTag());
    }
  });

  // Continuous crawl.
  let offset = Number.NaN;
  onFrame((dt) => {
    if (isCalm()) return;
    const visible = windowEl.clientWidth;
    if (visible === 0) return; // not laid out yet (fonts still loading)
    if (Number.isNaN(offset)) offset = visible * 0.4;
    let guard = 0;
    while (offset + track.offsetWidth < visible + 200 && guard < 24) {
      const fact = nextFact();
      if (!fact) break;
      track.appendChild(item(fact));
      guard += 1;
    }
    offset -= CRAWL_PX_PER_SECOND * dt;
    let first = track.firstElementChild as HTMLElement | null;
    while (first && offset + first.offsetWidth < 0) {
      offset += first.offsetWidth;
      first.remove();
      first = track.firstElementChild as HTMLElement | null;
    }
    track.style.transform = `translate3d(${offset.toFixed(2)}px, 0, 0)`;
  });

  // Paged mode for reduced motion: one fact at a time, hard cuts.
  const page = (): void => {
    if (!isCalm()) return;
    const fact = nextFact();
    if (!fact) return;
    track.replaceChildren(item(fact));
    track.style.transform = 'none';
    offset = Number.NaN;
  };
  setInterval(page, PAGE_MS);
  setTimeout(page, 600);
}
