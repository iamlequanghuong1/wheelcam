// How long a poller waits before its next attempt. Pure, so it can be tested
// without timers: the random jitter is passed in.

const LONGEST_RETRY_AFTER_MS = 600_000;

/**
 * Read a Retry-After header: either seconds or an HTTP date. Returns ms to wait,
 * capped at ten minutes, or null when the header is missing or unreadable.
 */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (header === null || header.trim() === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, LONGEST_RETRY_AFTER_MS);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(Math.max(0, at - now), LONGEST_RETRY_AFTER_MS) : null;
}

/**
 * Wait after the `misses`-th failure in a row: the normal interval doubled per
 * miss, capped at `ceilingMs`, spread by plus or minus 15% so many browser sources
 * do not retry in lockstep, and never shorter than the server's Retry-After.
 * With no misses it is simply the normal interval.
 */
export function nextDelay(
  everyMs: number,
  ceilingMs: number,
  misses: number,
  retryAfter: number | null,
  random: number,
): number {
  if (misses <= 0) return everyMs;
  const grown = Math.min(ceilingMs, everyMs * 2 ** misses);
  const jittered = grown * (0.85 + Math.min(1, Math.max(0, random)) * 0.3);
  return Math.max(jittered, retryAfter ?? 0);
}
