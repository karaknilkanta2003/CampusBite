import type { HoursRow } from './types.ts';
import { istDayStart, istWeekday, parseHm } from '../lib/time.ts';

const DAY_MS = 86_400_000;

export interface Interval {
  start: number;
  end: number;
  /** The weekday row this interval came from (its opening day). */
  weekday: number;
}

/** Length of an opening in minutes. A closing time at or before the opening time runs past midnight. */
function spanMinutes(h: HoursRow): number {
  const open = parseHm(h.open_time);
  const close = parseHm(h.close_time);
  return close > open ? close - open : close + 1440 - open;
}

/** Opening intervals (absolute ms) from yesterday through the next 7 days, sorted. */
export function openIntervals(hours: HoursRow[], now: number): Interval[] {
  const today = istDayStart(now);
  const out: Interval[] = [];
  for (let offset = -1; offset <= 7; offset++) {
    const dayStart = today + offset * DAY_MS;
    const weekday = istWeekday(dayStart + DAY_MS / 2);
    for (const h of hours.filter((x) => x.weekday === weekday)) {
      const start = dayStart + parseHm(h.open_time) * 60_000;
      out.push({ start, end: start + spanMinutes(h) * 60_000, weekday });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** "07:30–09:30, 12:30–14:30" for a weekday, or null when closed that day. */
export function dayLabel(hours: HoursRow[], weekday: number): string | null {
  const rows = hours.filter((h) => h.weekday === weekday).sort((a, b) => parseHm(a.open_time) - parseHm(b.open_time));
  return rows.length ? rows.map((h) => `${h.open_time}–${h.close_time}`).join(', ') : null;
}

export function currentInterval(hours: HoursRow[], now: number): Interval | null {
  return openIntervals(hours, now).find((i) => i.start <= now && now < i.end) ?? null;
}

export function nextInterval(hours: HoursRow[], now: number): Interval | null {
  return openIntervals(hours, now).find((i) => i.start > now) ?? null;
}
