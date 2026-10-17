import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { useSession } from '../session';
import type { Order, OrderStatus } from '../types';
import { day, rupees } from '../format';
import { SignInPrompt, Spinner, TabBar } from '../components/ui';

const LABEL: Record<OrderStatus, [string, string]> = {
  pending_payment: ['Awaiting payment', 'pill-unconfirmed'],
  placed: ['Sent to kitchen', 'pill-soft'],
  cooking: ['Cooking', 'pill-soft'],
  ready: ['Ready to collect', 'pill-open'],
  collected: ['Collected', 'pill-closed'],
  cancelled: ['Cancelled', 'pill-closed'],
  expired: ['Not paid', 'pill-closed'],
};

export function Orders() {
  const { user } = useSession();
  const [orders, setOrders] = useState<Order[] | null>(null);

  const load = useCallback(() => {
    if (user) api<{ orders: Order[] }>('/orders').then((r) => setOrders(r.orders)).catch(() => setOrders((l) => l ?? []));
  }, [user]);

  useEffect(load, [load]);

  useLive(
    { order: (o: Order) => setOrders((list) => (list ? [o, ...list.filter((x) => x.id !== o.id)].sort((a, b) => b.createdAt - a.createdAt) : list)) },
    {},
    { resync: load, pollMs: 15_000 },
  );

  const active = (orders ?? []).some((o) => ['placed', 'cooking', 'ready'].includes(o.status));

  return (
    <div className="app">
      <div className="page">
        <h1>Your orders</h1>
        {!user && <SignInPrompt text="Sign in to see your orders." />}
        {user && !orders && <Spinner />}
        {orders && orders.length === 0 && (
          <div className="empty">
            <p>No orders yet.</p>
            <Link className="btn btn-primary" to="/">
              Find something to eat
            </Link>
          </div>
        )}
        {orders?.map((o) => (
          <Link key={o.id} to={`/orders/${o.id}`} className="card card-link stack-sm">
            <div className="row-between">
              <span className="mono bold" style={{ fontSize: 18 }}>
                {o.code}
              </span>
              <span className={`pill ${LABEL[o.status][1]}`}>{LABEL[o.status][0]}</span>
            </div>
            <span className="small bold">
              {o.canteen.name} · {day(o.slotStart)} · {o.slotLabel}
            </span>
            <span className="small muted">
              {o.items.map((i) => `${i.qty} × ${i.name}`).join(', ')} · {rupees(o.totalPaise)}
            </span>
            {o.status === 'collected' && !o.reviewed && <span className="small bold" style={{ color: 'var(--accent)' }}>Rate this order →</span>}
          </Link>
        ))}
      </div>
      <TabBar hasActiveOrder={active} />
    </div>
  );
}
