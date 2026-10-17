import { all, get } from '../db.ts';
import { config } from '../config.ts';
import { publish } from '../events.ts';
import { computeStatus, type CanteenStatus } from './status.ts';
import { computeCrowd, type Crowd } from './crowd.ts';
import { listSlots, slotCapacity, type Slot } from './slots.ts';
import type { StatusChange } from './latency.ts';
import { HttpError, type CanteenRow, type HoursRow, type MenuItemRow } from './types.ts';

export interface CanteenView {
  id: string;
  name: string;
  location: string;
  kind: 'canteen' | 'mess';
  lat: number | null;
  lon: number | null;
  /** Opens the spot in Google Maps (directions on phones). */
  mapsUrl: string | null;
  status: CanteenStatus;
  crowd: Crowd;
  slotMinutes: number;
  slotCapacity: number;
  hours: { weekday: number; open: string; close: string }[];
}

export interface MenuItemView {
  id: number;
  name: string;
  category: string;
  pricePaise: number;
  veg: boolean;
  available: boolean;
  active: boolean;
  rating: number | null;
  ratingCount: number;
}

export function getCanteen(id: string): CanteenRow {
  const c = get<CanteenRow>('SELECT * FROM canteens WHERE id = ?', id);
  if (!c) throw new HttpError(404, 'not_found', 'Canteen not found');
  return c;
}

export function getHours(id: string): HoursRow[] {
  return all<HoursRow>('SELECT * FROM canteen_hours WHERE canteen_id = ? ORDER BY weekday, open_time', id);
}

export function queuedOrders(canteenId: string): number {
  const r = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM orders WHERE canteen_id = ? AND status IN ('placed', 'cooking')",
    canteenId,
  );
  return r?.n ?? 0;
}

export function latestReading(canteenId: string): { people: number; measured_at: number } | null {
  return (
    get<{ people: number; measured_at: number }>(
      'SELECT people, measured_at FROM occupancy_readings WHERE canteen_id = ? ORDER BY measured_at DESC LIMIT 1',
      canteenId,
    ) ?? null
  );
}

export function canteenStatus(c: CanteenRow, now = Date.now()): CanteenStatus {
  return computeStatus(c, getHours(c.id), now, config.rules.heartbeatStaleMs);
}

export function canteenView(c: CanteenRow, now = Date.now()): CanteenView {
  const hours = getHours(c.id);
  return {
    id: c.id,
    name: c.name,
    location: c.location,
    kind: c.kind,
    lat: c.lat,
    lon: c.lon,
    mapsUrl: c.lat !== null && c.lon !== null ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}` : null,
    status: computeStatus(c, hours, now, config.rules.heartbeatStaleMs),
    crowd: computeCrowd({
      seats: c.seats,
      throughputPer10Min: c.throughput_per_10min,
      reading: latestReading(c.id),
      queuedOrders: queuedOrders(c.id),
      now,
      sensorFreshMs: config.rules.sensorFreshMs,
    }),
    slotMinutes: c.slot_minutes,
    slotCapacity: slotCapacity(c),
    hours: hours.map((h) => ({ weekday: h.weekday, open: h.open_time, close: h.close_time })),
  };
}

export function listCanteenViews(now = Date.now()): CanteenView[] {
  return all<CanteenRow>('SELECT * FROM canteens ORDER BY sort, name').map((c) => canteenView(c, now));
}

export function menuView(canteenId: string, includeInactive = false): MenuItemView[] {
  const rows = all<MenuItemRow & { rating: number | null; rating_count: number }>(
    `SELECT m.*, AVG(r.rating) AS rating, COUNT(r.id) AS rating_count
       FROM menu_items m LEFT JOIN reviews r ON r.menu_item_id = m.id
      WHERE m.canteen_id = ? ${includeInactive ? '' : 'AND m.active = 1'}
      GROUP BY m.id ORDER BY m.category, m.sort, m.name`,
    canteenId,
  );
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    category: m.category,
    pricePaise: m.price_paise,
    veg: m.veg === 1,
    available: m.available === 1,
    active: m.active === 1,
    rating: m.rating === null ? null : Math.round(m.rating * 10) / 10,
    ratingCount: m.rating_count,
  }));
}

/** Orders per slot start for today, counting unpaid holds. */
export function bookedBySlot(canteenId: string, now = Date.now()): Map<number, number> {
  const rows = all<{ slot_start: number; n: number }>(
    `SELECT slot_start, COUNT(*) AS n FROM orders
      WHERE canteen_id = ? AND slot_start >= ? AND status IN ('pending_payment', 'placed', 'cooking', 'ready', 'collected')
      GROUP BY slot_start`,
    canteenId,
    now - 12 * 3_600_000,
  );
  return new Map(rows.map((r) => [r.slot_start, r.n]));
}

export function slotsFor(c: CanteenRow, now = Date.now()): Slot[] {
  return listSlots({
    canteen: c,
    hours: getHours(c.id),
    now,
    booked: bookedBySlot(c.id, now),
    minLeadMinutes: config.rules.minLeadMinutes,
    count: config.rules.slotsAhead,
  });
}

/** Tell every open app that a canteen's status, crowd or menu changed. */
export function broadcastCanteen(canteenId: string, change?: StatusChange): void {
  const c = getCanteen(canteenId);
  publish('public', 'canteen', change ? { ...canteenView(c), change } : canteenView(c));
}

export function broadcastMenu(canteenId: string, change?: StatusChange): void {
  publish('public', 'menu', { canteenId, items: menuView(canteenId), change });
}
