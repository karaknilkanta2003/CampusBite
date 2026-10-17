import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus } from '../src/domain/status.ts';
import { computeCrowd, crowdLevel } from '../src/domain/crowd.ts';
import { listSlots, recommendSlot, slotCapacity } from '../src/domain/slots.ts';
import type { CanteenRow, HoursRow, TimetableRow } from '../src/domain/types.ts';
import { atIstMinutes, hmOf, istMinutes, istWeekday } from '../src/lib/time.ts';

// Wednesday 2026-10-07 12:38 IST
const NOW = Date.UTC(2026, 9, 7, 7, 8);

const canteen: CanteenRow = {
  id: 'main',
  name: 'Main Canteen',
  location: '',
  kind: 'canteen',
  lat: 17.4463,
  lon: 78.3491,
  order_prefix: 'M',
  seats: 100,
  shelf_count: 12,
  slot_minutes: 10,
  throughput_per_10min: 28,
  capacity_factor: 0.85,
  manual_status: 'auto',
  last_heartbeat_at: NOW - 60_000,
  calibrated_at: null,
  accepts_orders: 1,
  sort: 0,
  created_at: 0,
};
const everyDay: HoursRow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ canteen_id: 'main', weekday: d, open_time: '07:30', close_time: '22:30' }));
const STALE = 5 * 60_000;

test('IST helpers', () => {
  assert.equal(hmOf(NOW), '12:38');
  assert.equal(istWeekday(NOW), 3);
  assert.equal(istMinutes(atIstMinutes(NOW, 750)), 750);
});

test('open within hours with a fresh kitchen heartbeat', () => {
  const s = computeStatus(canteen, everyDay, NOW, STALE);
  assert.equal(s.state, 'open');
  assert.equal(s.label, 'Open · closes 22:30');
  assert.equal(s.acceptingOrders, true);
});

test('stale heartbeat shows "Status unconfirmed" and blocks orders (H1)', () => {
  const s = computeStatus({ ...canteen, last_heartbeat_at: NOW - 6 * 60_000 }, everyDay, NOW, STALE);
  assert.equal(s.state, 'unconfirmed');
  assert.equal(s.acceptingOrders, false);
});

test('closed outside hours shows the next opening', () => {
  const late = atIstMinutes(NOW, 23 * 60);
  const s = computeStatus(canteen, everyDay, late, STALE);
  assert.equal(s.state, 'closed');
  assert.equal(s.label, 'Closed · opens tomorrow 07:30');
});

test('manual close wins over hours', () => {
  const s = computeStatus({ ...canteen, manual_status: 'closed' }, everyDay, NOW, STALE);
  assert.equal(s.state, 'closed');
});

test('slot capacity = 0.85 x throughput, nearest order (H2): 28 -> 24, 26-30 -> 22-26', () => {
  assert.equal(slotCapacity(canteen), 24);
  assert.equal(slotCapacity({ ...canteen, throughput_per_10min: 26 }), 22);
  assert.equal(slotCapacity({ ...canteen, throughput_per_10min: 30 }), 26);
  assert.equal(slotCapacity({ ...canteen, slot_minutes: 5 }), 12);
});

test('slots start after the lead time on a slot boundary and respect capacity', () => {
  const booked = new Map([[atIstMinutes(NOW, 13 * 60), 24]]);
  const slots = listSlots({ canteen, hours: everyDay, now: NOW, booked, minLeadMinutes: 8, count: 6 });
  assert.deepEqual(
    slots.map((s) => s.label),
    ['12:50', '13:00', '13:10', '13:20', '13:30', '13:40'],
  );
  assert.equal(slots[1].full, true);
  assert.equal(slots[0].remaining, 24);
});

test('no slots after closing', () => {
  const slots = listSlots({ canteen, hours: everyDay, now: atIstMinutes(NOW, 22 * 60 + 25), booked: new Map(), minLeadMinutes: 8, count: 6 });
  assert.equal(slots.length, 0);
});

