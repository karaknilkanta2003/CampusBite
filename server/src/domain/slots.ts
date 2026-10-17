import type { CanteenRow, HoursRow, TimetableRow } from './types.ts';
import { atIstMinutes, hmOf, istDayStart, istWeekday, parseHm } from '../lib/time.ts';
import { openIntervals, type Interval } from './hours.ts';

export interface Slot {
  start: number;
  label: string;
  capacity: number;
  booked: number;
  remaining: number;
  full: boolean;
}

export interface Recommendation {
  start: number;
  reason: string;
}

/**
 * Orders a pickup slot accepts: capacity factor x what the kitchen finishes in that time,
 * rounded to the nearest order (QFD spec H2: 28 -> 24, 26-30 -> 22-26).
 */
export function slotCapacity(c: Pick<CanteenRow, 'capacity_factor' | 'throughput_per_10min' | 'slot_minutes'>): number {
  // The small epsilon keeps exact halves (0.85 x 30 = 25.5) from rounding down through float error.
  return Math.max(1, Math.round(c.capacity_factor * c.throughput_per_10min * (c.slot_minutes / 10) + 1e-9));
}

/**
 * The next pickup slots. Starts at the first slot boundary after the minimum lead
 * time and only offers slots that end before closing. Handles hours that run past
 * midnight.
 */
export function listSlots(opts: {
  canteen: CanteenRow;
  hours: HoursRow[];
  now: number;
  booked: Map<number, number>;
  minLeadMinutes: number;
  count: number;
}): Slot[] {
  const { canteen, hours, now, booked, minLeadMinutes, count } = opts;
  if (canteen.kind === 'mess') return [];
  const stepMs = canteen.slot_minutes * 60_000;
  // Only the opening in progress, or one starting within the hour (e.g. after a mess-style break).
  // A canteen that has closed for the night does not take orders for tomorrow.
  const horizon = now + 60 * 60_000;
  let intervals: Interval[] = openIntervals(hours, now).filter((i) => i.end > now && i.start < horizon);
  if (canteen.manual_status === 'open' && !intervals.some((i) => i.start <= now && now < i.end)) {
    // Opened outside its hours: offer the next few slots.
    intervals = [{ start: now, end: now + stepMs * (count + 1), weekday: istWeekday(now) }, ...intervals];
  }

  // Slot boundaries are aligned to IST minutes (e.g. 12:50, 13:00).
  const earliest = now + minLeadMinutes * 60_000;
  const capacity = slotCapacity(canteen);
  const slots: Slot[] = [];
  const seen = new Set<number>();
  for (const iv of intervals) {
    const from = Math.max(iv.start, earliest);
    const dayStart = istDayStart(from);
    let t = dayStart + Math.ceil((from - dayStart) / stepMs) * stepMs;
    for (; t + stepMs <= iv.end && slots.length < count; t += stepMs) {
      if (seen.has(t)) continue;
      seen.add(t);
      const b = booked.get(t) ?? 0;
      slots.push({ start: t, label: hmOf(t), capacity, booked: b, remaining: Math.max(0, capacity - b), full: b >= capacity });
    }
    if (slots.length >= count) break;
  }
  return slots;
}

/**
 * Suggests the first open slot the student can actually make: not during a class,
 * and leaving time to walk over after one ends.
 */
export function recommendSlot(slots: Slot[], classes: TimetableRow[], now: number, walkBufferMinutes: number): Recommendation | null {
  const open = slots.filter((s) => !s.full);
  if (open.length === 0) return null;
  const today = classes.filter((c) => c.weekday === istWeekday(now));
  const blocked = today.map((c) => ({
    from: atIstMinutes(now, parseHm(c.start_time)),
    to: atIstMinutes(now, parseHm(c.end_time) + walkBufferMinutes),
    end: c.end_time,
    title: c.title,
  }));
  for (const s of open) {
    const clash = blocked.find((b) => s.start >= b.from && s.start < b.to);
    if (clash) continue;
    const justAfter = blocked
      .filter((b) => b.to <= s.start && s.start - b.to < 15 * 60_000)
      .sort((a, b) => b.to - a.to)[0];
    if (justAfter) {
      return { start: s.start, reason: `${justAfter.title || 'Your class'} ends at ${justAfter.end}, leaving time to walk over` };
    }
    return { start: s.start, reason: 'Earliest time that fits your timetable' };
  }
  return null;
}
