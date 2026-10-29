// Wires the public API into the hub. Each scene asks only for the endpoints it
// draws from, so a corner bug does not pull settlement history.

import { Poller } from './poller.ts';
import type { Hub } from './hub.ts';
import { readEconomy, readEvents, readSettlements, readStats, readStatus } from '../logic/wire.ts';

export interface Needs {
  events: boolean;
  stats: boolean;
  settlements: boolean;
  economy: boolean;
}

const configured: unknown = import.meta.env.VITE_SQUEEK_API;
export const API_BASE =
  typeof configured === 'string' && /^https?:\/\//.test(configured) ? configured : 'https://api.squeekchain.com/v1';

export function startLiveFeed(hub: Hub, needs: Needs): () => void {
  const pollers: Array<{ stop(): void }> = [];

  const events = needs.events
    ? new Poller(
        API_BASE,
        { path: '/events?category=measurement&limit=40', everyMs: 15_000, ceilingMs: 120_000, read: readEvents },
        { ok: (snap) => hub.eventsOk(snap), fail: () => undefined },
      )
    : null;

  // The events gate needs the server clock, which the first status answer gives us.
  let eventsStarted = false;
  const startEvents = (): void => {
    if (events && !eventsStarted) {
      eventsStarted = true;
      events.start(250);
    }
  };

  const status = new Poller(
    API_BASE,
    { path: '/status', everyMs: 2_000, ceilingMs: 30_000, read: readStatus },
    {
      ok: (snap, changed, at) => {
        hub.statusOk(snap, changed, at);
        startEvents();
      },
      fail: (_problem, at) => {
        hub.statusFailed(at);
        startEvents();
      },
    },
  );
  status.start(0);
  pollers.push(status);
  if (events) pollers.push(events);
  const fallback = setTimeout(startEvents, 4_000);

  if (needs.stats) {
    const stats = new Poller(
      API_BASE,
      { path: '/measurement/stats?range=7d', everyMs: 60_000, ceilingMs: 300_000, read: readStats },
      { ok: (snap, changed) => changed && hub.statsOk(snap), fail: () => undefined },
    );
    stats.start(400);
    pollers.push(stats);
  }
  if (needs.settlements) {
    const settlements = new Poller(
      API_BASE,
      { path: '/settlements?range=now', everyMs: 60_000, ceilingMs: 300_000, read: readSettlements },
      { ok: (snap, changed) => changed && hub.settlementsOk(snap), fail: () => undefined },
    );
    settlements.start(800);
    pollers.push(settlements);
  }
  if (needs.economy) {
    const economy = new Poller(
      API_BASE,
      { path: '/economy/state', everyMs: 60_000, ceilingMs: 300_000, read: readEconomy },
      { ok: (snap, changed) => changed && hub.economyOk(snap), fail: () => undefined },
    );
    economy.start(1_200);
    pollers.push(economy);
  }

  return () => {
    clearTimeout(fallback);
    for (const p of pollers) p.stop();
  };
}
