import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { get, openDb, run } from '../src/db.ts';
import { slotsFor, getCanteen } from '../src/domain/canteens.ts';
import { addReviews, createOrder, getOrder, markPaid, transition } from '../src/domain/orders.ts';
import { expireUnpaid } from '../src/jobs.ts';
import { HttpError } from '../src/domain/types.ts';

let userId = 0;
let dosa = 0;
let samosa = 0;

before(() => {
  openDb(':memory:');
  const now = Date.now();
  run(
    `INSERT INTO canteens (id, name, order_prefix, throughput_per_10min, capacity_factor, manual_status, last_heartbeat_at, created_at)
     VALUES ('t', 'Test Canteen', 'T', 2, 1, 'open', ?, ?)`,
    now,
    now,
  );
  dosa = run("INSERT INTO menu_items (canteen_id, name, price_paise) VALUES ('t', 'Dosa', 5000)").id;
  samosa = run("INSERT INTO menu_items (canteen_id, name, price_paise, available) VALUES ('t', 'Samosa', 2000, 0)").id;
  userId = run("INSERT INTO users (email, created_at) VALUES ('a@iiit.ac.in', ?)", now).id;
});

function firstSlot() {
  return slotsFor(getCanteen('t'))[0];
}

test('full order lifecycle: hold, pay, cook, ready on a shelf, collect, rate', () => {
  const slot = firstSlot();
  const o = createOrder({ userId, canteenId: 't', slotStart: slot.start, items: [{ menuItemId: dosa, qty: 2 }] });
  assert.equal(o.status, 'pending_payment');
  assert.equal(o.code, 'T-01');
  assert.equal(o.subtotal_paise, 10_000);
  assert.equal(o.total_paise, 10_000 + o.fee_paise);

  assert.equal(markPaid(o.id, 'pay_1').status, 'placed');
  assert.equal(markPaid(o.id, 'pay_1').status, 'placed', 'idempotent');
  assert.equal(transition(o.id, 'cooking').status, 'cooking');
  const ready = transition(o.id, 'ready');
  assert.equal(ready.status, 'ready');
  assert.equal(ready.shelf, 1);
  assert.throws(() => transition(o.id, 'cooking'), HttpError);
  transition(o.id, 'collected');

  addReviews(o.id, userId, [{ menuItemId: dosa, rating: 5 }]);
  assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM reviews')?.n, 1);
});

test('sold-out items are rejected', () => {
  assert.throws(
    () => createOrder({ userId, canteenId: 't', slotStart: firstSlot().start, items: [{ menuItemId: samosa, qty: 1 }] }),
    (e: HttpError) => e.code === 'sold_out',
  );
});

test('a full slot cannot be booked, and expired holds free it again', () => {
  run("UPDATE canteens SET throughput_per_10min = 1 WHERE id = 't'");
  const slot = slotsFor(getCanteen('t'))[1];
  const hold = createOrder({ userId, canteenId: 't', slotStart: slot.start, items: [{ menuItemId: dosa, qty: 1 }] });
  assert.throws(
    () => createOrder({ userId, canteenId: 't', slotStart: slot.start, items: [{ menuItemId: dosa, qty: 1 }] }),
    (e: HttpError) => e.code === 'slot_full',
  );
  run('UPDATE orders SET created_at = ? WHERE id = ?', Date.now() - 11 * 60_000, hold.id);
  assert.equal(expireUnpaid(), 1);
  assert.equal(getOrder(hold.id).status, 'expired');
  const again = createOrder({ userId, canteenId: 't', slotStart: slot.start, items: [{ menuItemId: dosa, qty: 1 }] });
  assert.equal(again.status, 'pending_payment');
});

test('cancelling a paid order marks a refund as due', () => {
  run("UPDATE canteens SET throughput_per_10min = 20 WHERE id = 't'");
  run("UPDATE orders SET status = 'collected' WHERE user_id = ?", userId);
  const o = createOrder({ userId, canteenId: 't', slotStart: firstSlot().start, items: [{ menuItemId: dosa, qty: 1 }] });
  markPaid(o.id, 'pay_x');
  const c = transition(o.id, 'cancelled', { reason: 'Ran out' });
  assert.equal(c.refund_status, 'due');
});

test('closed canteen refuses orders', () => {
  run("UPDATE canteens SET manual_status = 'closed' WHERE id = 't'");
  assert.throws(
    () => createOrder({ userId, canteenId: 't', slotStart: Date.now(), items: [{ menuItemId: dosa, qty: 1 }] }),
    (e: HttpError) => e.code === 'canteen_closed',
  );
  run("UPDATE canteens SET manual_status = 'open' WHERE id = 't'");
});

test('H1 status-update delay is logged per screen and summarised', async () => {
  const { stampChange, recordShown, latencySummary } = await import('../src/domain/latency.ts');
  const t0 = Date.now();
  const change = stampChange('t', 'menu', t0);
  assert.equal(recordShown(change.id, t0 + 2_000), true);
  assert.equal(recordShown(change.id, t0 + 40_000), true);
  assert.equal(recordShown(change.id, t0 + 70_000), true);
  assert.equal(recordShown('00000000-0000-4000-8000-000000000000', t0), false, 'unknown change ignored');
  const s = latencySummary(t0 - 1, 't');
  assert.equal(s.samples, 3);
  assert.equal(s.over60s, 1);
  assert.equal(Math.round(s.within30sRate! * 100), 33);
  assert.equal(s.p95Seconds, 70);
});
