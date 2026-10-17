import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useLive, useNow } from '../live';
import { useSession } from '../session';
import { currentPushState, enablePush } from '../push';
import type { Order } from '../types';
import { clock, minutesFromNow, rupees } from '../format';
import { BackButton, ErrorBanner, Icon, SignInPrompt, Spinner, useToast } from '../components/ui';
import { MockPayment } from '../components/MockPayment';

const STEP_ORDER = ['placed', 'cooking', 'ready', 'collected'] as const;

function Steps({ order }: { order: Order }) {
  const idx = STEP_ORDER.indexOf(order.status as (typeof STEP_ORDER)[number]);
  const first = order.items[0]?.name ?? 'Your food';
  const steps = [
    { title: 'Sent to the kitchen', detail: order.paidAt ? `Paid at ${clock(order.paidAt)}` : 'Waiting for payment' },
    { title: 'Cooking', detail: order.cookingAt ? `${first} started at ${clock(order.cookingAt)}` : 'The kitchen will start it before your slot' },
    { title: order.shelf ? `Ready on Shelf ${order.shelf}` : 'Ready at the counter', detail: order.readyAt ? `Ready at ${clock(order.readyAt)} · show code ${order.code}` : `Planned for ${order.slotLabel}` },
    { title: 'Collected', detail: order.collectedAt ? `Collected at ${clock(order.collectedAt)}` : 'Enjoy your meal' },
  ];
  return (
    <div className="steps">
      {steps.map((s, i) => {
        const state = i < idx || (i === idx && (order.status === 'ready' || order.status === 'collected')) ? 'done' : i === idx ? 'now' : 'todo';
        return (
          <div key={s.title} className={`step ${state}`}>
            <div className="step-rail">
              <span className={`step-dot ${state}`}>{state === 'done' && <Icon name="check" size={14} stroke={3} />}</span>
              {i < steps.length - 1 && <span className={`step-line${i < idx ? ' done' : ''}`} />}
            </div>
            <div className="step-body">
              <div className="step-title">{s.title}</div>
              <div className="small muted bold">{s.detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Rating({ order, onDone }: { order: Order; onDone: (o: Order) => void }) {
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rated = Object.keys(ratings).length;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const reviews = Object.entries(ratings).map(([menuItemId, rating]) => ({ menuItemId: Number(menuItemId), rating, comment }));
      const r = await api<{ order: Order }>(`/orders/${order.id}/reviews`, { body: { reviews } });
      onDone(r.order);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your rating');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="stack-sm">
        <h2>How was it?</h2>
        <p className="small muted">One tap per dish. Ratings go straight to {order.canteen.name}.</p>
      </div>
      {order.items.map((it) => (
        <div key={it.menuItemId} className="stack-sm">
          <span className="bold">{it.name}</span>
          <div className="stars" role="radiogroup" aria-label={`Rating for ${it.name}`}>
            {[1, 2, 3, 4, 5].map((n) => {
              const on = (ratings[it.menuItemId] ?? 0) >= n;
              return (
                <button
                  key={n}
                  className="star-btn"
                  role="radio"
                  aria-checked={ratings[it.menuItemId] === n}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  onClick={() => setRatings((r) => ({ ...r, [it.menuItemId]: n }))}
                >
                  <svg width="30" height="30" viewBox="0 0 24 24" fill={on ? '#E8A317' : 'none'} stroke={on ? '#C98A0C' : '#9AA3AF'} strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
                    <path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" />
                  </svg>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="field">
        <label htmlFor="comment">Anything the kitchen should know? (optional)</label>
        <textarea id="comment" className="input" rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <ErrorBanner error={error} />
      <button className="btn btn-primary btn-block" disabled={busy || rated === 0} onClick={submit}>
        {busy ? 'Sending…' : 'Send rating'}
      </button>
    </div>
  );
}

export function OrderPage() {
  const { id = '' } = useParams();
  const { user, config } = useSession();
  const now = useNow(15_000);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<'unsupported' | 'denied' | 'on' | 'off'>('unsupported');
  const [toast, showToast] = useToast();
  const [paying, setPaying] = useState(false);

  const load = useCallback(() => {
    if (!user) return;
    api<{ order: Order }>(`/orders/${id}`)
      .then((r) => setOrder(r.order))
      .catch((e: Error) => setError(e.message));
  }, [id, user]);

  useEffect(() => {
    if (!user) return;
    load();
    void currentPushState().then(setPush);
  }, [user, load]);

  const isLive = !!order && ['pending_payment', 'placed', 'cooking', 'ready'].includes(order.status);
  useLive({
    order: (o: Order) => {
      if (String(o.id) !== id) return;
      setOrder((prev) => {
        if (prev && prev.status !== 'ready' && o.status === 'ready' && 'vibrate' in navigator) navigator.vibrate?.([200, 100, 200]);
        return o;
      });
    },
  }, {}, { resync: load, pollMs: isLive ? 5_000 : undefined });

  if (!user) return <div className="app"><div className="page"><BackButton to="/" /><SignInPrompt text="Sign in to see your order." /></div></div>;
  if (error) return <div className="app"><div className="page"><BackButton to="/orders" /><ErrorBanner error={error} /></div></div>;
  if (!order) return <Spinner />;

  const active = ['placed', 'cooking', 'ready'].includes(order.status);
  const etaMin = order.etaAt ? minutesFromNow(order.etaAt, now) : null;

  async function cancel() {
    if (!order || !confirm(order.status === 'pending_payment' ? 'Cancel this order? You have not been charged.' : 'Cancel this order? You will get a full refund.')) return;
    try {
      const r = await api<{ order: Order }>(`/orders/${order.id}/cancel`, { method: 'POST', body: {} });
      setOrder(r.order);
      showToast('Order cancelled');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not cancel');
    }
  }

  async function turnOnAlerts() {
    if (!config?.vapidPublicKey) return;
    try {
      const ok = await enablePush(config.vapidPublicKey);
      setPush(ok ? 'on' : await currentPushState());
      showToast(ok ? "You'll get an alert when it's ready" : 'Alerts were not allowed');
    } catch {
      showToast('Could not turn on alerts on this device');
    }
  }

  return (
    <div className="app">
      <div className="page">
        <div className="row-between">
          <div className="row">
            <BackButton to="/orders" label="Back to orders" />
            <h1 style={{ fontSize: 21 }}>Your order</h1>
          </div>
          <Link className="btn btn-sm btn-plain" to="/">
            Home
          </Link>
        </div>

        {order.status === 'ready' && (
          <div className="banner banner-ready" role="alert">
            <Icon name="bell" size={22} />
            <div className="stack-sm" style={{ gap: 2 }}>
              <span style={{ fontSize: 16, fontWeight: 800 }}>Your food is ready</span>
              <span>
                Collect from {order.shelf ? `Shelf ${order.shelf}` : 'the counter'} at {order.canteen.name} with code {order.code}.
              </span>
            </div>
          </div>
        )}
        {order.status === 'cancelled' && (
          <div className="banner banner-err">
            Cancelled{order.cancelReason ? `: ${order.cancelReason}` : ''}.
            {order.refundStatus === 'refunded' && ' Your refund has been sent.'}
            {order.refundStatus === 'due' && ' Your refund is being processed.'}
            {order.refundStatus === 'failed' && ' The automatic refund failed; the canteen will refund you at the counter.'}
          </div>
        )}
        {order.status === 'expired' && <div className="banner banner-warn">Payment was not completed in time, so this order was released.</div>}
        {order.status === 'pending_payment' && (
          <div className="banner banner-warn stack-sm" style={{ display: 'flex' }}>
            <span>This order is waiting for payment. Your pickup slot is held for 10 minutes from when you ordered.</span>
            {config?.paymentProvider === 'mock' && (
              <button className="btn btn-primary" onClick={() => setPaying(true)}>
                Pay now {rupees(order.totalPaise)}
              </button>
            )}
          </div>
        )}

        <div className="card row-between">
          <div className="stack-sm" style={{ gap: 2 }}>
            <span className="tiny muted bold" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pickup code</span>
            <span className="code-big">{order.code}</span>
            <span className="small muted bold">
              {order.canteen.name} · slot {order.slotLabel}
            </span>
          </div>
          <div className="shelf-box" aria-label={order.shelf ? `Shelf ${order.shelf}` : 'Shelf assigned when ready'}>
            <span className="l">Shelf</span>
            <span className="n">{order.shelf ?? '–'}</span>
          </div>
        </div>

        {active && (
          <div className="card stack">
            <div className="row-between">
              <h3>Estimated</h3>
              <span className="bold" style={{ color: order.status === 'ready' ? 'var(--quiet)' : undefined }}>
                {order.status === 'ready' ? 'Ready now' : order.etaAt ? `${clock(order.etaAt)}${etaMin !== null && etaMin > 0 ? ` · in about ${etaMin} min` : ''}` : order.slotLabel}
              </span>
            </div>
            <Steps order={order} />
          </div>
        )}
        {order.status === 'collected' && <Steps order={order} />}

        {active && order.status !== 'ready' && push === 'off' && config?.vapidPublicKey && (
          <button className="btn btn-outline btn-block" onClick={turnOnAlerts}>
            <Icon name="bell" /> Alert me when it's ready
          </button>
        )}
        {active && push === 'on' && <p className="small muted center">Alerts are on. We'll remind you every 2 minutes until you collect.</p>}

        {order.status === 'collected' && !order.reviewed && <Rating order={order} onDone={(o) => { setOrder(o); showToast('Thanks! Your rating was shared with the canteen.'); }} />}
        {order.status === 'collected' && order.reviewed && <div className="banner banner-ok">Thanks for rating this order.</div>}

        <div className="card stack-sm">
          {order.items.map((it) => (
            <div key={it.menuItemId} className="row-between">
              <span>
                {it.qty} × {it.name}
              </span>
              <span className="bold">{rupees(it.unitPricePaise * it.qty)}</span>
            </div>
          ))}
          <div className="row-between small muted bold"><span>Skip-the-queue fee</span><span>{rupees(order.feePaise)}</span></div>
          <div className="row-between bold"><span>Total paid</span><span>{rupees(order.totalPaise)}</span></div>
        </div>

        {(order.status === 'placed' || order.status === 'pending_payment') && (
          <button className="btn btn-danger btn-block" onClick={cancel}>
            Cancel order
          </button>
        )}
      </div>
      {paying && order.status === 'pending_payment' && (
        <MockPayment
          order={order}
          onPaid={(paid) => {
            setOrder(paid);
            setPaying(false);
            showToast('Paid. Your order is with the kitchen.');
          }}
          onClose={() => setPaying(false)}
        />
      )}
      {toast}
    </div>
  );
}
