export type Role = 'student' | 'staff' | 'admin';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  canteenId: string | null;
}

export interface AppConfig {
  paymentProvider: 'mock' | 'razorpay';
  feePaise: number;
  vapidPublicKey: string | null;
  allowedEmailDomains: string[];
  map: { tileUrl: string; attribution: string; center: [number, number]; zoom: number };
  demoSignIn?: boolean;
}

export type CanteenState = 'open' | 'closed' | 'unconfirmed';
export type CrowdLevel = 'quiet' | 'moderate' | 'busy';

export interface Canteen {
  id: string;
  name: string;
  location: string;
  kind: 'canteen' | 'mess';
  lat: number | null;
  lon: number | null;
  mapsUrl: string | null;
  status: { state: CanteenState; label: string; acceptingOrders: boolean; todayHours: string | null };
  crowd: { level: CrowdLevel; ratio: number; waitMinutes: number; source: 'sensor' | 'orders'; people: number | null };
  slotMinutes: number;
  slotCapacity: number;
  hours: { weekday: number; open: string; close: string }[];
}

export interface MenuItem {
  id: number;
  name: string;
  category: string;
  pricePaise: number;
  veg: boolean;
  available: boolean;
  active: boolean;
  rating: number | null;
  ratingCount: number;
}

export interface Slot {
  start: number;
  label: string;
  capacity: number;
  booked: number;
  remaining: number;
  full: boolean;
}

export type OrderStatus = 'pending_payment' | 'placed' | 'cooking' | 'ready' | 'collected' | 'cancelled' | 'expired';

export interface Order {
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
