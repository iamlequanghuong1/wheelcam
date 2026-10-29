// One polling loop per endpoint. Conditional requests with the ETag the API sends
// (exposed through CORS), a hard timeout, exponential backoff with jitter on
// failures, and Retry-After respected on 429 and 503.

import { nextDelay, retryAfterMs } from '../logic/backoff.ts';

export interface PollPlan<T> {
  path: string;
  everyMs: number;
  /** Longest wait between attempts while failing. */
  ceilingMs: number;
  read: (raw: unknown) => T;
}

export interface PollSink<T> {
  /** `changed` is false for a 304 or an identical ETag. */
  ok(data: T, changed: boolean, at: number): void;
  fail(problem: string, at: number): void;
}

const TIMEOUT_MS = 8_000;

export class Poller<T> {
  private readonly url: string;
  private readonly plan: PollPlan<T>;
  private readonly sink: PollSink<T>;
  private etag: string | null = null;
  private last: T | null = null;
  private misses = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(base: string, plan: PollPlan<T>, sink: PollSink<T>) {
    this.url = base.replace(/\/+$/, '') + plan.path;
    this.plan = plan;
    this.sink = sink;
  }

  start(delayMs = 0): void {
    if (this.running) return;
    this.running = true;
    this.later(delayMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private later(ms: number): void {
    this.timer = setTimeout(() => {
      void this.attempt();
    }, ms);
  }

  private backoff(floorMs: number | null): number {
    this.misses += 1;
    return nextDelay(this.plan.everyMs, this.plan.ceilingMs, this.misses, floorMs, Math.random());
  }

  private async attempt(): Promise<void> {
    if (!this.running) return;
    const controller = new AbortController();
    const guard = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let wait = this.plan.everyMs;
    let outcome: { ok: true; data: T; changed: boolean } | { ok: false; problem: string };
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.etag !== null && this.last !== null) headers['If-None-Match'] = this.etag;
      const res = await fetch(this.url, {
        headers,
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (res.status === 304 && this.last !== null) {
        outcome = { ok: true, data: this.last, changed: false };
      } else if (res.ok) {
        const data = this.plan.read(await res.json());
        const etag = res.headers.get('ETag');
        const changed = etag === null || etag !== this.etag;
        this.etag = etag;
        this.last = data;
        outcome = { ok: true, data, changed };
      } else {
        const throttled = res.status === 429 || res.status === 503;
        wait = this.backoff(throttled ? retryAfterMs(res.headers.get('Retry-After'), Date.now()) : null);
        outcome = { ok: false, problem: `HTTP ${res.status}` };
      }
      if (outcome.ok) this.misses = 0;
    } catch (err) {
      wait = this.backoff(null);
      outcome = { ok: false, problem: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
    } finally {
      clearTimeout(guard);
    }
    if (!this.running) return;
    const at = Date.now();
    try {
      if (outcome.ok) this.sink.ok(outcome.data, outcome.changed, at);
      else this.sink.fail(outcome.problem, at);
    } catch (err) {
      // A rendering bug must not stop the feed.
      console.error('[wheelcam] update failed', err);
    }
    this.later(wait);
  }
}
