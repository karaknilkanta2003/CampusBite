-- CampusBite schema. Money is stored in paise, times as epoch milliseconds (UTC).

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'staff', 'admin')),
  canteen_id  TEXT REFERENCES canteens(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS canteens (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  location               TEXT NOT NULL DEFAULT '',   -- landmark directions, e.g. "Next to the library"
  kind                   TEXT NOT NULL DEFAULT 'canteen' CHECK (kind IN ('canteen', 'mess')),
  lat                    REAL,                       -- map position (WGS84)
  lon                    REAL,
  order_prefix           TEXT NOT NULL,              -- "M" gives codes like M-07
  seats                  INTEGER NOT NULL DEFAULT 60, -- for the crowd meter
  shelf_count            INTEGER NOT NULL DEFAULT 12,
  slot_minutes           INTEGER NOT NULL DEFAULT 10,
  throughput_per_10min   INTEGER NOT NULL DEFAULT 28, -- orders the kitchen finishes in 10 min
  capacity_factor        REAL NOT NULL DEFAULT 0.85,  -- slot cap = factor x throughput (H2)
  manual_status          TEXT NOT NULL DEFAULT 'auto' CHECK (manual_status IN ('auto', 'open', 'closed')),
  last_heartbeat_at      INTEGER,
  calibrated_at          INTEGER,
  accepts_orders         INTEGER NOT NULL DEFAULT 1,
  sort                   INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER NOT NULL
);

-- Opening windows per weekday (0 = Sunday). Several rows a day are allowed (mess meal times).
-- No row = closed that day.
CREATE TABLE IF NOT EXISTS canteen_hours (
  canteen_id  TEXT NOT NULL REFERENCES canteens(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  open_time   TEXT NOT NULL,  -- "07:30" IST
  close_time  TEXT NOT NULL,  -- "22:30" IST; "24:00" = midnight; earlier than open_time = runs past midnight
  PRIMARY KEY (canteen_id, weekday, open_time)
);

CREATE TABLE IF NOT EXISTS menu_items (
  id            INTEGER PRIMARY KEY,
  canteen_id    TEXT NOT NULL REFERENCES canteens(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'Main',
  price_paise   INTEGER NOT NULL CHECK (price_paise >= 0),
  veg           INTEGER NOT NULL DEFAULT 1,
  available     INTEGER NOT NULL DEFAULT 1,  -- kitchen toggles sold out
  active        INTEGER NOT NULL DEFAULT 1,  -- admin removes from menu
  sort          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_menu_canteen ON menu_items(canteen_id);

CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY,
  canteen_id        TEXT NOT NULL REFERENCES canteens(id),
  user_id           INTEGER NOT NULL REFERENCES users(id),
  code              TEXT NOT NULL,
  slot_start        INTEGER NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('pending_payment', 'placed', 'cooking', 'ready', 'collected', 'cancelled', 'expired')),
  subtotal_paise    INTEGER NOT NULL,
  fee_paise         INTEGER NOT NULL,
  total_paise       INTEGER NOT NULL,
  payment_provider  TEXT NOT NULL,
  payment_ref       TEXT,            -- provider order id
  payment_id        TEXT,            -- provider payment id
  refund_status     TEXT,            -- null | 'due' | 'refunded' | 'failed'
  cancel_reason     TEXT,
  shelf             INTEGER,
  reminders_sent    INTEGER NOT NULL DEFAULT 0,
  last_reminder_at  INTEGER,
  created_at        INTEGER NOT NULL,
  paid_at           INTEGER,
  cooking_at        INTEGER,
  ready_at          INTEGER,
  collected_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_canteen_slot ON orders(canteen_id, slot_start);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_ref ON orders(payment_ref) WHERE payment_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_items (
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id      INTEGER NOT NULL REFERENCES menu_items(id),
  name              TEXT NOT NULL,
  unit_price_paise  INTEGER NOT NULL,
  qty               INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (order_id, menu_item_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id            INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id  INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  UNIQUE (order_id, menu_item_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_item ON reviews(menu_item_id);

-- Door counters (hardware). The key is shown once and stored hashed.
CREATE TABLE IF NOT EXISTS sensors (
  id           INTEGER PRIMARY KEY,
  canteen_id   TEXT NOT NULL REFERENCES canteens(id) ON DELETE CASCADE,
  label        TEXT NOT NULL DEFAULT 'Door counter',
  key_hash     TEXT NOT NULL UNIQUE,
  last_seen_at INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS occupancy_readings (
  id           INTEGER PRIMARY KEY,
  canteen_id   TEXT NOT NULL REFERENCES canteens(id) ON DELETE CASCADE,
  people       INTEGER NOT NULL,
  measured_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_occupancy ON occupancy_readings(canteen_id, measured_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- A student's weekly class timetable, used to suggest pickup slots.
CREATE TABLE IF NOT EXISTS timetable_entries (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_timetable_user ON timetable_entries(user_id, weekday);

-- QFD spec H1: delay from a kitchen status/menu change to its display on a student screen.
CREATE TABLE IF NOT EXISTS status_latency (
  id          INTEGER PRIMARY KEY,
  canteen_id  TEXT NOT NULL REFERENCES canteens(id) ON DELETE CASCADE,
  change_id   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('status', 'menu')),
  changed_at  INTEGER NOT NULL,
  shown_at    INTEGER NOT NULL,
  latency_ms  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_latency ON status_latency(shown_at);
