import type { CanteenRow, HoursRow } from './types.ts';
import { hmOf, istDayStart, istWeekday } from '../lib/time.ts';
import { currentInterval, dayLabel, nextInterval } from './hours.ts';

export type CanteenState = 'open' | 'closed' | 'unconfirmed';

export interface CanteenStatus {
  state: CanteenState;
  /** Short line shown to students, e.g. "Open · closes 22:30". */
  label: string;
  acceptingOrders: boolean;
  /** Today's hours in IST, e.g. "09:00–01:00", or null when closed all day. */
  todayHours: string | null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function closesLabel(end: number): string {
  const hm = hmOf(end);
  return hm === '00:00' ? 'midnight' : hm;
}

function opensLabel(hours: HoursRow[], now: number): string | null {
  const next = nextInterval(hours, now);
  if (!next) return null;
  const days = Math.round((istDayStart(next.start) - istDayStart(now)) / 86_400_000);
  if (days === 0) return `opens ${hmOf(next.start)}`;
  if (days === 1) return `opens tomorrow ${hmOf(next.start)}`;
  return `opens ${DAY_NAMES[istWeekday(next.start)]} ${hmOf(next.start)}`;
}

/**
 * Open/closed status. A canteen is only shown as open when it is within its hours
 * (or opened manually) AND its kitchen tablet has checked in recently. Otherwise
 * students see "Status unconfirmed" rather than a possibly wrong "Open" (QFD spec H1).
 * Messes have no kitchen tablet, so their status comes from their meal times alone.
 */
export function computeStatus(c: CanteenRow, hours: HoursRow[], now: number, heartbeatStaleMs: number): CanteenStatus {
  const todayHours = dayLabel(hours, istWeekday(now));
  const current = currentInterval(hours, now);

  if (c.manual_status === 'closed') {
    const next = opensLabel(hours, now);
    return { state: 'closed', label: next ? `Closed today · ${next}` : 'Closed', acceptingOrders: false, todayHours };
  }

  const open = c.manual_status === 'open' || !!current;
  if (!open) {
    const next = opensLabel(hours, now);
    return { state: 'closed', label: next ? `Closed · ${next}` : 'Closed', acceptingOrders: false, todayHours };
  }

  if (c.kind === 'mess') {
    return { state: 'open', label: current ? `Serving · until ${closesLabel(current.end)}` : 'Serving', acceptingOrders: false, todayHours };
  }

  const fresh = c.last_heartbeat_at !== null && now - c.last_heartbeat_at <= heartbeatStaleMs;
  if (!fresh) {
    return { state: 'unconfirmed', label: 'Status unconfirmed', acceptingOrders: false, todayHours };
  }

  const label = current ? `Open · closes ${closesLabel(current.end)}` : 'Open';
  return { state: 'open', label, acceptingOrders: c.accepts_orders === 1, todayHours };
}
