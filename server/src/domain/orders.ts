import { all, get, run, tx } from '../db.ts';
import { config } from '../config.ts';
import { publish } from '../events.ts';
import { sendPush } from '../notify/push.ts';
import { broadcastCanteen, canteenStatus, getCanteen, slotsFor } from './canteens.ts';
import { queueWaitMinutes } from './crowd.ts';
import { HttpError, type MenuItemRow, type OrderItemRow, type OrderRow, type OrderStatus } from './types.ts';
import { hmOf, istDayStart } from '../lib/time.ts';

export interface OrderView {
  id: number;
  code: string;
  canteen: { id: string; name: string };
  status: OrderStatus;
  slotStart: number;
  slotLabel: string;
  items: { menuItemId: number; name: string; qty: number; unitPricePaise: number }[];
  subtotalPaise: number;
  feePaise: number;
  totalPaise: number;
  shelf: number | null;
  etaAt: number | null;
  createdAt: number;
  paidAt: number | null;
  cookingAt: number | null;
  readyAt: number | null;
  collectedAt: number | null;
  cancelReason: string | null;
  refundStatus: string | null;
  reviewed: boolean;
  customerName?: string;
}

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['cancelled', 'expired'],
  placed: ['cooking', 'ready', 'cancelled'],
  cooking: ['ready', 'cancelled'],
  ready: ['collected'],
  collected: [],
  cancelled: [],
  expired: [],
};

export function getOrder(id: number): OrderRow {
  const o = get<OrderRow>('SELECT * FROM orders WHERE id = ?', id);
  if (!o) throw new HttpError(404, 'not_found', 'Order not found');
  return o;
}

function itemsOf(orderId: number): OrderItemRow[] {
  return all<OrderItemRow>('SELECT * FROM order_items WHERE order_id = ? ORDER BY name', orderId);
}

