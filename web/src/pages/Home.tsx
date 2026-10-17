import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { reportShown, useLive, useNow } from '../live';
import { useSession } from '../session';
import type { Canteen, Order } from '../types';
import { clock, crowdWord, WEEKDAYS } from '../format';
import { CrowdMeter, ErrorBanner, Icon, Spinner, StatusPill, TabBar } from '../components/ui';
import { CampusMap, walkLabel, type LatLon } from '../components/CampusMap';

interface TimetableEntry {
  weekday: number;
  start: string;
  end: string;
  title: string;
}

const ACTIVE = ['pending_payment', 'placed', 'cooking', 'ready'];

function istNow(now: number): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return { weekday: WEEKDAYS.indexOf(get('weekday')), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function toMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function Home() {
  const { user } = useSession();
  const navigate = useNavigate();
  const now = useNow(30_000);
  const [canteens, setCanteens] = useState<Canteen[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<LatLon | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  function locate() {
    if (!('geolocation' in navigator)) {
      setLocError('Location is not available in this browser.');
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setMe({ lat: p.coords.latitude, lon: p.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocError('Could not get your location. Check location permission for this site.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  const load = useCallback(() => {
    api<{ canteens: Canteen[] }>('/canteens')
      .then((r) => {
        setCanteens(r.canteens);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
    if (user) api<{ orders: Order[] }>('/orders').then((r) => setOrders(r.orders)).catch(() => undefined);
  }, [user]);

  useEffect(() => {
    load();
    if (user) api<{ entries: TimetableEntry[] }>('/me/timetable').then((r) => setTimetable(r.entries)).catch(() => undefined);
  }, [user, load]);

  const connected = useLive({
    canteen: (c: Canteen & { change?: { id: string } }) => {
      setCanteens((list) => (list ? list.map((x) => (x.id === c.id ? c : x)) : list));
      reportShown(c);
    },
    menu: (m: { change?: { id: string } }) => reportShown(m),
    order: (o: Order) => setOrders((list) => [o, ...list.filter((x) => x.id !== o.id)]),
  }, {}, { resync: load, pollMs: 20_000 });

  const active = orders.filter((o) => ACTIVE.includes(o.status));
  const outlets = (canteens ?? []).filter((c) => c.kind === 'canteen');
  const messes = (canteens ?? []).filter((c) => c.kind === 'mess');
  const best = useMemo(() => {
    const open = (canteens ?? []).filter((c) => c.kind === 'canteen' && c.status.acceptingOrders);
    return open.sort((a, b) => a.crowd.waitMinutes - b.crowd.waitMinutes || a.crowd.ratio - b.crowd.ratio)[0] ?? null;
  }, [canteens]);

  const classLine = useMemo(() => {
    const t = istNow(now);
    const today = timetable.filter((e) => e.weekday === t.weekday).sort((a, b) => toMin(a.start) - toMin(b.start));
    const current = today.find((e) => toMin(e.start) <= t.minutes && t.minutes < toMin(e.end));
    const next = today.find((e) => toMin(e.start) > t.minutes);
    if (current) return `${current.title || 'Class'} ends ${current.end}${next ? ` · next at ${next.start}` : ''}`;
    if (next) return `Free until ${next.start} (${next.title || 'class'})`;
    return null;
  }, [timetable, now]);

  const greeting = user?.name ? `Hi ${user.name.split(' ')[0]}, what's for ${istNow(now).minutes < 660 ? 'breakfast' : istNow(now).minutes < 960 ? 'lunch' : 'dinner'}?` : 'What are you eating today?';

  return (
    <div className="app">
      <div className="page">
        <div className="row-between">
          <div className="stack-sm">
            <span className="small muted bold row">
              <span className={`live-dot${connected ? '' : ' off'}`} /> {connected ? `Live · ${clock(now)}` : 'Reconnecting…'}
            </span>
            <h1>{greeting}</h1>
          </div>
          {!user && (
            <Link className="btn btn-sm btn-outline" to="/login">
              Sign in
            </Link>
          )}
        </div>

        {user && user.role !== 'student' && (
          <div className="row wrap">
            <Link className="btn btn-sm btn-plain" to="/kitchen">
              Kitchen screen
            </Link>
            {user.role === 'admin' && (
              <Link className="btn btn-sm btn-plain" to="/admin">
                Admin
              </Link>
            )}
          </div>
        )}

        {active.map((o) => (
          <Link key={o.id} to={`/orders/${o.id}`} className={`banner ${o.status === 'ready' ? 'banner-ready' : 'banner-info'}`}>
            <Icon name={o.status === 'ready' ? 'bell' : 'clock'} />
            <span>
              {o.status === 'ready'
                ? `${o.code} is ready at ${o.canteen.name}${o.shelf ? `, Shelf ${o.shelf}` : ''}. Tap to see it.`
                : o.status === 'pending_payment'
                  ? `${o.code} is waiting for payment.`
                  : `${o.code} · ${o.status === 'cooking' ? 'cooking now' : 'sent to the kitchen'} · pickup ${o.slotLabel}`}
            </span>
          </Link>
        ))}

        {classLine && (
          <div className="card card-tight row">
            <Icon name="calendar" />
            <div className="stack-sm" style={{ gap: 0 }}>
              <span className="bold small">{classLine}</span>
              <span className="tiny muted">From your timetable. Pickup times will fit around it.</span>
            </div>
          </div>
        )}

        <ErrorBanner error={error} />
        {!canteens && !error && <Spinner />}

        {best && (
          <div className="hero">
            <span className="eyebrow">Shortest wait right now</span>
            <div className="stack-sm">
              <h2 style={{ fontSize: 22 }}>{best.name}</h2>
              <span className="small" style={{ opacity: 0.92 }}>
                {crowdWord(best.crowd.level)} · about {best.crowd.waitMinutes} min wait · {best.location}
              </span>
            </div>
            <button className="btn" style={{ alignSelf: 'flex-start', background: '#fff', color: 'var(--accent)' }} onClick={() => navigate(`/c/${best.id}`)}>
              See menu
            </button>
          </div>
        )}

        {canteens && (
          <>
            <div className="row-between">
              <h2>Canteens</h2>
              <span className="tiny muted bold">Crowd from door counters and the kitchen queue</span>
            </div>
            <div style={{ position: 'relative' }}>
              <CampusMap canteens={canteens} me={me} onSelect={(cid) => navigate(`/c/${cid}`)} />
              <div className="map-actions">
                <button className="btn btn-sm btn-plain" onClick={locate} disabled={locating} aria-label="Show my location and walking times">
                  <Icon name="pin" size={16} /> {locating ? 'Finding you…' : me ? 'Update location' : 'Near me'}
                </button>
              </div>
            </div>
            <div className="legend">
              <span><i className="bg-quiet" />Quiet</span>
              <span><i className="bg-moderate" />Moderate</span>
              <span><i className="bg-busy" />Busy</span>
              <span><i className="bg-closed" />Closed</span>
              <span><i className="bg-mess" />Mess</span>
            </div>
            {locError && <div className="banner banner-warn small">{locError}</div>}
            {outlets.map((c) => (
              <Link key={c.id} to={`/c/${c.id}`} className={`card card-link stack${c.status.state === 'open' ? '' : ' card-dim'}`}>
                <div className="row-between">
                  <h3 style={{ fontSize: 17 }}>{c.name}</h3>
                  <StatusPill canteen={c} />
                </div>
                <span className="small muted">
                  <Icon name="pin" size={14} /> {c.location}
                  {me && walkLabel(me, c) ? <strong> · {walkLabel(me, c)}</strong> : null}
                  {c.status.todayHours ? ` · today ${c.status.todayHours}` : ' · closed today'}
                </span>
                <CrowdMeter canteen={c} />
              </Link>
            ))}

            {messes.length > 0 && (
              <>
                <div className="stack-sm" style={{ marginTop: 8 }}>
                  <h2>Messes</h2>
                  <span className="tiny muted bold">Meals are booked in advance on the Mess Portal, not here.</span>
                </div>
                {messes.map((c) => (
                  <Link key={c.id} to={`/c/${c.id}`} className="card card-link card-tight stack-sm">
                    <div className="row-between">
                      <span className="bold">{c.name}</span>
                      <span className={`pill pill-${c.status.state === 'open' ? 'open' : 'closed'}`}>{c.status.label}</span>
                    </div>
                    <span className="small muted">
                      <Icon name="pin" size={14} /> {c.location}
                      {me && walkLabel(me, c) ? <strong> · {walkLabel(me, c)}</strong> : null}
                    </span>
                    {c.status.todayHours && <span className="tiny muted bold">Meals today: {c.status.todayHours}</span>}
                  </Link>
                ))}
              </>
            )}
          </>
        )}
      </div>
      <TabBar hasActiveOrder={active.length > 0} />
    </div>
  );
}
