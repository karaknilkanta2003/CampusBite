import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import type { MenuItem, User } from '../types';
import { day, pct, rupees, WEEKDAYS } from '../format';
import { ErrorBanner, Spinner, useToast } from '../components/ui';

interface AdminCanteen {
  id: string;
  name: string;
  location: string;
  orderPrefix: string;
  seats: number;
  shelfCount: number;
  slotMinutes: number;
  throughputPer10Min: number;
  capacityFactor: number;
  kind: 'canteen' | 'mess';
  lat: number | null;
  lon: number | null;
  acceptsOrders: boolean;
  sort: number;
  manualStatus: string;
  lastHeartbeatAt: number | null;
  calibratedAt: number | null;
  hours: { weekday: number; open: string; close: string }[];
  sensors: { id: number; label: string; lastSeenAt: number | null }[];
}

interface Metrics {
  days: number;
  totals: {
    orders: number;
    revenuePaise: number;
    uniqueStudents: number;
    onTimeRate: number | null;
    repeatRate7d: number | null;
    repeatEligible: number;
    cancelRate: number | null;
    medianPrepMinutes: number | null;
    statusUpdate: { samples: number; p95Seconds: number | null; within30sRate: number | null; over60s: number };
    avgRating: number | null;
    ratings: number;
  };
  byDay: { day: number; orders: number; revenuePaise: number; onTimeRate: number | null }[];
  topItems: { name: string; qty: number; rating: number | null }[];
  thresholds: { onTimeRate: { keepGoing: number; changeDirection: number }; repeatRate7d: { keepGoing: number; changeDirection: number } };
}

function useCanteens() {
  const [canteens, setCanteens] = useState<AdminCanteen[] | null>(null);
  const reload = useCallback(() => {
    api<{ canteens: AdminCanteen[] }>('/admin/canteens').then((r) => setCanteens(r.canteens));
  }, []);
  useEffect(reload, [reload]);
  return { canteens, reload, setCanteens };
}

function verdict(value: number | null, t: { keepGoing: number; changeDirection: number }) {
  if (value === null) return { text: 'Not enough data yet', color: 'var(--muted)' };
  if (value >= t.keepGoing) return { text: `Keep going (target ${pct(t.keepGoing)})`, color: 'var(--quiet)' };
  if (value < t.changeDirection) return { text: `Change direction (below ${pct(t.changeDirection)})`, color: 'var(--busy)' };
  return { text: `In between: iterate (target ${pct(t.keepGoing)})`, color: 'var(--moderate)' };
}

