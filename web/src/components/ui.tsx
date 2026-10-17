import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { Canteen } from '../types';
import { crowdWord } from '../format';

type IconName = 'back' | 'home' | 'receipt' | 'user' | 'clock' | 'calendar' | 'bell' | 'check' | 'star' | 'pin' | 'x';

const PATHS: Record<IconName, ReactNode> = {
  back: <path d="m15 18-6-6 6-6" />,
  home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  receipt: (
    <>
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  star: <path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" />,
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />,
};

export function Icon({ name, size = 20, stroke = 2 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function BackButton({ to, label = 'Back' }: { to?: string; label?: string }) {
  const navigate = useNavigate();
  return (
    <button className="icon-btn" aria-label={label} onClick={() => (to ? navigate(to) : navigate(-1))}>
      <Icon name="back" />
    </button>
  );
}

export function StatusPill({ canteen }: { canteen: Canteen }) {
  const s = canteen.status.state;
  return <span className={`pill pill-${s}`}>{canteen.status.label}</span>;
}

export function crowdClass(c: Canteen): string {
  return c.status.state === 'open' ? c.crowd.level : 'closed';
}

export function CrowdMeter({ canteen }: { canteen: Canteen }) {
  const open = canteen.status.state === 'open';
  const cls = crowdClass(canteen);
  const width = open ? Math.max(6, Math.round(canteen.crowd.ratio * 100)) : 0;
  const text = open
    ? `${crowdWord(canteen.crowd.level)} · about ${canteen.crowd.waitMinutes} min wait`
    : canteen.status.state === 'unconfirmed'
      ? 'Kitchen has not checked in. Orders paused.'
      : 'Not taking orders right now';
  return (
    <div className="crowd">
      <div className="crowd-track" role="img" aria-label={text}>
        <div className={`crowd-fill bg-${cls}`} style={{ width: `${width}%` }} />
      </div>
      <span className={`small bold crowd-${cls}`}>{text}</span>
    </div>
  );
}

export function VegDot({ veg }: { veg: boolean }) {
  return <span className={`veg ${veg ? 'veg-yes' : 'veg-no'}`} role="img" aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'} />;
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="banner banner-err" role="alert">
      {error}
    </div>
  );
}

export function TabBar({ hasActiveOrder }: { hasActiveOrder?: boolean }) {
  return (
    <div className="tabbar">
      <nav aria-label="Main">
        <NavLink to="/" end className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
          <Icon name="home" size={22} />
          Canteens
        </NavLink>
        <NavLink to="/orders" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
          <Icon name="receipt" size={22} />
          Orders
          {hasActiveOrder && <span className="tab-badge" aria-label="Active order" />}
        </NavLink>
        <NavLink to="/me" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
          <Icon name="user" size={22} />
          Me
        </NavLink>
      </nav>
    </div>
  );
}

export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg ? <div className="toast" role="status">{msg}</div> : null, setMsg];
}

export function SignInPrompt({ text }: { text: string }) {
  return (
    <div className="card stack center">
      <p className="muted">{text}</p>
      <Link className="btn btn-primary" to="/login">
        Sign in with college email
      </Link>
    </div>
  );
}
