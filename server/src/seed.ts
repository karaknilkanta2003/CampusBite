import { all, get, run, tx } from './db.ts';
import { hashDeviceKey } from './routes/sensors.ts';
import { istDayStart } from './lib/time.ts';

// IIIT Hyderabad's food outlets. Names, map positions and opening hours come from
// OpenStreetMap (© OpenStreetMap contributors, read October 2026); dishes come from
// student guides. PRICES ARE PLACEHOLDERS: no published price list exists, so admins
// must set real prices before launch. Order history and the extra users are made up.

type Window = [days: number[], open: string, close: string];

interface SeedPlace {
  id: string;
  name: string;
  location: string;
  kind: 'canteen' | 'mess';
  lat: number;
  lon: number;
  prefix: string;
  seats: number;
  throughput: number;
  hours: Window[];
  soldOut: string[];
  menu: [name: string, category: string, rupees: number, veg: boolean][];
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const MON_SAT = [1, 2, 3, 4, 5, 6];
const MON_FRI = [1, 2, 3, 4, 5];
const MEALS: Window[] = [
  [EVERY_DAY, '07:30', '09:30'],
  [EVERY_DAY, '12:30', '14:30'],
  [EVERY_DAY, '19:30', '21:30'],
];

const PLACES: SeedPlace[] = [
  {
    id: 'vc',
    name: 'Vindhya Canteen (VC)',
    location: 'Vindhya academic block, near the library',
    kind: 'canteen',
    lat: 17.446273,
    lon: 78.349132,
    prefix: 'V',
    seats: 80,
    throughput: 24,
    hours: [[MON_SAT, '08:00', '19:00']],
    soldOut: ['Papdi Chaat'],
    menu: [
      ['Tea', 'Drinks', 10, true],
      ['Coffee', 'Drinks', 15, true],
      ['Veg Puff', 'Snacks', 20, true],
      ['Egg Puff', 'Snacks', 25, false],
      ['Omelette', 'Snacks', 30, false],
      ['Veg Sandwich', 'Snacks', 40, true],
      ['Pav Bhaji', 'Chaat', 50, true],
      ['Papdi Chaat', 'Chaat', 40, true],
    ],
  },
  {
    id: 'bbc',
    name: 'BBC',
    location: 'By the hostels, near Felicity Ground',
    kind: 'canteen',
    lat: 17.445958,
    lon: 78.347179,
    prefix: 'B',
    seats: 50,
    throughput: 20,
    hours: [[EVERY_DAY, '09:00', '01:00']],
    soldOut: [],
    menu: [
      ['Plain Dosa', 'Dosa', 30, true],
      ['Masala Dosa', 'Dosa', 40, true],
      ['Cheese Dosa', 'Dosa', 50, true],
      ['Plain Maggi', 'Maggi', 30, true],
      ['Masala Cheese Maggi', 'Maggi', 50, true],
      ['Egg Maggi', 'Maggi', 45, false],
      ['Tea', 'Drinks', 10, true],
    ],
  },
  {
    id: 'davids',
    name: "David's Canteen",
    location: 'Next to BBC',
    kind: 'canteen',
    lat: 17.445893,
    lon: 78.347086,
    prefix: 'D',
    seats: 30,
    throughput: 14,
    hours: [[MON_SAT, '16:00', '02:00']],
    soldOut: [],
    menu: [
      ['Paneer Roll', 'Rolls', 60, true],
      ['Egg Roll', 'Rolls', 50, false],
      ['Chicken Roll', 'Rolls', 70, false],
      ['Fried Maggi', 'Maggi', 50, true],
      ['Ice Cream Brownie', 'Desserts', 70, true],
    ],
  },
  {
    id: 'jc',
    name: 'Juice Canteen (JC)',
    location: 'Near Parijaat Nivas and the basketball court',
    kind: 'canteen',
    lat: 17.447934,
    lon: 78.347581,
    prefix: 'J',
    seats: 30,
    throughput: 16,
    hours: [[EVERY_DAY, '13:00', '01:00']],
    soldOut: [],
    menu: [
      ['Oreo Shake', 'Shakes', 60, true],
      ['Avocado Honey Shake', 'Shakes', 80, true],
      ['Watermelon Juice', 'Juices', 40, true],
      ['Nimbu Soda', 'Juices', 25, true],
    ],
  },
  {
    id: 'cie',
    name: 'CIE Canteen',
    location: 'CIE building, first floor',
    kind: 'canteen',
    lat: 17.445895,
    lon: 78.350033,
    prefix: 'C',
    seats: 25,
    throughput: 10,
    hours: [[MON_FRI, '08:00', '17:00']],
    soldOut: [],
    menu: [
      ['Tea', 'Drinks', 10, true],
      ['Coffee', 'Drinks', 15, true],
    ],
  },
  {
    id: 'kadamba',
    name: 'Kadamba Mess',
    location: 'Kadamba Nivas (New Boys Hostel)',
    kind: 'mess',
    lat: 17.446989,
    lon: 78.347581,
    prefix: 'K',
    seats: 300,
    throughput: 10,
    hours: MEALS,
    soldOut: [],
    menu: [],
  },
  {
    id: 'yuktahar',
    name: 'Yuktahar Mess',
    location: 'Kadamba Nivas, first floor',
    kind: 'mess',
    lat: 17.447019,
    lon: 78.347532,
    prefix: 'Y',
    seats: 200,
    throughput: 10,
    hours: MEALS,
    soldOut: [],
    menu: [],
  },
  {
    id: 'palash',
    name: 'Palash Mess',
    location: 'Palash Nivas',
    kind: 'mess',
    lat: 17.444758,
    lon: 78.345718,
    prefix: 'P',
    seats: 300,
    throughput: 10,
    hours: MEALS,
    soldOut: [],
    menu: [],
  },
];

/** Small deterministic random generator so demo history is the same every time. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function seedDemo(): void {
  if (get('SELECT id FROM canteens LIMIT 1')) return;
  const now = Date.now();
  console.log('[seed] loading IIIT-H canteens and messes, demo staff and two weeks of demo order history');

  tx(() => {
    PLACES.forEach((c, i) => {
      run(
        `INSERT INTO canteens (id, name, location, kind, lat, lon, order_prefix, seats, shelf_count, slot_minutes, throughput_per_10min, capacity_factor, accepts_orders, sort, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 12, 10, ?, 0.85, ?, ?, ?)`,
        c.id,
        c.name,
        c.location,
        c.kind,
        c.lat,
        c.lon,
        c.prefix,
        c.seats,
        c.throughput,
        c.kind === 'canteen' ? 1 : 0,
        i,
        now,
      );
      for (const [days, open, close] of c.hours) {
        for (const d of days) run('INSERT INTO canteen_hours (canteen_id, weekday, open_time, close_time) VALUES (?, ?, ?, ?)', c.id, d, open, close);
      }
      c.menu.forEach(([name, category, rupees, veg], j) => {
        run(
          'INSERT INTO menu_items (canteen_id, name, category, price_paise, veg, available, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
          c.id,
          name,
          category,
          rupees * 100,
          veg ? 1 : 0,
          c.soldOut.includes(name) ? 0 : 1,
          j,
        );
      });
    });

    const users: [string, string, string, string | null][] = [
      ['admin@iiit.ac.in', 'Campus Admin', 'admin', null],
      ['kitchen.vc@iiit.ac.in', 'VC Kitchen', 'staff', 'vc'],
      ['kitchen.bbc@iiit.ac.in', 'BBC Kitchen', 'staff', 'bbc'],
      ['kitchen.davids@iiit.ac.in', "David's Kitchen", 'staff', 'davids'],
      ['kitchen.jc@iiit.ac.in', 'JC Counter', 'staff', 'jc'],
      ['kitchen.cie@iiit.ac.in', 'CIE Canteen Kitchen', 'staff', 'cie'],
      ['student@students.iiit.ac.in', 'Demo Student', 'student', null],
    ];
    for (const [email, name, role, canteen] of users) {
      run('INSERT INTO users (email, name, role, canteen_id, created_at) VALUES (?, ?, ?, ?, ?)', email, name, role, canteen, now);
    }

    // Demo door counter for VC. Key: cbdev_demo_vc_counter
    run('INSERT INTO sensors (canteen_id, label, key_hash, created_at) VALUES (?, ?, ?, ?)', 'vc', 'VC entrance (demo)', hashDeviceKey('cbdev_demo_vc_counter'), now);

    // A demo timetable so slot suggestions have something to work with.
    const student = get<{ id: number }>('SELECT id FROM users WHERE email = ?', 'student@students.iiit.ac.in')!;
    for (let d = 1; d <= 5; d++) {
      run('INSERT INTO timetable_entries (user_id, weekday, start_time, end_time, title) VALUES (?, ?, ?, ?, ?)', student.id, d, '09:00', '10:30', 'Lecture');
      run('INSERT INTO timetable_entries (user_id, weekday, start_time, end_time, title) VALUES (?, ?, ?, ?, ?)', student.id, d, '11:00', '12:50', 'Lab');
      run('INSERT INTO timetable_entries (user_id, weekday, start_time, end_time, title) VALUES (?, ?, ?, ?, ?)', student.id, d, '14:00', '15:30', 'Lecture');
    }

    seedHistory(now);
  });
}

/** Two weeks of made-up past orders at VC so the metrics page has data. */
function seedHistory(now: number): void {
  const rand = rng(42);
  const studentIds: number[] = [];
  for (let i = 1; i <= 250; i++) {
    const { id } = run(
      'INSERT INTO users (email, name, role, created_at) VALUES (?, ?, ?, ?)',
      `student${String(i).padStart(3, '0')}@students.iiit.ac.in`,
      `Student ${i}`,
      'student',
      now - 20 * 86_400_000,
    );
    studentIds.push(id);
  }
  const items = all<{ id: number; name: string; price_paise: number }>('SELECT id, name, price_paise FROM menu_items WHERE canteen_id = ?', 'vc');
  const today = istDayStart(now);

  for (let day = 13; day >= 1; day--) {
    const dayStart = today - day * 86_400_000;
    const count = 25 + Math.floor(rand() * 30) + (13 - day) * 2; // adoption grows over the trial
    for (let n = 0; n < count; n++) {
      // Lunch rush 12:30-14:00 and an evening bump before VC closes at 19:00
      const minute = rand() < 0.7 ? 750 + Math.floor(rand() * 9) * 10 : 1050 + Math.floor(rand() * 9) * 10;
      const slot = dayStart + minute * 60_000;
      const created = slot - (10 + Math.floor(rand() * 40)) * 60_000;
      const userId = studentIds[Math.floor(Math.pow(rand(), 1.3) * studentIds.length)];
      const lateMin = Math.round((rand() - 0.7) * 14); // about 9 in 10 within 3 minutes of the slot
      const ready = slot + lateMin * 60_000;
      const cooking = ready - (4 + Math.floor(rand() * 6)) * 60_000;
      const cancelled = rand() < 0.03;
      const picks = 1 + Math.floor(rand() * 2);
      let subtotal = 0;
      const lines: { id: number; name: string; price: number; qty: number }[] = [];
      for (let k = 0; k < picks; k++) {
        const it = items[Math.floor(rand() * items.length)];
        if (lines.some((l) => l.id === it.id)) continue;
        const qty = rand() < 0.8 ? 1 : 2;
        subtotal += it.price_paise * qty;
        lines.push({ id: it.id, name: it.name, price: it.price_paise, qty });
      }
      const { id: orderId } = run(
        `INSERT INTO orders (canteen_id, user_id, code, slot_start, status, subtotal_paise, fee_paise, total_paise, payment_provider, payment_id,
           refund_status, cancel_reason, created_at, paid_at, cooking_at, ready_at, collected_at, shelf)
         VALUES ('vc', ?, ?, ?, ?, ?, 500, ?, 'mock', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId,
        `V-${String(n + 1).padStart(2, '0')}`,
        slot,
        cancelled ? 'cancelled' : 'collected',
        subtotal,
        subtotal + 500,
        `mock_hist_${day}_${n}`,
        cancelled ? 'refunded' : null,
        cancelled ? 'Item ran out' : null,
        created,
        created + 30_000,
        cancelled ? null : cooking,
        cancelled ? null : ready,
        cancelled ? null : ready + (1 + Math.floor(rand() * 6)) * 60_000,
        cancelled ? null : 1 + (n % 12),
      );
      for (const l of lines) {
        run('INSERT INTO order_items (order_id, menu_item_id, name, unit_price_paise, qty) VALUES (?, ?, ?, ?, ?)', orderId, l.id, l.name, l.price, l.qty);
        if (!cancelled && rand() < 0.45) {
          const rating = Math.min(5, Math.max(1, Math.round(3.4 + rand() * 1.8 + (l.name.includes('Sandwich') ? -0.8 : 0))));
          run(
            'INSERT INTO reviews (order_id, menu_item_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            orderId,
            l.id,
            userId,
            rating,
            '',
            ready + 15 * 60_000,
          );
        }
      }
    }
  }
}
