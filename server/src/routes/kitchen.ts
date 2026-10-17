import { Router } from 'express';
import { z } from 'zod';
import { requireKitchen } from '../auth.ts';
import { all, get, run } from '../db.ts';
import { broadcastCanteen, broadcastMenu, canteenView, getCanteen, menuView, slotsFor } from '../domain/canteens.ts';
import { getOrder, orderView, setRefundStatus, transition } from '../domain/orders.ts';
import { HttpError, type OrderRow } from '../domain/types.ts';
import { istDayStart } from '../lib/time.ts';
import { refund } from '../payments.ts';
import { stampChange } from '../domain/latency.ts';

export const kitchenRouter = Router();

kitchenRouter.get('/:canteenId', (req, res) => {
  const c = getCanteen(req.params.canteenId);
  requireKitchen(req, c.id);
  const now = Date.now();
  const active = all<OrderRow>(
    "SELECT * FROM orders WHERE canteen_id = ? AND status IN ('placed', 'cooking', 'ready') ORDER BY slot_start, id",
    c.id,
  );
  const doneToday = all<OrderRow>(
    "SELECT * FROM orders WHERE canteen_id = ? AND status IN ('collected', 'cancelled') AND created_at >= ? ORDER BY id DESC LIMIT 30",
    c.id,
    istDayStart(now),
  );
  res.json({
    canteen: canteenView(c, now),
    manualStatus: c.manual_status,
    orders: active.map((o) => orderView(o, { withCustomer: true })),
    recent: doneToday.map((o) => orderView(o, { withCustomer: true })),
    menu: menuView(c.id),
    slots: slotsFor(c, now),
  });
});

/** The kitchen tablet calls this every 30 seconds. Without it, students see "Status unconfirmed". */
kitchenRouter.post('/:canteenId/heartbeat', (req, res) => {
  const c = getCanteen(req.params.canteenId);
  requireKitchen(req, c.id);
  const wasStale = canteenView(c).status.state === 'unconfirmed';
  run('UPDATE canteens SET last_heartbeat_at = ? WHERE id = ?', Date.now(), c.id);
  if (wasStale) broadcastCanteen(c.id);
  res.json({ ok: true });
});

kitchenRouter.post('/:canteenId/status', (req, res) => {
  const c = getCanteen(req.params.canteenId);
  requireKitchen(req, c.id);
  const { mode } = z.object({ mode: z.enum(['auto', 'open', 'closed']) }).parse(req.body);
  run('UPDATE canteens SET manual_status = ?, last_heartbeat_at = ? WHERE id = ?', mode, Date.now(), c.id);
  broadcastCanteen(c.id, stampChange(c.id, 'status'));
  res.json({ canteen: canteenView(getCanteen(c.id)), manualStatus: mode });
});

kitchenRouter.patch('/:canteenId/menu/:itemId', (req, res) => {
  const c = getCanteen(req.params.canteenId);
  requireKitchen(req, c.id);
  const { available } = z.object({ available: z.boolean() }).parse(req.body);
  const r = run('UPDATE menu_items SET available = ? WHERE id = ? AND canteen_id = ?', available ? 1 : 0, Number(req.params.itemId), c.id);
  if (r.changes === 0) throw new HttpError(404, 'not_found', 'Menu item not found');
  broadcastMenu(c.id, stampChange(c.id, 'menu'));
  res.json({ menu: menuView(c.id) });
});

kitchenRouter.post('/orders/:id/advance', (req, res) => {
  const o = getOrder(Number(req.params.id));
  requireKitchen(req, o.canteen_id);
  const { to } = z.object({ to: z.enum(['cooking', 'ready', 'collected']) }).parse(req.body);
  res.json({ order: orderView(transition(o.id, to), { withCustomer: true }) });
});

kitchenRouter.post('/orders/:id/cancel', async (req, res) => {
  const o = getOrder(Number(req.params.id));
  requireKitchen(req, o.canteen_id);
  const { reason } = z.object({ reason: z.string().trim().min(2).max(120) }).parse(req.body);
  const cancelled = transition(o.id, 'cancelled', { reason });
  if (cancelled.refund_status === 'due') setRefundStatus(o.id, (await refund(cancelled)) ? 'refunded' : 'failed');
  res.json({ order: orderView(getOrder(o.id), { withCustomer: true }) });
});

/** Look up an order by its pickup code, for the counter. */
kitchenRouter.get('/:canteenId/lookup/:code', (req, res) => {
  const c = getCanteen(req.params.canteenId);
  requireKitchen(req, c.id);
  const o = get<OrderRow>(
    'SELECT * FROM orders WHERE canteen_id = ? AND code = ? AND created_at >= ? ORDER BY id DESC LIMIT 1',
    c.id,
    req.params.code.toUpperCase(),
    istDayStart(Date.now()),
  );
  if (!o) throw new HttpError(404, 'not_found', 'No order with that code today');
  res.json({ order: orderView(o, { withCustomer: true }) });
});
