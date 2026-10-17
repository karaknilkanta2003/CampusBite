import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import type { Order } from '../types';
import { rupees } from '../format';
import { Icon } from './ui';

type Stage = 'choose' | 'processing' | 'success' | 'failed';

const UPI_ID = /^[a-z0-9._-]{2,}@[a-z]{2,}$/i;

/**
 * Demo UPI payment sheet, shown when the server runs with PAYMENT_PROVIDER=mock.
 * It walks through the same steps as a real UPI payment (choose app or enter UPI ID,
 * approve, confirmation) but no money moves. With Razorpay configured, the real
 * Razorpay checkout opens instead and this sheet is never shown.
 */
export function MockPayment({
  order,
  onPaid,
  onClose,
}: {
  order: Order;
  onPaid: (order: Order) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>('choose');
  const [method, setMethod] = useState<'app' | 'id'>('app');
  const [upiId, setUpiId] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Close on Escape while choosing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stage === 'choose' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, onClose]);

  async function pay(e?: FormEvent, fail = false) {
    e?.preventDefault();
    setError(null);
    if (method === 'id' && !UPI_ID.test(upiId.trim())) {
      setError('Enter a UPI ID like name@okbank');
      return;
    }
    setStage('processing');
    // A real UPI app takes a moment to approve; mimic that.
    await new Promise((r) => setTimeout(r, 1800));
    if (fail) {
      setStage('failed');
      return;
    }
    try {
      const r = await api<{ order: Order }>(`/orders/${order.id}/pay/mock`, { method: 'POST', body: {} });
      setStage('success');
      setTimeout(() => onPaid(r.order), 1200);
    } catch (err) {
      setStage('failed');
      setError(err instanceof ApiError ? err.message : 'Payment could not be confirmed');
    }
  }

  const items = order.items.reduce((n, i) => n + i.qty, 0);

  return (
    <div className="pay-backdrop" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <div className="pay-sheet">
        <div className="row-between">
          <div className="stack-sm" style={{ gap: 0 }}>
            <span className="tiny muted bold" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              CampusBite · {order.canteen.name}
            </span>
            <h2 id="pay-title" style={{ fontSize: 22 }}>
              {rupees(order.totalPaise)}
            </h2>
            <span className="small muted">
              Order {order.code} · {items} item{items === 1 ? '' : 's'} · pickup {order.slotLabel}
            </span>
          </div>
          {stage === 'choose' && (
            <button className="icon-btn" aria-label="Close payment" onClick={onClose}>
              <Icon name="x" />
            </button>
          )}
        </div>

        <div className="pay-demo-note">Demo payment: no money is charged. A live deployment uses Razorpay UPI here.</div>

        {stage === 'choose' && (
          <form className="stack" onSubmit={(e) => pay(e)}>
            <div className="stack-sm" role="radiogroup" aria-label="Payment method">
              <button type="button" role="radio" aria-checked={method === 'app'} className={`pay-option${method === 'app' ? ' selected' : ''}`} onClick={() => setMethod('app')}>
                <span className="pay-radio" />
                <div className="stack-sm" style={{ gap: 0 }}>
                  <span className="bold">Pay with a UPI app</span>
                  <span className="tiny muted">Approve the request in your UPI app</span>
                </div>
              </button>
              <button type="button" role="radio" aria-checked={method === 'id'} className={`pay-option${method === 'id' ? ' selected' : ''}`} onClick={() => setMethod('id')}>
                <span className="pay-radio" />
                <div className="stack-sm" style={{ gap: 0 }}>
                  <span className="bold">Enter UPI ID</span>
                  <span className="tiny muted">We send a collect request to your UPI ID</span>
                </div>
              </button>
            </div>

            {method === 'id' && (
              <div className="field">
                <label htmlFor="upi">UPI ID</label>
                <input id="upi" className="input" placeholder="name@okbank" autoComplete="off" value={upiId} onChange={(e) => setUpiId(e.target.value)} />
              </div>
            )}

            <div className="card card-tight stack-sm small">
              {order.items.map((i) => (
                <div key={i.menuItemId} className="row-between">
                  <span>
                    {i.qty} × {i.name}
                  </span>
                  <span>{rupees(i.unitPricePaise * i.qty)}</span>
                </div>
              ))}
              <div className="row-between muted">
                <span>Skip-the-queue fee</span>
                <span>{rupees(order.feePaise)}</span>
              </div>
              <div className="row-between bold">
                <span>Total</span>
                <span>{rupees(order.totalPaise)}</span>
              </div>
            </div>

            {error && (
              <div className="banner banner-err" role="alert">
                {error}
              </div>
            )}
            <button className="btn btn-primary btn-lg btn-block">Pay {rupees(order.totalPaise)}</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => pay(undefined, true)}>
              Demo: simulate a failed payment
            </button>
          </form>
        )}

        {stage === 'processing' && (
          <div className="pay-status">
            <div className="spinner" style={{ margin: '8px auto' }} />
            <span className="bold">{method === 'id' ? `Waiting for approval on ${upiId.trim()}…` : 'Waiting for approval in your UPI app…'}</span>
            <span className="small muted">Your pickup slot is held for 10 minutes.</span>
          </div>
        )}

        {stage === 'success' && (
          <div className="pay-status">
            <span className="pay-tick">
              <Icon name="check" size={34} stroke={3} />
            </span>
            <span className="bold" style={{ fontSize: 18 }}>
              Payment successful
            </span>
            <span className="small muted">
              {rupees(order.totalPaise)} paid · order {order.code} sent to the kitchen
            </span>
          </div>
        )}

        {stage === 'failed' && (
          <div className="pay-status">
            <span className="pay-tick fail">
              <Icon name="x" size={30} stroke={3} />
            </span>
            <span className="bold" style={{ fontSize: 18 }}>
              Payment failed
            </span>
            <span className="small muted">{error ?? 'No money was taken. Your slot is still held for a few minutes.'}</span>
            <div className="row" style={{ width: '100%' }}>
              <button className="btn btn-plain grow" onClick={onClose}>
                Pay later
              </button>
              <button className="btn btn-primary grow" onClick={() => setStage('choose')}>
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
