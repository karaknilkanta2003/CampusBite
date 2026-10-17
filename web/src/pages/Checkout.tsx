import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useCart } from '../cart';
import { useSession } from '../session';
import { reportShown, useLive } from '../live';
import type { Canteen, MenuItem, Order, PaymentInit, Slot } from '../types';
import { rupees } from '../format';
import { BackButton, ErrorBanner, Icon, SignInPrompt, Spinner } from '../components/ui';
import { MockPayment } from '../components/MockPayment';

interface SlotsResponse {
  slots: Slot[];
  recommended: { start: number; reason: string } | null;
  hasTimetable: boolean;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment page'));
    document.body.appendChild(s);
  });
}

export function Checkout() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user, config } = useSession();
  const cart = useCart();
  const [canteen, setCanteen] = useState<Canteen | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [slots, setSlots] = useState<SlotsResponse | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSlots = useCallback(() => {
    api<SlotsResponse>(`/canteens/${id}/slots`)
      .then((r) => {
        setSlots(r);
        setPicked((p) => (p && r.slots.some((s) => s.start === p && !s.full) ? p : r.recommended?.start ?? r.slots.find((s) => !s.full)?.start ?? null));
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    api<{ canteen: Canteen; menu: MenuItem[] }>(`/canteens/${id}`)
      .then((r) => {
        setCanteen(r.canteen);
        setMenu(r.menu);
      })
      .catch((e: Error) => setError(e.message));
    loadSlots();
    const t = setInterval(loadSlots, 30_000);
    return () => clearInterval(t);
  }, [id, loadSlots]);

  useLive({
    canteen: (c: Canteen & { change?: { id: string } }) => {
      if (c.id !== id) return;
      setCanteen(c);
      reportShown(c);
    },
    menu: (m: { canteenId: string; items: MenuItem[]; change?: { id: string } }) => {
      if (m.canteenId !== id) return;
      setMenu(m.items);
      reportShown(m);
    },
  }, {}, {
    resync: () => {
      loadSlots();
      api<{ canteen: Canteen; menu: MenuItem[] }>(`/canteens/${id}`)
        .then((r) => {
          setCanteen(r.canteen);
          setMenu(r.menu);
        })
        .catch(() => undefined);
    },
  });

  if (!user) {
    return (
      <div className="app">
        <div className="page">
          <BackButton to={`/c/${id}`} />
          <SignInPrompt text="Sign in to order. Your cart is saved." />
        </div>
      </div>
    );
  }
  if (!canteen || !slots) return error ? <div className="app"><div className="page"><BackButton /><ErrorBanner error={error} /></div></div> : <Spinner />;

  const byId = new Map(menu.map((m) => [m.id, m]));
  const lines = cart.lines(id).filter((l) => byId.has(l.menuItemId));
  const soldOut = lines.filter((l) => !byId.get(l.menuItemId)!.available);
  const subtotal = lines.reduce((s, l) => s + byId.get(l.menuItemId)!.pricePaise * l.qty, 0);
  const fee = config?.feePaise ?? 500;
  const pickedSlot = slots.slots.find((s) => s.start === picked) ?? null;

  async function placeOrder() {
    if (!pickedSlot || !user) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: Order; payment: PaymentInit }>('/orders', {
        body: { canteenId: id, slotStart: pickedSlot.start, items: lines },
      });
      if (r.payment.provider === 'mock') {
        // Demo mode: show the UPI payment sheet. The slot is held while the student pays.
        setPaying(r.order);
        setBusy(false);
        return;
      }
      await loadRazorpay();
      const p = r.payment;
      const rz = new window.Razorpay!({
        key: p.keyId,
        order_id: p.razorpayOrderId,
        amount: p.amountPaise,
        currency: p.currency,
        name: p.name,
        description: p.description,
        prefill: p.prefill,
        theme: { color: '#2B4ACB' },
        method: { upi: true, card: true, netbanking: false, wallet: false },
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await api(`/orders/${r.order.id}/pay/razorpay`, { body: resp });
          } catch {
            // The webhook will still confirm it; the order page shows the latest status.
          }
          cart.clear(id);
          navigate(`/orders/${r.order.id}`, { replace: true });
        },
        modal: {
          ondismiss: () => {
            setBusy(false);
            setError('Payment was not completed. Your slot is held for 10 minutes. Try again.');
          },
        },
      });
      rz.open();
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : 'Could not place the order');
      if (err instanceof ApiError && (err.code === 'slot_full' || err.code === 'slot_invalid')) loadSlots();
    }
  }

  return (
    <div className="app">
      <div className="page">
        <div className="topbar">
          <BackButton to={`/c/${id}`} label="Back to menu" />
          <div className="stack-sm grow" style={{ gap: 0 }}>
            <h1 style={{ fontSize: 21 }}>Pick a pickup time</h1>
            <span className="small muted bold">{canteen.name}</span>
          </div>
        </div>

        {slots.recommended ? (
          <div className="banner banner-info">
            <Icon name="clock" />
            <span>{slots.recommended.reason}.</span>
          </div>
        ) : (
          !slots.hasTimetable && (
            <div className="banner banner-info">
              <Icon name="calendar" />
              <span>
                <Link to="/me">Add your timetable</Link> and we'll suggest times that fit between classes.
              </span>
            </div>
          )
        )}

        {slots.slots.length === 0 && <div className="empty">No pickup times left today at this canteen.</div>}
        <div className="stack" role="radiogroup" aria-label="Pickup time">
          {slots.slots.map((s) => {
            const rec = slots.recommended?.start === s.start;
            return (
              <button key={s.start} role="radio" aria-checked={picked === s.start} className={`slot${picked === s.start ? ' selected' : ''}`} disabled={s.full} onClick={() => setPicked(s.start)}>
                <div className="row-between" style={{ width: '100%' }}>
                  <div className="row">
                    <span className="slot-time">{s.label}</span>
                    {rec && <span className="pill pill-accent">Best for you</span>}
                  </div>
                  <span className={`small bold ${s.full ? 'faint' : s.remaining < 6 ? 'crowd-moderate' : 'muted'}`}>{s.full ? 'Full' : `${s.remaining} of ${s.capacity} left`}</span>
                </div>
                <div className="slot-bar">
                  <div className={s.remaining < 6 ? 'low' : ''} style={{ width: `${Math.round((s.booked / s.capacity) * 100)}%` }} />
                </div>
              </button>
            );
          })}
        </div>
        <p className="tiny muted">Each slot takes only as many orders as the kitchen can cook on time. Full slots can't be booked.</p>

        <div className="card stack">
          <h3>Your order</h3>
          {lines.map((l) => {
            const m = byId.get(l.menuItemId)!;
            return (
              <div key={l.menuItemId} className="row-between">
                <span className={m.available ? '' : 'faint'}>
                  {l.qty} × {m.name}
                  {!m.available && ' (sold out)'}
                </span>
                <span className="bold">{rupees(m.pricePaise * l.qty)}</span>
              </div>
            );
          })}
          <div style={{ height: 1, background: 'var(--line)' }} />
          <div className="row-between small muted bold"><span>Subtotal</span><span>{rupees(subtotal)}</span></div>
          <div className="row-between small muted bold"><span>Skip-the-queue fee</span><span>{rupees(fee)}</span></div>
          <div className="row-between bold" style={{ fontSize: 17 }}><span>Total</span><span>{rupees(subtotal + fee)}</span></div>
        </div>

        {soldOut.length > 0 && <div className="banner banner-warn">Some items just sold out. Go back and remove them to continue.</div>}
        {lines.length === 0 && <div className="banner banner-warn">Your cart is empty.</div>}
        <ErrorBanner error={error} />
      </div>

      <div className="bottom-bar">
        <button
          className="btn btn-primary btn-lg btn-block"
          disabled={busy || !pickedSlot || lines.length === 0 || soldOut.length > 0 || !canteen.status.acceptingOrders}
          onClick={placeOrder}
        >
          {busy ? 'Placing order…' : pickedSlot ? `Pay ${rupees(subtotal + fee)} · ready at ${pickedSlot.label}` : 'Pick a time'}
        </button>
      </div>
      {paying && (
        <MockPayment
          order={paying}
          onPaid={(o) => {
            cart.clear(id);
            navigate(`/orders/${o.id}`, { replace: true });
          }}
          onClose={() => {
            // Order stays held as "awaiting payment"; the order page has a Pay now button.
            cart.clear(id);
            navigate(`/orders/${paying.id}`, { replace: true });
          }}
        />
      )}
    </div>
  );
}
