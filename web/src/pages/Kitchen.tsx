import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useLive, useNow } from '../live';
import { useSession } from '../session';
import type { Canteen, MenuItem, Order, Slot } from '../types';
import { clock, minutesFromNow } from '../format';
import { Spinner, useToast } from '../components/ui';

interface KitchenData {
  canteen: Canteen;
  manualStatus: 'auto' | 'open' | 'closed';
  orders: Order[];
  recent: Order[];
  menu: MenuItem[];
  slots: Slot[];
}

export function KitchenRedirect() {
  const { user } = useSession();
  const [canteens, setCanteens] = useState<Canteen[]>([]);
  useEffect(() => {
    if (user?.role === 'admin') api<{ canteens: Canteen[] }>('/canteens').then((r) => setCanteens(r.canteens.filter((c) => c.kind === 'canteen')));
  }, [user]);
  if (!user) return <Navigate to="/login?next=/kitchen" replace />;
  if (user.role === 'staff' && user.canteenId) return <Navigate to={`/kitchen/${user.canteenId}`} replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return (
    <div className="app">
      <div className="page">
        <h1>Open a kitchen screen</h1>
        {canteens.map((c) => (
          <Link key={c.id} className="card card-link" to={`/kitchen/${c.id}`}>
            <strong>{c.name}</strong> <span className="muted small">· {c.location}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Short chime for new orders, generated so no audio file is needed. */
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
  } catch {
    // audio blocked until the first tap; fine
  }
}

const COLUMNS = [
  { status: 'placed', title: 'New', hint: 'Start cooking. The student sees "Cooking".', next: 'cooking', action: 'Start cooking', btn: 'btn-primary', badge: { background: 'var(--accent-soft)', color: 'var(--accent-soft-ink)' } },
  { status: 'cooking', title: 'Cooking', hint: 'Mark ready to send an alert and assign a shelf.', next: 'ready', action: 'Mark ready', btn: 'btn-warn', badge: { background: 'var(--warn-soft)', color: 'var(--warn-ink)' } },
  { status: 'ready', title: 'Ready on shelf', hint: 'Students are reminded every 2 minutes.', next: 'collected', action: 'Collected', btn: 'btn-ok', badge: { background: 'var(--ok-soft)', color: 'var(--ok-ink)' } },
] as const;

export function Kitchen() {
  const { id = '' } = useParams();
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const now = useNow(20_000);
  const wrongKitchen = !!user && user.role === 'staff' && user.canteenId !== id;

  /** Sign out and come back to this kitchen screen as someone else. */
  async function switchAccount() {
    await signOut();
    navigate(`/login?next=/kitchen/${id}`, { replace: true });
  }
  const [data, setData] = useState<KitchenData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [lookup, setLookup] = useState('');
  const [found, setFound] = useState<Order | null>(null);
  const [toast, showToast] = useToast();
  const known = useRef(new Set<number>());

  const load = useCallback(() => {
    api<KitchenData>(`/kitchen/${id}`)
      .then((d) => {
        d.orders.forEach((o) => known.current.add(o.id));
        setData(d);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!user || wrongKitchen) return;
    load();
    const refresh = setInterval(load, 60_000);
    const beat = () => api(`/kitchen/${id}/heartbeat`, { method: 'POST', body: {} }).catch(() => undefined);
    void beat();
    const hb = setInterval(beat, 30_000);
    // Keep the tablet screen awake during service.
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    return () => {
      clearInterval(refresh);
      clearInterval(hb);
      void lock?.release();
    };
  }, [id, user, wrongKitchen, load]);

  const connected = useLive(
    {
      order: (o: Order) => {
        if (!known.current.has(o.id) && o.status === 'placed') {
          known.current.add(o.id);
          chime();
        }
        setData((d) => {
          if (!d) return d;
          const isActive = ['placed', 'cooking', 'ready'].includes(o.status);
          const orders = d.orders.filter((x) => x.id !== o.id);
          if (isActive) orders.push(o);
          orders.sort((a, b) => a.slotStart - b.slotStart || a.id - b.id);
          const recent = isActive ? d.recent : [o, ...d.recent.filter((x) => x.id !== o.id)].slice(0, 30);
          return { ...d, orders, recent };
        });
      },
      canteen: (c: Canteen) => c.id === id && setData((d) => (d ? { ...d, canteen: c } : d)),
      menu: (m: { canteenId: string; items: MenuItem[] }) => m.canteenId === id && setData((d) => (d ? { ...d, menu: m.items } : d)),
    },
    { kitchen: id },
    { resync: load, pollMs: 10_000 },
  );

  if (!user) return <Navigate to={`/login?next=/kitchen/${id}`} replace />;
  if (wrongKitchen) {
    return (
      <div className="app">
        <div className="page">
          <h1>This is another canteen's kitchen</h1>
          <div className="card stack">
            <p>
              You're signed in as <strong>{user.email}</strong>, the kitchen account for <strong>{user.canteenId}</strong>. Each kitchen account can only run its own canteen, so orders are never handled by the wrong staff.
            </p>
            <div className="row wrap">
              <Link className="btn btn-primary" to={`/kitchen/${user.canteenId}`}>Open my kitchen</Link>
              <button className="btn btn-plain" onClick={switchAccount}>Sign in as this canteen's staff</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="app">
        <div className="page">
          <div className="banner banner-err">{error}</div>
          <div className="row wrap">
            <button className="btn btn-plain" onClick={switchAccount}>Sign in with another account</button>
            <Link className="btn btn-plain" to="/">Home</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!data) return <Spinner />;

  async function advance(o: Order, to: string) {
    setBusyId(o.id);
    try {
      await api(`/kitchen/orders/${o.id}/advance`, { body: { to } });
      if (found?.id === o.id) setFound(null);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not update');
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(o: Order) {
    const reason = prompt(`Why cancel ${o.code}? The student is refunded and sees this reason.`, 'An item ran out');
    if (!reason) return;
    try {
      await api(`/kitchen/orders/${o.id}/cancel`, { body: { reason } });
      showToast(`${o.code} cancelled and refunded`);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not cancel');
    }
  }

  async function setMode(mode: 'auto' | 'open' | 'closed') {
    try {
      const r = await api<{ canteen: Canteen; manualStatus: KitchenData['manualStatus'] }>(`/kitchen/${id}/status`, { body: { mode } });
      setData((d) => (d ? { ...d, canteen: r.canteen, manualStatus: r.manualStatus } : d));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not change status');
    }
  }

  async function toggle(item: MenuItem) {
    try {
      const r = await api<{ menu: MenuItem[] }>(`/kitchen/${id}/menu/${item.id}`, { method: 'PATCH', body: { available: !item.available } });
      setData((d) => (d ? { ...d, menu: r.menu } : d));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not update the menu');
    }
  }

  async function findCode(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ order: Order }>(`/kitchen/${id}/lookup/${encodeURIComponent(lookup.trim())}`);
      setFound(r.order);
    } catch (err) {
      setFound(null);
      showToast(err instanceof ApiError ? err.message : 'Not found');
    }
  }

  const { canteen } = data;
  const modeLabel = { auto: 'Hours', open: 'Open', closed: 'Closed' } as const;

  return (
    <div className="kds">
      <div className="kds-top">
        <div className="row wrap" style={{ gap: 14 }}>
          <span style={{ fontSize: 22, fontWeight: 800 }}>{canteen.name}</span>
          <span className="small" style={{ opacity: 0.75 }}>
            Kitchen · {clock(now)} · <span className={`live-dot${connected ? '' : ' off'}`} /> {connected ? 'live' : 'reconnecting'}
          </span>
          <span className="small" style={{ opacity: 0.75 }}>
            Signed in as {user.email}
            {user.role === 'admin' && (
              <>
                {' · '}
                <Link to="/kitchen" style={{ color: '#9db2ff' }}>other kitchens</Link>
              </>
            )}
          </span>
          <button className="btn btn-sm" style={{ background: '#26303f', color: '#fff' }} onClick={switchAccount}>Switch account</button>
        </div>
        <div className="row wrap">
          <span className="small" style={{ opacity: 0.75 }}>Students see: <strong style={{ opacity: 1 }}>{canteen.status.label}</strong></span>
          <div className="seg" role="group" aria-label="Canteen status">
            {(['auto', 'open', 'closed'] as const).map((m) => (
              <button key={m} className={data.manualStatus === m ? `on-${m}` : ''} aria-pressed={data.manualStatus === m} onClick={() => setMode(m)}>
                {modeLabel[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="kds-body">
        <div className="kds-cols">
          {COLUMNS.map((col) => {
            const list = data.orders.filter((o) => o.status === col.status);
            return (
              <section key={col.status} className="kds-col" aria-label={col.title}>
                <div className="row-between">
                  <h2>{col.title}</h2>
                  <span className="kds-count" style={col.badge}>{list.length}</span>
                </div>
                <span className="tiny muted bold">{col.hint}</span>
                {list.length === 0 && <span className="small faint">Nothing here.</span>}
                {list.map((o) => {
                  const toSlot = minutesFromNow(o.slotStart, now);
                  const late = col.status !== 'ready' && toSlot < -3;
                  return (
                    <article key={o.id} className={`ticket${late ? ' late' : ''}${col.status === 'ready' ? ' ready' : ''}`}>
                      <div className="row-between">
                        <span className="ticket-code">{o.code}</span>
                        <span className={`pill ${late ? 'pill-closed' : 'pill-soft'}`} style={late ? { background: 'var(--err-soft)', color: 'var(--err-ink)' } : undefined}>
                          Slot {o.slotLabel}
                          {col.status !== 'ready' && ` · ${late ? `${-toSlot} min late` : toSlot > 0 ? `in ${toSlot} min` : 'now'}`}
                        </span>
                      </div>
                      <div className="stack-sm" style={{ gap: 2 }}>
                        {o.items.map((it) => (
                          <span key={it.menuItemId} style={{ fontWeight: 700 }}>
                            {it.qty} × {it.name}
                          </span>
                        ))}
                      </div>
                      <span className="tiny muted bold">
                        {o.customerName}
                        {o.shelf ? ` · Shelf ${o.shelf}` : ''}
                      </span>
                      <div className="row">
                        <button className={`btn ${col.btn} grow`} style={{ minHeight: 50 }} disabled={busyId === o.id} onClick={() => advance(o, col.next)}>
                          {col.action}
                        </button>
                        {col.status !== 'ready' && (
                          <button className="btn btn-danger" style={{ minHeight: 50 }} onClick={() => cancel(o)} aria-label={`Cancel ${o.code}`}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>

        <aside className="kds-side">
          <form className="card stack-sm" onSubmit={findCode}>
            <h3>Find an order by code</h3>
            <div className="row">
              <input className="input input-sm grow mono" placeholder={`${canteen.name[0]}-07`} value={lookup} onChange={(e) => setLookup(e.target.value)} aria-label="Pickup code" />
              <button className="btn btn-sm btn-primary">Find</button>
            </div>
            {found && (
              <div className="stack-sm small">
                <strong>
                  {found.code} · {found.status} · {found.customerName}
                </strong>
                <span>{found.items.map((i) => `${i.qty} × ${i.name}`).join(', ')}</span>
                {found.status === 'ready' && (
                  <button type="button" className="btn btn-sm btn-ok" onClick={() => advance(found, 'collected')}>
                    Hand over · mark collected
                  </button>
                )}
              </div>
            )}
          </form>

          <div className="card stack-sm">
            <h3>Next pickup slots</h3>
            {data.slots.slice(0, 6).map((s) => (
              <div key={s.start} className="stack-sm" style={{ gap: 3 }}>
                <div className="row-between small bold">
                  <span className="mono">{s.label}</span>
                  <span style={{ color: s.full ? 'var(--busy)' : s.remaining < 6 ? 'var(--moderate)' : 'var(--muted)' }}>{s.full ? 'Full' : `${s.booked} / ${s.capacity}`}</span>
                </div>
                <div className="slot-bar">
                  <div className={s.remaining < 6 ? 'low' : ''} style={{ width: `${Math.round((s.booked / s.capacity) * 100)}%` }} />
                </div>
              </div>
            ))}
            {data.slots.length === 0 && <span className="small muted">No more slots today.</span>}
            <span className="tiny muted">Cap per slot = 85% of what this kitchen finishes in 10 minutes ({canteen.slotCapacity} orders).</span>
          </div>

          <div className="card stack-sm">
            <h3>Menu today</h3>
            <span className="tiny muted">Tap to mark sold out. Students see it within seconds.</span>
            {data.menu.map((m) => (
              <button key={m.id} className="menu-toggle" onClick={() => toggle(m)} aria-pressed={!m.available}>
                <span className="bold" style={{ color: m.available ? 'var(--ink)' : 'var(--faint)' }}>{m.name}</span>
                <span className={`pill ${m.available ? 'pill-open' : ''}`} style={m.available ? undefined : { background: 'var(--err-soft)', color: 'var(--err-ink)' }}>
                  {m.available ? 'Available' : 'Sold out'}
                </span>
              </button>
            ))}
          </div>

          {data.recent.length > 0 && (
            <div className="card stack-sm">
              <h3>Done today</h3>
              {data.recent.slice(0, 8).map((o) => (
                <div key={o.id} className="row-between small">
                  <span className="mono bold">{o.code}</span>
                  <span className="muted">{o.status === 'collected' ? `collected ${o.collectedAt ? clock(o.collectedAt) : ''}` : o.status}</span>
                </div>
              ))}
            </div>
          )}
          <Link className="small" to={`/board/${id}`} target="_blank">
            Open the pickup board for the counter screen ↗
          </Link>
        </aside>
      </div>
      {toast}
    </div>
  );
}