/** When this order should be ready, given the kitchen queue ahead of it. */
export function estimateReady(o: OrderRow, now = Date.now()): number | null {
  if (o.status === 'ready' || o.status === 'collected') return o.ready_at;
  if (o.status !== 'placed' && o.status !== 'cooking') return null;
  const c = getCanteen(o.canteen_id);
  const ahead =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM orders WHERE canteen_id = ? AND status IN ('placed', 'cooking')
        AND (slot_start < ? OR (slot_start = ? AND id < ?))`,
      o.canteen_id,
      o.slot_start,
      o.slot_start,
      o.id,
    )?.n ?? 0;
  const queueReady = now + queueWaitMinutes(ahead, c.throughput_per_10min) * 60_000;
  return Math.max(o.slot_start, queueReady);
}

export function orderView(o: OrderRow, opts: { withCustomer?: boolean } = {}): OrderView {
  const c = getCanteen(o.canteen_id);
  const reviewed = !!get<{ id: number }>('SELECT id FROM reviews WHERE order_id = ? LIMIT 1', o.id);
  const view: OrderView = {
    id: o.id,
    code: o.code,
    canteen: { id: c.id, name: c.name },
    status: o.status,
    slotStart: o.slot_start,
    slotLabel: hmOf(o.slot_start),
    items: itemsOf(o.id).map((i) => ({ menuItemId: i.menu_item_id, name: i.name, qty: i.qty, unitPricePaise: i.unit_price_paise })),
    subtotalPaise: o.subtotal_paise,
    feePaise: o.fee_paise,
    totalPaise: o.total_paise,
    shelf: o.shelf,
    etaAt: estimateReady(o),
    createdAt: o.created_at,
    paidAt: o.paid_at,
    cookingAt: o.cooking_at,
    readyAt: o.ready_at,
    collectedAt: o.collected_at,
    cancelReason: o.cancel_reason,
    refundStatus: o.refund_status,
    reviewed,
  };
  if (opts.withCustomer) {
    const u = get<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = ?', o.user_id);
    view.customerName = u?.name || u?.email.split('@')[0] || '';
  }
  return view;
}

export function boardView(canteenId: string) {
  const rows = all<OrderRow>(
    `SELECT * FROM orders WHERE canteen_id = ? AND status IN ('placed', 'cooking', 'ready')
      ORDER BY CASE status WHEN 'ready' THEN 0 ELSE 1 END, slot_start, id`,
    canteenId,
  );
  return {
    canteenId,
    preparing: rows.filter((o) => o.status !== 'ready').map((o) => ({ code: o.code, slot: hmOf(o.slot_start), etaAt: estimateReady(o) })),
    ready: rows.filter((o) => o.status === 'ready').map((o) => ({ code: o.code, shelf: o.shelf })),
  };
}

/** Push the change to the student, the kitchen, the pickup board and the crowd meter. */
export function announce(o: OrderRow): void {
  publish(`user:${o.user_id}`, 'order', orderView(o));
  publish(`kitchen:${o.canteen_id}`, 'order', orderView(o, { withCustomer: true }));
  publish(`board:${o.canteen_id}`, 'board', boardView(o.canteen_id));
  broadcastCanteen(o.canteen_id);
}

function nextCode(canteenId: string, prefix: string, now: number): string {
  const n =
    get<{ n: number }>('SELECT COUNT(*) AS n FROM orders WHERE canteen_id = ? AND created_at >= ?', canteenId, istDayStart(now))?.n ?? 0;
  return `${prefix}-${String(n + 1).padStart(2, '0')}`;
}

export interface NewOrderInput {
  userId: number;
  canteenId: string;
  slotStart: number;
  items: { menuItemId: number; qty: number }[];
}

/** Validates everything server-side and holds a slot while the student pays. */
export function createOrder(input: NewOrderInput, now = Date.now()): OrderRow {
  return tx(() => {
    const c = getCanteen(input.canteenId);
    const status = canteenStatus(c, now);
    if (!status.acceptingOrders) throw new HttpError(409, 'canteen_closed', `${c.name} is not taking orders right now`);

    const open = get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status IN ('pending_payment', 'placed', 'cooking', 'ready')",
      input.userId,
    )?.n ?? 0;
    if (open >= 3) throw new HttpError(429, 'too_many_orders', 'You already have 3 open orders. Collect one first.');

    const slot = slotsFor(c, now).find((s) => s.start === input.slotStart);
    if (!slot) throw new HttpError(409, 'slot_invalid', 'That pickup time is no longer available');
    if (slot.full) throw new HttpError(409, 'slot_full', 'That pickup time just filled up. Please pick another.');

    const merged = new Map<number, number>();
    for (const it of input.items) merged.set(it.menuItemId, (merged.get(it.menuItemId) ?? 0) + it.qty);
    if (merged.size === 0) throw new HttpError(400, 'empty', 'Your order is empty');
    const totalQty = [...merged.values()].reduce((a, b) => a + b, 0);
    if (totalQty > 20) throw new HttpError(400, 'too_large', 'Orders are limited to 20 items');

    const lines: { item: MenuItemRow; qty: number }[] = [];
    for (const [id, qty] of merged) {
      const item = get<MenuItemRow>('SELECT * FROM menu_items WHERE id = ? AND canteen_id = ?', id, c.id);
      if (!item || item.active !== 1) throw new HttpError(400, 'item_invalid', 'An item in your order is no longer on the menu');
      if (item.available !== 1) throw new HttpError(409, 'sold_out', `${item.name} just sold out`);
      lines.push({ item, qty });
    }

    const subtotal = lines.reduce((sum, l) => sum + l.item.price_paise * l.qty, 0);
    const fee = config.payment.feePaise;
    const code = nextCode(c.id, c.order_prefix, now);
    const { id } = run(
      `INSERT INTO orders (canteen_id, user_id, code, slot_start, status, subtotal_paise, fee_paise, total_paise, payment_provider, created_at)
       VALUES (?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?)`,
      c.id,
      input.userId,
      code,
      slot.start,
      subtotal,
      fee,
      subtotal + fee,
      config.payment.provider,
      now,
    );
    for (const l of lines) {
      run(
        'INSERT INTO order_items (order_id, menu_item_id, name, unit_price_paise, qty) VALUES (?, ?, ?, ?, ?)',
        id,
        l.item.id,
        l.item.name,
        l.item.price_paise,
        l.qty,
      );
    }
    return getOrder(id);
  });
}

/** Payment confirmed. Idempotent: webhooks and the client may both report it. */
export function markPaid(orderId: number, paymentId: string, now = Date.now()): OrderRow {
  const o = tx(() => {
    const o = getOrder(orderId);
    if (o.status !== 'pending_payment' && o.status !== 'expired') return o;
    // A payment that lands after the hold expired is honoured rather than lost.
    run("UPDATE orders SET status = 'placed', paid_at = ?, payment_id = ? WHERE id = ?", now, paymentId, orderId);
    return getOrder(orderId);
  });
  announce(o);
  return o;
}

export function transition(orderId: number, to: OrderStatus, opts: { reason?: string; now?: number } = {}): OrderRow {
  const now = opts.now ?? Date.now();
  const o = tx(() => {
    const o = getOrder(orderId);
    if (!TRANSITIONS[o.status].includes(to)) {
      throw new HttpError(409, 'bad_transition', `Order ${o.code} is ${o.status.replace('_', ' ')} and cannot become ${to}`);
    }
    if (to === 'cooking') run("UPDATE orders SET status = 'cooking', cooking_at = ? WHERE id = ?", now, orderId);
    if (to === 'ready') {
      const c = getCanteen(o.canteen_id);
      const used = new Set(
        all<{ shelf: number }>("SELECT shelf FROM orders WHERE canteen_id = ? AND status = 'ready' AND shelf IS NOT NULL", o.canteen_id).map(
          (r) => r.shelf,
        ),
      );
      let shelf: number | null = null;
      for (let s = 1; s <= c.shelf_count; s++) {
        if (!used.has(s)) {
          shelf = s;
          break;
        }
      }
      run(
        "UPDATE orders SET status = 'ready', ready_at = ?, cooking_at = COALESCE(cooking_at, ?), shelf = ?, last_reminder_at = ? WHERE id = ?",
        now,
        now,
        shelf,
        now,
        orderId,
      );
    }
    if (to === 'collected') run("UPDATE orders SET status = 'collected', collected_at = ? WHERE id = ?", now, orderId);
    if (to === 'expired') run("UPDATE orders SET status = 'expired' WHERE id = ?", orderId);
    if (to === 'cancelled') {
      const refund = o.paid_at ? 'due' : null;
      run("UPDATE orders SET status = 'cancelled', cancel_reason = ?, refund_status = ? WHERE id = ?", opts.reason ?? null, refund, orderId);
    }
    return getOrder(orderId);
  });

  announce(o);
  if (to === 'ready') {
    const where = o.shelf ? `Shelf ${o.shelf}` : 'the counter';
    void sendPush(o.user_id, {
      title: 'Your food is ready',
      body: `Collect from ${where} at ${getCanteen(o.canteen_id).name} with code ${o.code}.`,
      url: `/orders/${o.id}`,
      tag: `order-${o.id}`,
    });
  }
  if (to === 'cancelled') {
    void sendPush(o.user_id, {
      title: `Order ${o.code} was cancelled`,
      body: o.refund_status === 'due' ? `${opts.reason ?? 'The canteen cancelled it'}. Your refund is on its way.` : opts.reason ?? 'Cancelled',
      url: `/orders/${o.id}`,
      tag: `order-${o.id}`,
    });
  }
  return o;
}

export function setPaymentRef(orderId: number, ref: string): void {
  run('UPDATE orders SET payment_ref = ? WHERE id = ?', ref, orderId);
}

export function setRefundStatus(orderId: number, status: 'refunded' | 'failed'): void {
  run('UPDATE orders SET refund_status = ? WHERE id = ?', status, orderId);
}

export interface ReviewInput {
  menuItemId: number;
  rating: number;
  comment?: string;
}

export function addReviews(orderId: number, userId: number, reviews: ReviewInput[], now = Date.now()): void {
  tx(() => {
    const o = getOrder(orderId);
    if (o.user_id !== userId) throw new HttpError(403, 'forbidden', 'Not your order');
    if (o.status !== 'collected') throw new HttpError(409, 'not_collected', 'You can rate an order after you collect it');
    const ids = new Set(itemsOf(orderId).map((i) => i.menu_item_id));
    for (const r of reviews) {
      if (!ids.has(r.menuItemId)) throw new HttpError(400, 'item_invalid', 'You can only rate dishes in this order');
      run(
        `INSERT INTO reviews (order_id, menu_item_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (order_id, menu_item_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment`,
        orderId,
        r.menuItemId,
        userId,
        r.rating,
        (r.comment ?? '').slice(0, 500),
        now,
      );
    }
  });
}
