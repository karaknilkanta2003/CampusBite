import express, { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.ts';
import { config } from '../config.ts';
import { all, get } from '../db.ts';
import { getCanteen } from '../domain/canteens.ts';
import { addReviews, createOrder, getOrder, markPaid, orderView, setPaymentRef, setRefundStatus, transition } from '../domain/orders.ts';
import { HttpError, type OrderRow } from '../domain/types.ts';
import { initPayment, refund, verifyCheckoutSignature, verifyWebhookSignature } from '../payments.ts';

export const ordersRouter = Router();

function ownOrder(orderId: number, userId: number): OrderRow {
  const o = getOrder(orderId);
  if (o.user_id !== userId) throw new HttpError(404, 'not_found', 'Order not found');
  return o;
}

const idParam = z.coerce.number().int().positive();

ordersRouter.post('/', async (req, res) => {
  const user = requireUser(req);
  const body = z
    .object({
      canteenId: z.string().min(1),
      slotStart: z.number().int(),
      items: z.array(z.object({ menuItemId: z.number().int().positive(), qty: z.number().int().min(1).max(10) })).min(1).max(30),
    })
    .parse(req.body);

  const order = createOrder({ userId: user.id, canteenId: body.canteenId, slotStart: body.slotStart, items: body.items });
  try {
    const { init, ref } = await initPayment(order, user, getCanteen(order.canteen_id).name);
    if (ref) setPaymentRef(order.id, ref);
    res.status(201).json({ order: orderView(getOrder(order.id)), payment: init });
  } catch (err) {
    console.error('[orders] payment init failed', err);
    transition(order.id, 'expired');
    throw new HttpError(502, 'payment_unavailable', 'Payments are not reachable right now. Please try again.');
  }
});

ordersRouter.get('/', (req, res) => {
  const user = requireUser(req);
  const rows = all<OrderRow>(
    "SELECT * FROM orders WHERE user_id = ? AND status != 'expired' ORDER BY created_at DESC LIMIT 50",
    user.id,
  );
  res.json({ orders: rows.map((o) => orderView(o)) });
});

ordersRouter.get('/:id', (req, res) => {
  const user = requireUser(req);
  res.json({ order: orderView(ownOrder(idParam.parse(req.params.id), user.id)) });
});

// Development and demo only: completes payment without a gateway.
ordersRouter.post('/:id/pay/mock', (req, res) => {
  const user = requireUser(req);
  if (config.payment.provider !== 'mock') throw new HttpError(404, 'not_found', 'Not available');
  const o = ownOrder(idParam.parse(req.params.id), user.id);
  res.json({ order: orderView(markPaid(o.id, `mock_${o.id}_${Date.now()}`)) });
});

ordersRouter.post('/:id/pay/razorpay', (req, res) => {
  const user = requireUser(req);
  const o = ownOrder(idParam.parse(req.params.id), user.id);
  const body = z
    .object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() })
    .parse(req.body);
  if (body.razorpay_order_id !== o.payment_ref || !verifyCheckoutSignature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)) {
    throw new HttpError(400, 'bad_signature', 'Payment could not be verified');
  }
  res.json({ order: orderView(markPaid(o.id, body.razorpay_payment_id)) });
});

/** Students may cancel before the kitchen starts cooking; paid orders are refunded. */
ordersRouter.post('/:id/cancel', async (req, res) => {
  const user = requireUser(req);
  const o = ownOrder(idParam.parse(req.params.id), user.id);
  if (o.status !== 'pending_payment' && o.status !== 'placed') {
    throw new HttpError(409, 'too_late', 'The kitchen has started this order, so it can no longer be cancelled');
  }
  const cancelled = transition(o.id, 'cancelled', { reason: 'Cancelled by you' });
  if (cancelled.refund_status === 'due') setRefundStatus(o.id, (await refund(cancelled)) ? 'refunded' : 'failed');
  res.json({ order: orderView(getOrder(o.id)) });
});

ordersRouter.post('/:id/reviews', (req, res) => {
  const user = requireUser(req);
  const id = idParam.parse(req.params.id);
  const { reviews } = z
    .object({
      reviews: z
        .array(z.object({ menuItemId: z.number().int(), rating: z.number().int().min(1).max(5), comment: z.string().max(500).optional() }))
        .min(1),
    })
    .parse(req.body);
  addReviews(id, user.id, reviews);
  res.json({ order: orderView(getOrder(id)) });
});

/** Razorpay calls this server-to-server, so payment is recorded even if the app closes mid-payment. */
export const razorpayWebhook = Router();
razorpayWebhook.post('/', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  const signature = req.header('x-razorpay-signature') ?? '';
  if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, signature)) {
    res.status(400).json({ error: { code: 'bad_signature', message: 'Invalid signature' } });
    return;
  }
  const event = JSON.parse(req.body.toString('utf8')) as {
    event: string;
    payload?: { payment?: { entity?: { id: string; order_id: string } } };
  };
  const payment = event.payload?.payment?.entity;
  if ((event.event === 'payment.captured' || event.event === 'order.paid') && payment) {
    const o = get<OrderRow>('SELECT * FROM orders WHERE payment_ref = ?', payment.order_id);
    if (o) markPaid(o.id, payment.id);
  }
  res.json({ ok: true });
});
