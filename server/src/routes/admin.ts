import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.ts';
import { all, get, run, tx } from '../db.ts';
import { broadcastCanteen, broadcastMenu, getCanteen, menuView } from '../domain/canteens.ts';
import { HttpError, type CanteenRow, type HoursRow, type UserRow } from '../domain/types.ts';
import { isValidHm, istDayStart, parseHm } from '../lib/time.ts';
import { hashDeviceKey, newDeviceKey } from './sensors.ts';
import { publicUser } from './auth.ts';
import { latencySummary } from '../domain/latency.ts';

export const adminRouter = Router();

// Every admin route requires the admin role.
adminRouter.use((req, _res, next) => {
  requireRole(req, 'admin');
  next();
});

const canteenFields = z.object({
  name: z.string().trim().min(2).max(60),
  location: z.string().trim().max(80).default(''),
  orderPrefix: z.string().trim().regex(/^[A-Z]{1,2}$/, 'One or two capital letters'),
  seats: z.number().int().min(1).max(2000).default(60),
  shelfCount: z.number().int().min(1).max(99).default(12),
  slotMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]).default(10),
  throughputPer10Min: z.number().int().min(1).max(500).default(20),
  capacityFactor: z.number().min(0.3).max(1).default(0.85),
  kind: z.enum(['canteen', 'mess']).default('canteen'),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lon: z.number().min(-180).max(180).nullable().default(null),
  acceptsOrders: z.boolean().default(true),
  sort: z.number().int().default(0),
});

function adminCanteen(c: CanteenRow) {
  return {
    id: c.id,
    name: c.name,
    location: c.location,
    orderPrefix: c.order_prefix,
    seats: c.seats,
    shelfCount: c.shelf_count,
    slotMinutes: c.slot_minutes,
    throughputPer10Min: c.throughput_per_10min,
    capacityFactor: c.capacity_factor,
    kind: c.kind,
    lat: c.lat,
    lon: c.lon,
    acceptsOrders: c.accepts_orders === 1,
    sort: c.sort,
    manualStatus: c.manual_status,
    lastHeartbeatAt: c.last_heartbeat_at,
    calibratedAt: c.calibrated_at,
    hours: all<HoursRow>('SELECT * FROM canteen_hours WHERE canteen_id = ? ORDER BY weekday, open_time', c.id).map((h) => ({
      weekday: h.weekday,
      open: h.open_time,
      close: h.close_time,
    })),
    sensors: all<{ id: number; label: string; last_seen_at: number | null }>(
      'SELECT id, label, last_seen_at FROM sensors WHERE canteen_id = ? ORDER BY id',
      c.id,
    ).map((s) => ({ id: s.id, label: s.label, lastSeenAt: s.last_seen_at })),
  };
}

adminRouter.get('/canteens', (_req, res) => {
  res.json({ canteens: all<CanteenRow>('SELECT * FROM canteens ORDER BY sort, name').map(adminCanteen) });
});

