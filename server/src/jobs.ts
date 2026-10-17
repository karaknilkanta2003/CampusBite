import { all, run } from './db.ts';
import { config } from './config.ts';
import { hasSubscribers, publish } from './events.ts';
import { canteenView } from './domain/canteens.ts';
import { transition } from './domain/orders.ts';
import type { CanteenRow, OrderRow } from './domain/types.ts';
import { sendPush } from './notify/push.ts';

/** Releases slots held by orders that were never paid. */
export function expireUnpaid(now = Date.now()): number {
  const stale = all<{ id: number }>(
    "SELECT id FROM orders WHERE status = 'pending_payment' AND created_at < ?",
    now - config.rules.paymentHoldMs,
  );
  for (const o of stale) transition(o.id, 'expired', { now });
  return stale.length;
}

/** Reminds students every 2 minutes until they collect (QFD spec H5). */
export async function remindUncollected(now = Date.now()): Promise<number> {
  const due = all<OrderRow & { canteen_name: string }>(
    `SELECT o.*, c.name AS canteen_name FROM orders o JOIN canteens c ON c.id = o.canteen_id
      WHERE o.status = 'ready' AND o.reminders_sent < ? AND (o.last_reminder_at IS NULL OR o.last_reminder_at <= ?)`,
    config.rules.maxReminders,
    now - config.rules.reminderEveryMs,
  );
  for (const o of due) {
    run('UPDATE orders SET reminders_sent = reminders_sent + 1, last_reminder_at = ? WHERE id = ?', now, o.id);
    await sendPush(o.user_id, {
      title: `Reminder: ${o.code} is waiting`,
      body: `Your food is on ${o.shelf ? `Shelf ${o.shelf}` : 'the counter'} at ${o.canteen_name}.`,
      url: `/orders/${o.id}`,
      tag: `order-${o.id}`,
    });
  }
  return due.length;
}

const lastStatus = new Map<string, string>();
/** Pushes status changes caused by the clock: opening, closing, kitchen going quiet. */
export function broadcastStatusChanges(now = Date.now()): void {
  for (const c of all<CanteenRow>('SELECT * FROM canteens')) {
    const view = canteenView(c, now);
    const key = `${view.status.state}|${view.status.label}|${view.crowd.level}`;
    if (lastStatus.get(c.id) !== key) {
      lastStatus.set(c.id, key);
      publish('public', 'canteen', view);
    }
  }
}

/**
 * Re-measures each kitchen's real throughput once a week from the last 7 days:
 * the 90th-percentile number of orders it finished in a busy 10-minute window.
 * Slot capacity follows automatically (QFD spec H2: recalculated weekly from Accept-to-Ready timestamps).
 */
export function calibrateThroughput(now = Date.now()): void {
  const canteens = all<CanteenRow>('SELECT * FROM canteens WHERE calibrated_at IS NULL OR calibrated_at < ?', now - 7 * 86_400_000);
  for (const c of canteens) {
    const readies = all<{ ready_at: number }>(
      "SELECT ready_at FROM orders WHERE canteen_id = ? AND ready_at >= ? AND status IN ('ready', 'collected')",
      c.id,
      now - 7 * 86_400_000,
    );
    run('UPDATE canteens SET calibrated_at = ? WHERE id = ?', now, c.id);
    const buckets = new Map<number, number>();
    for (const r of readies) {
      const b = Math.floor(r.ready_at / 600_000);
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    const busy = [...buckets.values()].filter((n) => n >= 3).sort((a, b) => a - b);
    if (busy.length < 20) continue; // not enough evidence yet; keep the configured value
    const p90 = busy[Math.floor(busy.length * 0.9)];
    const next = Math.max(5, Math.round(p90));
    if (next !== c.throughput_per_10min) {
      console.log(`[calibrate] ${c.id}: throughput ${c.throughput_per_10min} -> ${next} orders / 10 min`);
      run('UPDATE canteens SET throughput_per_10min = ? WHERE id = ?', next, c.id);
    }
  }
}

/**
 * Demo only: stands in for kitchen staff at canteens with no kitchen screen open,
 * so the student flow works end to end on a laptop.
 */
export function demoAutopilot(now = Date.now()): void {
  for (const c of all<CanteenRow>('SELECT * FROM canteens')) {
    if (hasSubscribers(`kitchen:${c.id}`)) continue;
    run('UPDATE canteens SET last_heartbeat_at = ? WHERE id = ?', now, c.id);
    const orders = all<OrderRow>("SELECT * FROM orders WHERE canteen_id = ? AND status IN ('placed', 'cooking', 'ready')", c.id);
    for (const o of orders) {
      if (o.status === 'placed' && o.paid_at && now - o.paid_at > 15_000) transition(o.id, 'cooking', { now });
      else if (o.status === 'cooking' && o.cooking_at && now - o.cooking_at > 40_000) transition(o.id, 'ready', { now });
      else if (o.status === 'ready' && o.ready_at && now - o.ready_at > 10 * 60_000) transition(o.id, 'collected', { now });
    }
  }
}

export function startJobs(): void {
  const tick = async () => {
    try {
      if (config.demoAutopilot) demoAutopilot();
      expireUnpaid();
      await remindUncollected();
      broadcastStatusChanges();
    } catch (err) {
      console.error('[jobs] tick failed', err);
    }
  };
  setInterval(tick, 10_000).unref();
  setInterval(() => {
    try {
      calibrateThroughput();
    } catch (err) {
      console.error('[jobs] calibration failed', err);
    }
  }, 60 * 60_000).unref();
  void tick();
}
