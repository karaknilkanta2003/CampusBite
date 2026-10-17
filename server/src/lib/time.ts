// All campus times are India Standard Time (UTC+05:30, no daylight saving).
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Minutes since IST midnight for a timestamp. */
export function istMinutes(ms: number): number {
  const local = ms + IST_OFFSET_MS;
  return Math.floor((((local % DAY_MS) + DAY_MS) % DAY_MS) / 60_000);
}

/** 0 = Sunday, in IST. */
export function istWeekday(ms: number): number {
  return new Date(ms + IST_OFFSET_MS).getUTCDay();
}

/** Timestamp of IST midnight on the day containing ms. */
export function istDayStart(ms: number): number {
  const local = ms + IST_OFFSET_MS;
  return local - (((local % DAY_MS) + DAY_MS) % DAY_MS) - IST_OFFSET_MS;
}

/** "13:05" -> 785 */
export function parseHm(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) throw new Error(`Bad time "${hm}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) throw new Error(`Bad time "${hm}"`);
  return h * 60 + min;
}

/** 785 -> "13:05" */
export function formatHm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "13:05" for a timestamp, in IST. */
export function hmOf(ms: number): string {
  return formatHm(istMinutes(ms));
}

/** Timestamp for a given IST minute-of-day on the same IST day as dayRef. */
export function atIstMinutes(dayRef: number, minutes: number): number {
  return istDayStart(dayRef) + minutes * 60_000;
}

export function isValidHm(hm: string): boolean {
  try {
    parseHm(hm);
    return true;
  } catch {
    return false;
  }
}