test('recommended slot skips class time and leaves walking time', () => {
  const slots = listSlots({ canteen, hours: everyDay, now: NOW, booked: new Map(), minLeadMinutes: 8, count: 8 });
  const classes: TimetableRow[] = [{ id: 1, user_id: 1, weekday: 3, start_time: '11:00', end_time: '12:55', title: 'Lab' }];
  const rec = recommendSlot(slots, classes, NOW, 5);
  assert.ok(rec);
  assert.equal(hmOf(rec.start), '13:00');
  assert.match(rec.reason, /Lab ends at 12:55/);
});

test('crowd: sensor reading when fresh, queue proxy otherwise', () => {
  assert.equal(crowdLevel(0.2), 'quiet');
  assert.equal(crowdLevel(0.5), 'moderate');
  assert.equal(crowdLevel(0.9), 'busy');
  const viaSensor = computeCrowd({ seats: 100, throughputPer10Min: 28, reading: { people: 90, measured_at: NOW - 60_000 }, queuedOrders: 0, now: NOW, sensorFreshMs: STALE });
  assert.equal(viaSensor.source, 'sensor');
  assert.equal(viaSensor.level, 'busy');
  const viaQueue = computeCrowd({ seats: 100, throughputPer10Min: 28, reading: { people: 90, measured_at: NOW - 60 * 60_000 }, queuedOrders: 5, now: NOW, sensorFreshMs: STALE });
  assert.equal(viaQueue.source, 'orders');
  assert.equal(viaQueue.level, 'quiet');
});

test('hours past midnight: BBC 09:00-01:00 is open at 00:30 and offers no slot after 01:00', () => {
  const late: HoursRow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ canteen_id: 'bbc', weekday: d, open_time: '09:00', close_time: '01:00' }));
  const at0030 = atIstMinutes(NOW, 24 * 60 + 30); // 00:30 Thursday
  const s = computeStatus(canteen, late, at0030, STALE);
  assert.equal(s.state, 'unconfirmed', 'within hours; heartbeat is old at this time');
  const fresh = computeStatus({ ...canteen, last_heartbeat_at: at0030 }, late, at0030, STALE);
  assert.equal(fresh.label, 'Open · closes 01:00');
  const at2340 = atIstMinutes(NOW, 23 * 60 + 40);
  const slots = listSlots({ canteen, hours: late, now: at2340, booked: new Map(), minLeadMinutes: 8, count: 12 });
  assert.deepEqual(slots.map((x) => x.label), ['23:50', '00:00', '00:10', '00:20', '00:30', '00:40', '00:50']);
  const closed = computeStatus({ ...canteen, last_heartbeat_at: at0030 }, late, atIstMinutes(NOW, 25 * 60 + 5), STALE);
  assert.equal(closed.label, 'Closed · opens 09:00');
});

test('messes: several meal windows a day, status without a kitchen heartbeat, no ordering', () => {
  const meals: HoursRow[] = ['07:30-09:30', '12:30-14:30', '19:30-21:30'].map((w) => {
    const [o, c] = w.split('-');
    return { canteen_id: 'k', weekday: 3, open_time: o, close_time: c };
  });
  const mess = { ...canteen, kind: 'mess' as const, last_heartbeat_at: null };
  const lunch = computeStatus(mess, meals, NOW, STALE);
  assert.equal(lunch.state, 'open');
  assert.equal(lunch.label, 'Serving · until 14:30');
  assert.equal(lunch.acceptingOrders, false);
  assert.equal(lunch.todayHours, '07:30–09:30, 12:30–14:30, 19:30–21:30');
  const between = computeStatus(mess, meals, atIstMinutes(NOW, 16 * 60), STALE);
  assert.equal(between.label, 'Closed · opens 19:30');
  assert.equal(listSlots({ canteen: mess, hours: meals, now: NOW, booked: new Map(), minLeadMinutes: 8, count: 6 }).length, 0);
});
