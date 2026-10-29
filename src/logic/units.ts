// Number and time formatting for on-air text.
// The API sends big values as decimal strings, so everything that can be big
// stays a bigint until the moment it becomes text. Nothing in here touches the DOM.

/** What we print when a value is unknown. Never a zero. */
export const UNKNOWN = '--';

const DIGITS = /^\d{1,78}$/;

/** Unsigned decimal string (or safe non-negative integer) to bigint; null when malformed. */
export function big(v: unknown): bigint | null {
  if (typeof v === 'string' && DIGITS.test(v)) return BigInt(v);
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  return null;
}

/** 1234567 -> "1,234,567" without depending on the machine locale. */
export function grouped(v: bigint): string {
  const negative = v < 0n;
  const digits = (negative ? -v : v).toString();
  const out = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${out}` : out;
}

/**
 * Divide by 10^scale and print with `decimals` digits, rounding half up.
 * scaled(19835776n, 6, 2) -> "19.84" (millimetres to kilometres).
 */
export function scaled(v: bigint, scale: number, decimals: number): string {
  const negative = v < 0n;
  const magnitude = negative ? -v : v;
  const numerator = magnitude * 10n ** BigInt(decimals);
  const denominator = 10n ** BigInt(scale);
  let q = numerator / denominator;
  if ((numerator % denominator) * 2n >= denominator) q += 1n;
  const unit = 10n ** BigInt(decimals);
  const whole = grouped(q / unit);
  const body = decimals > 0 ? `${whole}.${(q % unit).toString().padStart(decimals, '0')}` : whole;
  return negative && q !== 0n ? `-${body}` : body;
}

function asBig(v: bigint | number | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v;
  if (!Number.isFinite(v)) return null;
  return BigInt(Math.round(v));
}

/** Millimetres to a kilometre figure ("4.21"). Unknown stays unknown. */
export function km(mm: bigint | number | null | undefined, decimals = 2): string {
  const v = asBig(mm);
  return v === null ? UNKNOWN : scaled(v, 6, decimals);
}

/** Millimetres per second to km/h ("5.9"). 1 mm/s = 0.0036 km/h. */
export function kmh(mmPerSecond: bigint | number | null | undefined, decimals = 1): string {
  const v = asBig(mmPerSecond);
  return v === null ? UNKNOWN : scaled(v * 36n, 4, decimals);
}

/** Thousandths of an rpm to a whole rpm figure. */
export function rpm(rpmMilli: number | bigint | null | undefined): string {
  const v = asBig(rpmMilli);
  return v === null ? UNKNOWN : scaled(v, 3, 0);
}

/** Whole count with separators, or unknown. */
export function count(v: bigint | number | null | undefined): string {
  const b = asBig(v);
  return b === null ? UNKNOWN : grouped(b);
}

/** SQK base units (18 decimals) in a short broadcast form: "131,325", "8.11M". */
export function sqk(baseUnits: bigint | null | undefined): string {
  if (baseUnits === null || baseUnits === undefined) return UNKNOWN;
  const whole = baseUnits / 10n ** 18n;
  if (whole >= 1_000_000_000n) return `${scaled(whole, 9, 2)}B`;
  if (whole >= 1_000_000n) return `${scaled(whole, 6, 2)}M`;
  if (whole >= 10n) return grouped(whole);
  return scaled(baseUnits, 18, 2);
}

/** "just now", "9 min ago", "2 h 5 min ago", "3 days ago". */
export function ago(ms: number): string {
  if (!Number.isFinite(ms) || ms < 45_000) return 'just now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 36) {
    const rest = minutes - hours * 60;
    return rest === 0 ? `${hours} h ago` : `${hours} h ${rest} min ago`;
  }
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** Run clock: "0:42", "41:07", "1:12:07". */
export function stopwatch(ms: number): string {
  if (!Number.isFinite(ms)) return UNKNOWN;
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** A duration said out loud: "45 s", "4 min 12 s", "41 min", "1 h 12 min". */
export function durationWords(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 10) {
    const s = total % 60;
    return s === 0 ? `${minutes} min` : `${minutes} min ${s} s`;
  }
  const rounded = Math.round(total / 60);
  if (rounded < 60) return `${rounded} min`;
  const h = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** "21:04" in UTC. */
export function utcClock(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** Minute of the UTC day to "21:30". */
export function minuteClock(minuteOfDay: number): string {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 27" from a timestamp or a YYYY-MM-DD string; null when it does not parse. */
export function dayLabel(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  let ms: number;
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return null;
    ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    ms = v;
  }
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Block progress (0..1e9 block units) as a 0..1 fraction. */
export function blockFraction(progress: bigint | null | undefined): number | null {
  if (progress === null || progress === undefined) return null;
  if (progress < 0n) return 0;
  if (progress >= 1_000_000_000n) return 1;
  return Number(progress) / 1e9;
}

/** Plural helper for copy: plural(1, 'block') -> "1 block". */
export function plural(n: bigint | number, word: string, many = `${word}s`): string {
  const isOne = typeof n === 'bigint' ? n === 1n : n === 1;
  return `${typeof n === 'bigint' ? grouped(n) : n.toLocaleString('en-US')} ${isOne ? word : many}`;
}