/* ---------------- Metrics ---------------- */
function MetricsPage({ canteens }: { canteens: AdminCanteen[] }) {
  const [canteenId, setCanteenId] = useState('');
  const [days, setDays] = useState(14);
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setM(null);
    api<Metrics>(`/admin/metrics?days=${days}${canteenId ? `&canteenId=${canteenId}` : ''}`)
      .then(setM)
      .catch((e: Error) => setError(e.message));
  }, [canteenId, days]);

  const max = Math.max(1, ...(m?.byDay.map((d) => d.orders) ?? [1]));
  const onTime = m ? verdict(m.totals.onTimeRate, m.thresholds.onTimeRate) : null;
  const repeat = m ? verdict(m.totals.repeatRate7d, m.thresholds.repeatRate7d) : null;

  return (
    <>
      <div className="row-between wrap">
        <div className="stack-sm">
          <h1>Trial metrics</h1>
          <p className="small muted">The pivot-or-persevere numbers from the Build-Measure-Learn plan.</p>
        </div>
        <div className="row wrap">
          <select className="input input-sm" style={{ width: 'auto' }} value={canteenId} onChange={(e) => setCanteenId(e.target.value)} aria-label="Canteen">
            <option value="">All canteens</option>
            {canteens.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="input input-sm" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
      </div>
      <ErrorBanner error={error} />
      {!m ? (
        <Spinner />
      ) : (
        <>
          <div className="stats">
            <div className="card stat">
              <div className="k">Ready within 3 min of slot</div>
              <div className="v">{pct(m.totals.onTimeRate)}</div>
              <div className="t" style={{ color: onTime!.color }}>{onTime!.text}</div>
            </div>
            <div className="card stat">
              <div className="k">Reorder within 7 days</div>
              <div className="v">{pct(m.totals.repeatRate7d)}</div>
              <div className="t" style={{ color: repeat!.color }}>{repeat!.text}</div>
            </div>
            <div className="card stat">
              <div className="k">Paid orders</div>
              <div className="v">{m.totals.orders}</div>
              <div className="t muted">{m.totals.uniqueStudents} students</div>
            </div>
            <div className="card stat">
              <div className="k">Revenue (incl. fees)</div>
              <div className="v">{rupees(m.totals.revenuePaise)}</div>
            </div>
            <div className="card stat">
              <div className="k">Status updates within 30 s (H1)</div>
              <div className="v">{pct(m.totals.statusUpdate.within30sRate)}</div>
              <div className="t" style={{ color: m.totals.statusUpdate.within30sRate === null ? 'var(--muted)' : m.totals.statusUpdate.within30sRate >= 0.95 ? 'var(--quiet)' : 'var(--busy)' }}>
                {m.totals.statusUpdate.samples
                  ? `Target 95% · P95 ${m.totals.statusUpdate.p95Seconds} s · ${m.totals.statusUpdate.over60s} over 60 s · ${m.totals.statusUpdate.samples} samples`
                  : 'No kitchen changes measured yet'}
              </div>
            </div>
            <div className="card stat">
              <div className="k">Median cooking time</div>
              <div className="v">{m.totals.medianPrepMinutes === null ? '—' : `${m.totals.medianPrepMinutes} min`}</div>
            </div>
            <div className="card stat">
              <div className="k">Average dish rating</div>
              <div className="v">{m.totals.avgRating ?? '—'}</div>
              <div className="t muted">{m.totals.ratings} ratings · {pct(m.totals.cancelRate)} cancelled</div>
            </div>
          </div>

          <div className="card stack">
            <h2>Orders per day</h2>
            <div className="bars" role="img" aria-label="Orders per day">
              {m.byDay.map((d) => (
                <div key={d.day} className="bar" title={`${day(d.day)}: ${d.orders} orders, ${pct(d.onTimeRate)} on time`}>
                  <span className="bold" style={{ color: 'var(--ink)' }}>{d.orders || ''}</span>
                  <div style={{ height: `${(d.orders / max) * 100}px` }} />
                  <span>{day(d.day).split(',')[0]}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card stack">
            <h2>Top dishes</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Dish</th>
                    <th>Sold</th>
                    <th>Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {m.topItems.map((t) => (
                    <tr key={t.name}>
                      <td>{t.name}</td>
                      <td>{t.qty}</td>
                      <td style={{ color: t.rating !== null && t.rating < 3.5 ? 'var(--busy)' : undefined }}>{t.rating ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------- Canteens ---------------- */
type HoursWindow = { weekday: number; open: string; close: string };

/** Accepts "17.446273, 78.349132" as copied from Google Maps. */
function parseCoords(text: string): { lat: number; lon: number } | null | 'invalid' {
  if (!text.trim()) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return 'invalid';
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : 'invalid';
}

function HoursEditor({ hours, setHours }: { hours: HoursWindow[]; setHours: (h: HoursWindow[]) => void }) {
  const sorted = [...hours].sort((a, b) => a.weekday - b.weekday || a.open.localeCompare(b.open));
  const update = (i: number, patch: Partial<HoursWindow>) => setHours(sorted.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  return (
    <div className="stack-sm">
      {sorted.length === 0 && <span className="small muted">No hours: shown as closed every day.</span>}
      {sorted.map((h, i) => (
        <div key={i} className="row wrap">
          <select className="input input-sm" style={{ width: 'auto' }} value={h.weekday} onChange={(e) => update(i, { weekday: Number(e.target.value) })} aria-label="Day">
            {WEEKDAYS.map((d, n) => (
              <option key={d} value={n}>{d}</option>
            ))}
          </select>
          <input className="input input-sm" style={{ width: 'auto' }} type="time" value={h.open} onChange={(e) => update(i, { open: e.target.value })} aria-label="Opens" />
          <span className="muted">to</span>
          <input className="input input-sm" style={{ width: 'auto' }} type="time" value={h.close === '24:00' ? '23:59' : h.close} onChange={(e) => update(i, { close: e.target.value === '23:59' ? '24:00' : e.target.value })} aria-label="Closes" />
          {h.close !== '24:00' && h.close <= h.open && <span className="tiny muted bold">past midnight</span>}
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setHours(sorted.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="row wrap">
        <button type="button" className="btn btn-sm btn-plain" onClick={() => setHours([...sorted, { weekday: sorted.at(-1)?.weekday ?? 1, open: '08:00', close: '20:00' }])}>
          Add a time window
        </button>
        {sorted.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-plain"
            title="Repeat the first day's windows on every day"
            onClick={() => {
              const first = sorted.filter((h) => h.weekday === sorted[0].weekday);
              setHours([0, 1, 2, 3, 4, 5, 6].flatMap((d) => first.map((h) => ({ ...h, weekday: d }))));
            }}
          >
            Same every day
          </button>
        )}
      </div>
      <span className="tiny muted">Use several windows a day for meal times. A closing time earlier than the opening time means it closes after midnight.</span>
    </div>
  );
}

function CanteenEditor({ c, onSaved }: { c: AdminCanteen; onSaved: (c: AdminCanteen) => void }) {
  const [f, setF] = useState(c);
  const [coords, setCoords] = useState(c.lat !== null && c.lon !== null ? `${c.lat}, ${c.lon}` : '');
  const [hours, setHours] = useState<HoursWindow[]>(c.hours);
  const [error, setError] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const num = (k: keyof AdminCanteen) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: Number(e.target.value) });
  const parsed = parseCoords(coords);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (parsed === 'invalid') {
      setError('Map position must look like "17.446273, 78.349132"');
      return;
    }
    try {
      await api(`/admin/canteens/${c.id}`, {
        method: 'PATCH',
        body: {
          name: f.name,
          location: f.location,
          kind: f.kind,
          orderPrefix: f.orderPrefix,
          seats: f.seats,
          shelfCount: f.shelfCount,
          slotMinutes: f.slotMinutes,
          throughputPer10Min: f.throughputPer10Min,
          capacityFactor: f.capacityFactor,
          lat: parsed?.lat ?? null,
          lon: parsed?.lon ?? null,
          acceptsOrders: f.kind === 'canteen' && f.acceptsOrders,
        },
      });
      const r = await api<{ canteen: AdminCanteen }>(`/admin/canteens/${c.id}/hours`, { method: 'PUT', body: { hours } });
      onSaved(r.canteen);
      showToast('Saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    }
  }

  const cap = Math.max(1, Math.floor(f.capacityFactor * f.throughputPer10Min * (f.slotMinutes / 10)));
  const isMess = f.kind === 'mess';

  return (
    <form className="card stack" onSubmit={save}>
      <div className="row-between wrap">
        <h2>{c.name}</h2>
        {!isMess && (
          <span className="small muted">Kitchen last checked in: {c.lastHeartbeatAt ? new Date(c.lastHeartbeatAt).toLocaleTimeString() : 'never'}</span>
        )}
      </div>
      <div className="form-grid">
        <div className="field"><label>Name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field">
          <label>Type</label>
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AdminCanteen['kind'] })}>
            <option value="canteen">Canteen (takes app orders)</option>
            <option value="mess">Mess (shown on map only)</option>
          </select>
        </div>
        <div className="field"><label>Directions (landmark)</label><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
        <div className="field">
          <label>Map position (lat, lon)</label>
          <input className="input mono" placeholder="17.446273, 78.349132" value={coords} onChange={(e) => setCoords(e.target.value)} />
          <span className="tiny muted">
            In Google Maps, right-click the spot and click the numbers to copy them.{' '}
            {parsed && parsed !== 'invalid' && (
              <a href={`https://www.google.com/maps/search/?api=1&query=${parsed.lat},${parsed.lon}`} target="_blank" rel="noreferrer">Check pin ↗</a>
            )}
            {parsed === 'invalid' && <strong style={{ color: 'var(--busy)' }}>Not a valid position</strong>}
          </span>
        </div>
        {!isMess && (
          <>
            <div className="field"><label>Order code letter</label><input className="input" value={f.orderPrefix} maxLength={2} onChange={(e) => setF({ ...f, orderPrefix: e.target.value.toUpperCase() })} /></div>
            <div className="field"><label>Seats (crowd meter)</label><input className="input" type="number" min={1} value={f.seats} onChange={num('seats')} /></div>
            <div className="field"><label>Pickup shelves</label><input className="input" type="number" min={1} max={99} value={f.shelfCount} onChange={num('shelfCount')} /></div>
            <div className="field">
              <label>Slot length</label>
              <select className="input" value={f.slotMinutes} onChange={(e) => setF({ ...f, slotMinutes: Number(e.target.value) })}>
                <option value={5}>5 minutes</option>
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
              </select>
            </div>
            <div className="field"><label>Kitchen finishes per 10 min</label><input className="input" type="number" min={1} value={f.throughputPer10Min} onChange={num('throughputPer10Min')} /></div>
            <div className="field"><label>Capacity factor</label><input className="input" type="number" step={0.05} min={0.3} max={1} value={f.capacityFactor} onChange={num('capacityFactor')} /></div>
          </>
        )}
      </div>
      {!isMess && (
        <>
          <p className="small muted">
            Each slot takes <strong>{cap} orders</strong>. Throughput is re-measured daily from real cooking times once there is a week of data
            {c.calibratedAt ? ` (last check ${new Date(c.calibratedAt).toLocaleDateString()})` : ''}.
          </p>
          <label className="check">
            <input type="checkbox" checked={f.acceptsOrders} onChange={(e) => setF({ ...f, acceptsOrders: e.target.checked })} /> Accept app orders
          </label>
        </>
      )}

      <h3>{isMess ? 'Meal times (IST)' : 'Opening hours (IST)'}</h3>
      <HoursEditor hours={hours} setHours={setHours} />
      <ErrorBanner error={error} />
      <div className="row wrap">
        <button className="btn btn-primary">Save changes</button>
        {!isMess && <Link className="btn btn-plain" to={`/kitchen/${c.id}`}>Kitchen screen</Link>}
        {!isMess && <Link className="btn btn-plain" to={`/board/${c.id}`} target="_blank">Pickup board ↗</Link>}
      </div>
      {toast}
    </form>
  );
}

function NewCanteen({ onCreated }: { onCreated: () => void }) {
  const [f, setF] = useState({ id: '', name: '', location: '', orderPrefix: '', kind: 'canteen' as 'canteen' | 'mess', coords: '' });
  const [error, setError] = useState<string | null>(null);
  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const pos = parseCoords(f.coords);
    if (pos === 'invalid') {
      setError('Map position must look like "17.446273, 78.349132"');
      return;
    }
    try {
      await api('/admin/canteens', {
        body: {
          id: f.id,
          name: f.name,
          location: f.location,
          orderPrefix: f.orderPrefix,
          kind: f.kind,
          lat: pos?.lat ?? null,
          lon: pos?.lon ?? null,
          acceptsOrders: f.kind === 'canteen',
          throughputPer10Min: 20,
        },
      });
      setF({ id: '', name: '', location: '', orderPrefix: '', kind: 'canteen', coords: '' });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create');
    }
  }
  return (
    <form className="card stack" onSubmit={create}>
      <h2>Add a canteen or mess</h2>
      <div className="form-grid">
        <div className="field"><label>Short id (used in links)</label><input className="input" placeholder="tantra" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.toLowerCase() })} required /></div>
        <div className="field"><label>Name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
        <div className="field">
          <label>Type</label>
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'canteen' | 'mess' })}>
            <option value="canteen">Canteen</option>
            <option value="mess">Mess</option>
          </select>
        </div>
        <div className="field"><label>Directions (landmark)</label><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
        <div className="field"><label>Map position (lat, lon)</label><input className="input mono" placeholder="17.446273, 78.349132" value={f.coords} onChange={(e) => setF({ ...f, coords: e.target.value })} /></div>
        <div className="field"><label>Order code letter</label><input className="input" maxLength={2} value={f.orderPrefix} onChange={(e) => setF({ ...f, orderPrefix: e.target.value.toUpperCase() })} required /></div>
      </div>
      <ErrorBanner error={error} />
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Create</button>
      <p className="tiny muted">Then set its hours and menu, and give a staff member access under People.</p>
    </form>
  );
}

function CanteensPage({ canteens, reload, replace }: { canteens: AdminCanteen[]; reload: () => void; replace: (c: AdminCanteen) => void }) {
  return (
    <>
      <h1>Canteens and messes</h1>
      {canteens.map((c) => (
        <CanteenEditor key={c.id} c={c} onSaved={replace} />
      ))}
      <NewCanteen onCreated={reload} />
    </>
  );
}

/* ---------------- Menu ---------------- */
function MenuPage({ canteens }: { canteens: AdminCanteen[] }) {
  const [canteenId, setCanteenId] = useState(canteens[0]?.id ?? '');
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [draft, setDraft] = useState({ name: '', category: 'Main', price: '', veg: true });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canteenId) return;
    setMenu(null);
    api<{ menu: MenuItem[] }>(`/admin/canteens/${canteenId}/menu`).then((r) => setMenu(r.menu));
  }, [canteenId]);

  async function patch(item: MenuItem, body: Record<string, unknown>) {
    setError(null);
    try {
      const r = await api<{ menu: MenuItem[] }>(`/admin/menu/${item.id}`, { method: 'PATCH', body });
      setMenu(r.menu);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ menu: MenuItem[] }>(`/admin/canteens/${canteenId}/menu`, {
        body: { name: draft.name, category: draft.category, pricePaise: Math.round(Number(draft.price) * 100), veg: draft.veg },
      });
      setMenu(r.menu);
      setDraft({ ...draft, name: '', price: '' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add');
    }
  }

  return (
    <>
      <div className="row-between wrap">
        <h1>Menus</h1>
        <select className="input input-sm" style={{ width: 'auto' }} value={canteenId} onChange={(e) => setCanteenId(e.target.value)} aria-label="Canteen">
          {canteens.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <ErrorBanner error={error} />
      {!menu ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Dish</th>
                <th>Category</th>
                <th>Price (₹)</th>
                <th>Veg</th>
                <th>Rating</th>
                <th>Today</th>
                <th>On menu</th>
              </tr>
            </thead>
            <tbody>
              {menu.map((m) => (
                <tr key={m.id} style={{ opacity: m.active ? 1 : 0.5 }}>
                  <td>
                    <input className="input input-sm" defaultValue={m.name} onBlur={(e) => e.target.value !== m.name && patch(m, { name: e.target.value })} aria-label="Dish name" />
                  </td>
                  <td>
                    <input className="input input-sm" style={{ width: 150 }} defaultValue={m.category} onBlur={(e) => e.target.value !== m.category && patch(m, { category: e.target.value })} aria-label="Category" />
                  </td>
                  <td>
                    <input className="input input-sm" style={{ width: 90 }} type="number" min={0} step={1} defaultValue={m.pricePaise / 100} onBlur={(e) => Number(e.target.value) * 100 !== m.pricePaise && patch(m, { pricePaise: Math.round(Number(e.target.value) * 100) })} aria-label="Price" />
                  </td>
                  <td><input type="checkbox" checked={m.veg} onChange={(e) => patch(m, { veg: e.target.checked })} aria-label="Vegetarian" /></td>
                  <td>{m.rating ?? '—'} <span className="muted tiny">({m.ratingCount})</span></td>
                  <td>
                    <button className={`pill ${m.available ? 'pill-open' : 'pill-closed'}`} style={{ border: 'none', cursor: 'pointer' }} onClick={() => patch(m, { available: !m.available })}>
                      {m.available ? 'Available' : 'Sold out'}
                    </button>
                  </td>
                  <td><input type="checkbox" checked={m.active} onChange={(e) => patch(m, { active: e.target.checked })} aria-label="On the menu" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="card stack" onSubmit={add}>
        <h2>Add a dish</h2>
        <div className="form-grid">
          <div className="field"><label>Name</label><input className="input" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <div className="field"><label>Category</label><input className="input" required value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></div>
          <div className="field"><label>Price (₹)</label><input className="input" required type="number" min={0} step="0.5" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></div>
          <label className="check" style={{ alignSelf: 'end', minHeight: 46 }}><input type="checkbox" checked={draft.veg} onChange={(e) => setDraft({ ...draft, veg: e.target.checked })} /> Vegetarian</label>
        </div>
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Add dish</button>
      </form>
    </>
  );
}

/* ---------------- People ---------------- */
function PeoplePage({ canteens }: { canteens: AdminCanteen[] }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ users: User[] }>(`/admin/users?q=${encodeURIComponent(q)}`).then((r) => setUsers(r.users));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function setRole(u: User, role: string, canteenId: string | null) {
    setError(null);
    try {
      const r = await api<{ user: User }>(`/admin/users/${u.id}`, { method: 'PATCH', body: { role, canteenId } });
      setUsers((list) => list?.map((x) => (x.id === u.id ? r.user : x)) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update');
    }
  }

  return (
    <>
      <div className="stack-sm">
        <h1>People</h1>
        <p className="small muted">Anyone with a college email can sign in as a student. Give kitchen staff access to their canteen here.</p>
      </div>
      <input className="input" placeholder="Search by email or name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
      <ErrorBanner error={error} />
      {!users ? (
        <Spinner />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Email</th><th>Name</th><th>Role</th><th>Canteen</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>{u.name || '—'}</td>
                  <td>
                    <select className="input input-sm" value={u.role} onChange={(e) => setRole(u, e.target.value, e.target.value === 'staff' ? u.canteenId ?? canteens[0]?.id ?? null : null)} aria-label={`Role for ${u.email}`}>
                      <option value="student">Student</option>
                      <option value="staff">Kitchen staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    {u.role === 'staff' ? (
                      <select className="input input-sm" value={u.canteenId ?? ''} onChange={(e) => setRole(u, 'staff', e.target.value)} aria-label={`Canteen for ${u.email}`}>
                        {canteens.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------- Devices ---------------- */
function DevicesPage({ canteens, reload }: { canteens: AdminCanteen[]; reload: () => void }) {
  const [newKey, setNewKey] = useState<{ canteen: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(canteenId: string) {
    const label = prompt('Name this device', 'Main door counter');
    if (!label) return;
    try {
      const r = await api<{ key: string }>(`/admin/canteens/${canteenId}/sensors`, { body: { label } });
      setNewKey({ canteen: canteenId, key: r.key });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create');
    }
  }

  async function remove(id: number) {
    if (!confirm('Remove this device? It will stop sending counts.')) return;
    await api(`/admin/sensors/${id}`, { method: 'DELETE', body: {} });
    reload();
  }

  return (
    <>
      <div className="stack-sm">
        <h1>Door counters</h1>
        <p className="small muted">
          Each counter posts how many people are inside about once a minute. Without a recent reading, the crowd meter falls back to the kitchen queue.
          Setup guide: <code>docs/door-counter.md</code>.
        </p>
      </div>
      <ErrorBanner error={error} />
      {newKey && (
        <div className="banner banner-ok stack-sm" style={{ display: 'flex' }}>
          <strong>Device key for {newKey.canteen}. Copy it now; it is shown only once.</strong>
          <span className="key-box">{newKey.key}</span>
        </div>
      )}
      {canteens.map((c) => (
        <div key={c.id} className="card stack-sm">
          <div className="row-between">
            <h3>{c.name}</h3>
            <button className="btn btn-sm btn-plain" onClick={() => create(c.id)}>Add device</button>
          </div>
          {c.sensors.length === 0 && <span className="small muted">No devices. Crowd level comes from the kitchen queue.</span>}
          {c.sensors.map((s) => {
            const fresh = s.lastSeenAt && Date.now() - s.lastSeenAt < 5 * 60_000;
            return (
              <div key={s.id} className="row-between small">
                <span>
                  <span className={`live-dot${fresh ? '' : ' off'}`} /> {s.label}
                </span>
                <span className="row">
                  <span className="muted">{s.lastSeenAt ? `last reading ${new Date(s.lastSeenAt).toLocaleString()}` : 'never reported'}</span>
                  <button className="btn btn-sm btn-danger" onClick={() => remove(s.id)}>Remove</button>
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function Admin() {
  const { user } = useSession();
  const { canteens, reload, setCanteens } = useCanteens();
  if (!user) return <Navigate to="/login?next=/admin" replace />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;

  const link = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : '');
  const outlets = (canteens ?? []).filter((c) => c.kind === 'canteen');
  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Admin">
        <span style={{ fontWeight: 800, fontSize: 18, padding: '0 12px 12px' }}>CampusBite admin</span>
        <NavLink to="/admin" end className={link}>Metrics</NavLink>
        <NavLink to="/admin/canteens" className={link}>Places, map and hours</NavLink>
        <NavLink to="/admin/menu" className={link}>Menus</NavLink>
        <NavLink to="/admin/people" className={link}>People</NavLink>
        <NavLink to="/admin/devices" className={link}>Door counters</NavLink>
        <span style={{ flex: 1 }} />
        <Link to="/kitchen">Kitchen screens</Link>
        <Link to="/">Student app</Link>
      </nav>
      <main className="admin-main">
        {!canteens ? (
          <Spinner />
        ) : (
          <Routes>
            <Route index element={<MetricsPage canteens={outlets} />} />
            <Route path="canteens" element={<CanteensPage canteens={canteens} reload={reload} replace={(c) => setCanteens((l) => l?.map((x) => (x.id === c.id ? c : x)) ?? null)} />} />
            <Route path="menu" element={<MenuPage canteens={outlets} />} />
            <Route path="people" element={<PeoplePage canteens={outlets} />} />
            <Route path="devices" element={<DevicesPage canteens={outlets} reload={reload} />} />
          </Routes>
        )}
      </main>
    </div>
  );
}
