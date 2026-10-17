import crypto from 'node:crypto';
import { config } from './config.ts';
import type { OrderRow, UserRow } from './domain/types.ts';

export type PaymentInit =
  | { provider: 'mock' }
  | {
      provider: 'razorpay';
      keyId: string;
      razorpayOrderId: string;
      amountPaise: number;
      currency: 'INR';
      name: string;
      description: string;
      prefill: { email: string; name: string };
    };

function razorpayAuth(): string {
  return 'Basic ' + Buffer.from(`${config.payment.razorpayKeyId}:${config.payment.razorpayKeySecret}`).toString('base64');
}

async function razorpay<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: 'POST',
    headers: { Authorization: razorpayAuth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Razorpay ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Starts payment for an order. Returns what the app needs to open the payment sheet. */
export async function initPayment(order: OrderRow, user: UserRow, canteenName: string): Promise<{ init: PaymentInit; ref: string | null }> {
  if (config.payment.provider === 'mock') return { init: { provider: 'mock' }, ref: null };

  const rz = await razorpay<{ id: string }>('/orders', {
    amount: order.total_paise,
    currency: 'INR',
    receipt: `campusbite_${order.id}`,
    notes: { order_id: String(order.id), code: order.code },
  });
  return {
    ref: rz.id,
    init: {
      provider: 'razorpay',
      keyId: config.payment.razorpayKeyId,
      razorpayOrderId: rz.id,
      amountPaise: order.total_paise,
      currency: 'INR',
      name: 'CampusBite',
      description: `${canteenName} · order ${order.code}`,
      prefill: { email: user.email, name: user.name },
    },
  };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Checks the signature Razorpay Checkout returns to the app after payment. */
export function verifyCheckoutSignature(razorpayOrderId: string, paymentId: string, signature: string): boolean {
  const expected = crypto.createHmac('sha256', config.payment.razorpayKeySecret).update(`${razorpayOrderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

/** Checks a server-to-server webhook from Razorpay. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  if (!config.payment.razorpayWebhookSecret) return false;
  const expected = crypto.createHmac('sha256', config.payment.razorpayWebhookSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

/** Refunds a cancelled, paid order in full. */
export async function refund(order: OrderRow): Promise<boolean> {
  if (config.payment.provider === 'mock' || order.payment_provider === 'mock') return true;
  if (!order.payment_id) return false;
  try {
    await razorpay(`/payments/${order.payment_id}/refund`, { amount: order.total_paise, notes: { order_id: String(order.id) } });
    return true;
  } catch (err) {
    console.error('[payments] refund failed', err);
    return false;
  }
}