adminRouter.post('/canteens', (req, res) => {
  const body = canteenFields.extend({ id: z.string().regex(/^[a-z0-9-]{2,30}$/, 'Lower-case letters, digits and dashes') }).parse(req.body);
  if (get('SELECT id FROM canteens WHERE id = ?', body.id)) throw new HttpError(409, 'exists', 'A canteen with that id already exists');
  run(
    `INSERT INTO canteens (id, name, location, order_prefix, seats, shelf_count, slot_minutes, throughput_per_10min, capacity_factor, kind, lat, lon, accepts_orders, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    body.id,
    body.name,
    body.location,
    body.orderPrefix,
    body.seats,
    body.shelfCount,
    body.slotMinutes,
    body.throughputPer10Min,
    body.capacityFactor,
    body.kind,
    body.lat,
    body.lon,
    body.acceptsOrders ? 1 : 0,
    body.sort,
    Date.now(),
  );
  broadcastCanteen(body.id);
  res.status(201).json({ canteen: adminCanteen(getCanteen(body.id)) });
});

adminRouter.patch('/canteens/:id', (req, res) => {
  const c = getCanteen(req.params.id);
  const b = canteenFields.partial().parse(req.body);
  run(
    `UPDATE canteens SET name = ?, location = ?, order_prefix = ?, seats = ?, shelf_count = ?, slot_minutes = ?, throughput_per_10min = ?,
       capacity_factor = ?, kind = ?, lat = ?, lon = ?, accepts_orders = ?, sort = ? WHERE id = ?`,
    b.name ?? c.name,
    b.location ?? c.location,
    b.orderPrefix ?? c.order_prefix,
    b.seats ?? c.seats,
    b.shelfCount ?? c.shelf_count,
    b.slotMinutes ?? c.slot_minutes,
    b.throughputPer10Min ?? c.throughput_per_10min,
    b.capacityFactor ?? c.capacity_factor,
    b.kind ?? c.kind,
    b.lat === undefined ? c.lat : b.lat,
    b.lon === undefined ? c.lon : b.lon,
    b.acceptsOrders === undefined ? c.accepts_orders : b.acceptsOrders ? 1 : 0,
    b.sort ?? c.sort,
    c.id,
  );
  broadcastCanteen(c.id);
  res.json({ canteen: adminCanteen(getCanteen(c.id)) });
});

adminRouter.put('/canteens/:id/hours', (req, res) => {
  const c = getCanteen(req.params.id);
  const hm = z.string().refine(isValidHm, 'Use HH:MM');
  const { hours } = z
    .object({
      hours: z
        .array(
          z
            .object({ weekday: z.number().int().min(0).max(6), open: hm, close: hm })
            .refine((h) => { const o = parseHm(h.open), c = parseHm(h.close); return c !== o && (c % 1440 !== o || c === 1440); }, 'Opening and closing times must differ (a closing time before the opening time means past midnight)'),
        )
        .max(28)
        .refine((list) => new Set(list.map((h) => `${h.weekday} ${h.open}`)).size === list.length, 'Two windows on the same day start at the same time'),
    })
    .parse(req.body);
  tx(() => {
    run('DELETE FROM canteen_hours WHERE canteen_id = ?', c.id);
    for (const h of hours) run('INSERT INTO canteen_hours (canteen_id, weekday, open_time, close_time) VALUES (?, ?, ?, ?)', c.id, h.weekday, h.open, h.close);
  });
  broadcastCanteen(c.id);
  res.json({ canteen: adminCanteen(getCanteen(c.id)) });
});

const itemFields = z.object({
  name: z.string().trim().min(2).max(60),
  category: z.string().trim().min(1).max(30).default('Main'),
  pricePaise: z.number().int().min(0).max(1_000_000),
  veg: z.boolean().default(true),
  available: z.boolean().default(true),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});

adminRouter.get('/canteens/:id/menu', (req, res) => {
  const c = getCanteen(req.params.id);
  res.json({ menu: menuView(c.id, true) });
});

adminRouter.post('/canteens/:id/menu', (req, res) => {
  const c = getCanteen(req.params.id);
  const b = itemFields.parse(req.body);
  run(
    'INSERT INTO menu_items (canteen_id, name, category, price_paise, veg, available, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    c.id,
    b.name,
    b.category,
    b.pricePaise,
    b.veg ? 1 : 0,
    b.available ? 1 : 0,
    b.active ? 1 : 0,
    b.sort,
  );
  broadcastMenu(c.id);
  res.status(201).json({ menu: menuView(c.id, true) });
});

adminRouter.patch('/menu/:itemId', (req, res) => {
  const item = get<{ id: number; canteen_id: string; name: string; category: string; price_paise: number; veg: number; available: number; active: number; sort: number }>(
    'SELECT * FROM menu_items WHERE id = ?',
    Number(req.params.itemId),
  );
  if (!item) throw new HttpError(404, 'not_found', 'Menu item not found');
  const b = itemFields.partial().parse(req.body);
  const flag = (v: boolean | undefined, old: number) => (v === undefined ? old : v ? 1 : 0);
  run(
    'UPDATE menu_items SET name = ?, category = ?, price_paise = ?, veg = ?, available = ?, active = ?, sort = ? WHERE id = ?',
    b.name ?? item.name,
    b.category ?? item.category,
    b.pricePaise ?? item.price_paise,
    flag(b.veg, item.veg),
    flag(b.available, item.available),
    flag(b.active, item.active),
    b.sort ?? item.sort,
    item.id,
  );
  broadcastMenu(item.canteen_id);
  res.json({ menu: menuView(item.canteen_id, true) });
});

adminRouter.get('/users', (req, res) => {
  const q = typeof req.query.q === 'string' ? `%${req.query.q.toLowerCase()}%` : '%';
  const users = all<UserRow>(
    "SELECT * FROM users WHERE lower(email) LIKE ? OR lower(name) LIKE ? ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END, email LIMIT 100",
    q,
    q,
  );
  res.json({ users: users.map(publicUser) });
});

adminRouter.patch('/users/:id', (req, res) => {
  const body = z.object({ role: z.enum(['student', 'staff', 'admin']), canteenId: z.string().nullable().default(null) }).parse(req.body);
  if (body.role === 'staff') {
    if (!body.canteenId) throw new HttpError(400, 'canteen_required', 'Choose which canteen this staff member works at');
    getCanteen(body.canteenId);
  }
  if (req.user && Number(req.params.id) === req.user.id && body.role !== 'admin') {
    throw new HttpError(400, 'self_demote', 'You cannot remove your own admin access');
  }
  const r = run('UPDATE users SET role = ?, canteen_id = ? WHERE id = ?', body.role, body.role === 'staff' ? body.canteenId : null, Number(req.params.id));
  if (r.changes === 0) throw new HttpError(404, 'not_found', 'User not found');
  res.json({ user: publicUser(get<UserRow>('SELECT * FROM users WHERE id = ?', Number(req.params.id))!) });
});

/** Creates a door-counter key. It is shown once; only its hash is stored. */
adminRouter.post('/canteens/:id/sensors', (req, res) => {
  const c = getCanteen(req.params.id);
  const { label } = z.object({ label: z.string().trim().min(1).max(40).default('Door counter') }).parse(req.body ?? {});
  const key = newDeviceKey();
  const { id } = run('INSERT INTO sensors (canteen_id, label, key_hash, created_at) VALUES (?, ?, ?, ?)', c.id, label, hashDeviceKey(key), Date.now());
  res.status(201).json({ sensor: { id, label }, key });
});

adminRouter.delete('/sensors/:id', (req, res) => {
  run('DELETE FROM sensors WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

/**
 * Trial metrics from the brief's Build-Measure-Learn plan: on-time rate, repeat rate,
 * volume, ratings and cancellations, per day and in total.
 */
adminRouter.get('/metrics', (req, res) => {
  const days = z.coerce.number().int().min(1).max(90).default(14).parse(req.query.days);
  const canteenId = typeof req.query.canteenId === 'string' && req.query.canteenId ? req.query.canteenId : null;
  const since = istDayStart(Date.now()) - (days - 1) * 86_400_000;
  const where = `created_at >= ? AND paid_at IS NOT NULL ${canteenId ? 'AND canteen_id = ?' : ''}`;
  const params = canteenId ? [since, canteenId] : [since];

  const rows = all<{
    id: number;
    user_id: number;
    status: string;
    slot_start: number;
    created_at: number;
    cooking_at: number | null;
    ready_at: number | null;
    total_paise: number;
  }>(`SELECT id, user_id, status, slot_start, created_at, cooking_at, ready_at, total_paise FROM orders WHERE ${where} ORDER BY created_at`, ...params);

  const ON_TIME_MS = 3 * 60_000;
  const byDay = new Map<number, { orders: number; revenuePaise: number; readied: number; onTime: number }>();
  for (let d = 0; d < days; d++) byDay.set(since + d * 86_400_000, { orders: 0, revenuePaise: 0, readied: 0, onTime: 0 });
  let readied = 0;
  let onTime = 0;
  let cancelled = 0;
  const prep: number[] = [];
  for (const o of rows) {
    const day = byDay.get(istDayStart(o.created_at));
    if (o.status === 'cancelled') {
      cancelled++;
      continue;
    }
    if (day) {
      day.orders++;
      day.revenuePaise += o.total_paise;
    }
    if (o.ready_at) {
      readied++;
      const late = o.ready_at - o.slot_start;
      if (late <= ON_TIME_MS) onTime++;
      if (day) {
        day.readied++;
        if (late <= ON_TIME_MS) day.onTime++;
      }
      if (o.cooking_at) prep.push((o.ready_at - o.cooking_at) / 60_000);
    }
  }

  // 7-day repeat: of students whose first order in the window is at least 7 days old, how many ordered again within 7 days.
  const firstOrder = new Map<number, number>();
  const userOrders = new Map<number, number[]>();
  for (const o of rows) {
    if (o.status === 'cancelled') continue;
    if (!firstOrder.has(o.user_id)) firstOrder.set(o.user_id, o.created_at);
    userOrders.set(o.user_id, [...(userOrders.get(o.user_id) ?? []), o.created_at]);
  }
  let eligible = 0;
  let repeated = 0;
  const cutoff = Date.now() - 7 * 86_400_000;
  for (const [uid, first] of firstOrder) {
    if (first > cutoff) continue;
    eligible++;
    if ((userOrders.get(uid) ?? []).some((t) => t > first && t - first <= 7 * 86_400_000)) repeated++;
  }

  const rating = get<{ avg: number | null; n: number }>(
    `SELECT AVG(r.rating) AS avg, COUNT(*) AS n FROM reviews r JOIN orders o ON o.id = r.order_id WHERE r.created_at >= ? ${canteenId ? 'AND o.canteen_id = ?' : ''}`,
    ...params,
  );
  const topItems = all<{ name: string; qty: number; rating: number | null }>(
    `SELECT oi.name, SUM(oi.qty) AS qty,
            (SELECT AVG(rating) FROM reviews WHERE menu_item_id = oi.menu_item_id) AS rating
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= ? AND o.paid_at IS NOT NULL ${canteenId ? 'AND o.canteen_id = ?' : ''} AND o.status != 'cancelled'
      GROUP BY oi.menu_item_id ORDER BY qty DESC LIMIT 8`,
    ...params,
  );

  const median = (xs: number[]) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    return Math.round(s[Math.floor(s.length / 2)] * 10) / 10;
  };

  const total = rows.length - cancelled;
  res.json({
    days,
    canteenId,
    totals: {
      orders: total,
      revenuePaise: rows.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total_paise, 0),
      uniqueStudents: firstOrder.size,
      onTimeRate: readied ? onTime / readied : null,
      repeatRate7d: eligible ? repeated / eligible : null,
      repeatEligible: eligible,
      cancelRate: rows.length ? cancelled / rows.length : null,
      medianPrepMinutes: median(prep),
      statusUpdate: latencySummary(since, canteenId),
      avgRating: rating?.avg ? Math.round(rating.avg * 10) / 10 : null,
      ratings: rating?.n ?? 0,
    },
    byDay: [...byDay.entries()].map(([day, d]) => ({ day, ...d, onTimeRate: d.readied ? d.onTime / d.readied : null })),
    topItems: topItems.map((t) => ({ name: t.name, qty: t.qty, rating: t.rating === null ? null : Math.round(t.rating * 10) / 10 })),
    thresholds: { onTimeRate: { keepGoing: 0.85, changeDirection: 0.7 }, repeatRate7d: { keepGoing: 0.4, changeDirection: 0.2 } },
  });
});
