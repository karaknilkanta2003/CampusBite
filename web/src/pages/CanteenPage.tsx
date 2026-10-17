import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useCart } from '../cart';
import { reportShown, useLive } from '../live';
import type { Canteen, MenuItem } from '../types';
import { rupees, WEEKDAYS } from '../format';
import { BackButton, CrowdMeter, ErrorBanner, Icon, Spinner, StatusPill, VegDot } from '../components/ui';
import { CampusMap } from '../components/CampusMap';

export function CanteenPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const cart = useCart();
  const [canteen, setCanteen] = useState<Canteen | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showHours, setShowHours] = useState(false);

  const load = useCallback(() => {
    api<{ canteen: Canteen; menu: MenuItem[] }>(`/canteens/${id}`)
      .then((r) => {
        setCanteen(r.canteen);
        setMenu(r.menu);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);

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
  }, {}, { resync: load, pollMs: 20_000 });

  if (error) return <div className="app"><div className="page"><BackButton to="/" /><ErrorBanner error={error} /></div></div>;
  if (!canteen) return <Spinner />;

  const lines = cart.lines(id);
  const byId = new Map(menu.map((m) => [m.id, m]));
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + (byId.get(l.menuItemId)?.pricePaise ?? 0) * l.qty, 0);
  const categories = [...new Set(menu.map((m) => m.category))];
  const isMess = canteen.kind === 'mess';

  return (
    <div className="app">
      <div className="page">
        <div className="topbar">
          <BackButton to="/" label="Back to canteens" />
          <div className="stack-sm grow" style={{ gap: 0 }}>
            <h1 style={{ fontSize: 21 }}>{canteen.name}</h1>
            <span className="small muted bold">{canteen.location}</span>
          </div>
        </div>
        <div className="row wrap">
          <StatusPill canteen={canteen} />
          <button className="pill pill-plain" onClick={() => setShowHours((s) => !s)} aria-expanded={showHours}>
            {showHours ? 'Hide hours' : isMess ? 'Meal times' : 'Opening hours'}
          </button>
          {canteen.mapsUrl && (
            <a className="pill pill-soft" href={canteen.mapsUrl} target="_blank" rel="noreferrer">
              <Icon name="pin" size={14} /> Directions
            </a>
          )}
        </div>
        {(showHours || isMess) && (
          <div className="card card-tight small">
            {WEEKDAYS.map((d, i) => {
              const windows = canteen.hours.filter((x) => x.weekday === i);
              return (
                <div key={d} className="row-between">
                  <span>{d}</span>
                  <span className="bold">{windows.length ? windows.map((h) => `${h.open}–${h.close}`).join(', ') : 'Closed'}</span>
                </div>
              );
            })}
          </div>
        )}
        {canteen.lat !== null && canteen.lon !== null && (
          <CampusMap canteens={[canteen]} selectedId={canteen.id} focus={{ lat: canteen.lat, lon: canteen.lon }} />
        )}
        {isMess ? (
          <div className="banner banner-info">
            Mess meals are booked in advance on the institute's Mess Portal (at least four days ahead), not through CampusBite.
          </div>
        ) : (
          <CrowdMeter canteen={canteen} />
        )}

        {!isMess && !canteen.status.acceptingOrders && (
          <div className="banner banner-warn">
            {canteen.status.state === 'unconfirmed'
              ? "The kitchen hasn't confirmed it's open in the last few minutes, so ordering is paused. You can still browse the menu."
              : 'This canteen is not taking orders right now. You can still browse the menu.'}
          </div>
        )}
        {!isMess && <p className="tiny muted">Sold-out items update live from the kitchen.</p>}

        {categories.map((cat) => (
          <section key={cat} className="stack">
            <h2 className="cat-title">{cat}</h2>
            {menu
              .filter((m) => m.category === cat)
              .map((m) => {
                const qty = cart.qty(id, m.id);
                return (
                  <div key={m.id} className={`card card-tight item${m.available ? '' : ' sold-out'}`}>
                    <div className="grow stack-sm" style={{ gap: 3 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <VegDot veg={m.veg} />
                        <span className="bold">{m.name}</span>
                      </div>
                      <span className="tiny muted bold">
                        {m.rating !== null ? `★ ${m.rating} · ${m.ratingCount} rating${m.ratingCount === 1 ? '' : 's'}` : 'No ratings yet'}
                      </span>
                      <span className="bold">{rupees(m.pricePaise)}</span>
                    </div>
                    {!m.available ? (
                      <span className="tag-soldout">Sold out</span>
                    ) : qty === 0 ? (
                      <button className="btn btn-outline" style={{ minWidth: 76 }} onClick={() => cart.add(id, m.id)} aria-label={`Add ${m.name}`}>
                        Add
                      </button>
                    ) : (
                      <div className="stepper">
                        <button onClick={() => cart.remove(id, m.id)} aria-label={`Remove one ${m.name}`}>−</button>
                        <span aria-live="polite">{qty}</span>
                        <button onClick={() => cart.add(id, m.id)} aria-label={`Add one more ${m.name}`}>+</button>
                      </div>
                    )}
                  </div>
                );
              })}
          </section>
        ))}
      </div>

      {count > 0 && (
        <div className="bottom-bar">
          <button className="btn btn-primary btn-lg btn-block" style={{ justifyContent: 'space-between' }} disabled={!canteen.status.acceptingOrders} onClick={() => navigate(`/c/${id}/checkout`)}>
            <span>
              {count} item{count === 1 ? '' : 's'} · {rupees(subtotal)}
            </span>
            <span>Choose pickup time →</span>
          </button>
        </div>
      )}
    </div>
  );
}
