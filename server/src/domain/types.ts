export type Role = 'student' | 'staff' | 'admin';

export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  canteen_id: string | null;
  created_at: number;
}

export interface CanteenRow {
  id: string;
  name: string;
  location: string;
  kind: 'canteen' | 'mess';
  lat: number | null;
  lon: number | null;
  order_prefix: string;
  seats: number;
  shelf_count: number;
  slot_minutes: number;
  throughput_per_10min: number;
  capacity_factor: number;
  manual_status: 'auto' | 'open' | 'closed';
  last_heartbeat_at: number | null;
  calibrated_at: number | null;
  accepts_orders: number;
  sort: number;
  created_at: number;
}

export interface HoursRow {
  canteen_id: string;
  weekday: number;
  open_time: string;
  close_time: string;
}

export interface MenuItemRow {
  id: number;
  canteen_id: string;
  name: string;
  category: string;
  price_paise: number;
  veg: number;
  available: number;
  active: number;
  sort: number;
}

export type OrderStatus = 'pending_payment' | 'placed' | 'cooking' | 'ready' | 'collected' | 'cancelled' | 'expired';

export interface OrderRow {
  id: number;
  canteen_id: string;
  user_id: number;
  code: string;
  slot_start: number;
  status: OrderStatus;
  subtotal_paise: number;
  fee_paise: number;
  total_paise: number;
  payment_provider: string;
  payment_ref: string | null;
  payment_id: string | null;
  refund_status: string | null;
  cancel_reason: string | null;
  shelf: number | null;
  reminders_sent: number;
  last_reminder_at: number | null;
  created_at: number;
  paid_at: number | null;
  cooking_at: number | null;
  ready_at: number | null;
  collected_at: number | null;
}

export interface OrderItemRow {
  order_id: number;
  menu_item_id: number;
  name: string;
  unit_price_paise: number;
  qty: number;
}

export interface TimetableRow {
  id: number;
  user_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
  title: string;
}

/** Statuses that count against kitchen load and slot capacity. */
export const ACTIVE_STATUSES: OrderStatus[] = ['pending_payment', 'placed', 'cooking', 'ready'];

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
