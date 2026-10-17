import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import { currentPushState, disablePush, enablePush } from '../push';
import type { User } from '../types';
import { WEEKDAYS } from '../format';
import { ErrorBanner, Icon, SignInPrompt, TabBar, useToast } from '../components/ui';

interface Entry {
  weekday: number;
  start: string;
  end: string;
  title: string;
}

function Timetable() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    api<{ entries: Entry[] }>('/me/timetable')
      .then((r) => setEntries(r.entries))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!entries) return error ? <ErrorBanner error={error} /> : null;

  const update = (i: number, patch: Partial<Entry>) => setEntries(entries.map((e, j) => (i === j ? { ...e, ...patch } : e)));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api('/me/timetable', { method: 'PUT', body: { entries } });
      showToast('Timetable saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card stack">
      <div className="stack-sm">
        <h2 className="row">
          <Icon name="calendar" /> Class timetable
        </h2>
        <p className="small muted">Pickup times are suggested so your food is ready just after class, with time to walk over.</p>
      </div>
      {entries.length === 0 && <p className="small muted">No classes added yet.</p>}
      {entries.map((e, i) => (
        <div key={i} className="stack-sm" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
          <div className="row wrap">
            <select className="input input-sm" style={{ width: 'auto' }} value={e.weekday} onChange={(ev) => update(i, { weekday: Number(ev.target.value) })} aria-label="Day">
              {WEEKDAYS.map((d, n) => (
                <option key={d} value={n}>
                  {d}
                </option>
              ))}
            </select>
            <input className="input input-sm" style={{ width: 'auto' }} type="time" value={e.start} onChange={(ev) => update(i, { start: ev.target.value })} aria-label="Starts" />
            <span className="muted">to</span>
            <input className="input input-sm" style={{ width: 'auto' }} type="time" value={e.end} onChange={(ev) => update(i, { end: ev.target.value })} aria-label="Ends" />
          </div>
          <div className="row">
            <input className="input input-sm grow" placeholder="Course or room (optional)" value={e.title} maxLength={60} onChange={(ev) => update(i, { title: ev.target.value })} aria-label="Title" />
            <button className="icon-btn" aria-label="Remove class" onClick={() => setEntries(entries.filter((_, j) => j !== i))}>
              <Icon name="x" />
            </button>
          </div>
        </div>
      ))}
      <div className="row wrap">
        <button className="btn btn-plain" onClick={() => setEntries([...entries, { weekday: entries.at(-1)?.weekday ?? 1, start: '09:00', end: '10:00', title: '' }])}>
          Add a class
        </button>
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save timetable'}
        </button>
      </div>
      <ErrorBanner error={error} />
      {toast}
    </div>
  );
}

export function Profile() {
  const { user, config, setUser, signOut } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState(user?.name ?? '');
  const [push, setPush] = useState<'unsupported' | 'denied' | 'on' | 'off'>('unsupported');
  const [toast, showToast] = useToast();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void currentPushState().then(setPush);
  }, []);

  if (!user) {
    return (
      <div className="app">
        <div className="page">
          <h1>Me</h1>
          <SignInPrompt text="Sign in to manage alerts and your timetable." />
        </div>
        <TabBar />
      </div>
    );
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: { name } });
      setUser(r.user);
      showToast('Saved');
      if (params.get('welcome')) navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    }
  }

  async function togglePush() {
    try {
      if (push === 'on') {
        await disablePush();
        setPush('off');
      } else if (config?.vapidPublicKey) {
        const ok = await enablePush(config.vapidPublicKey);
        setPush(ok ? 'on' : await currentPushState());
      }
    } catch {
      showToast('Could not change alerts on this device');
    }
  }

  return (
    <div className="app">
      <div className="page">
        <h1>{params.get('welcome') ? 'Welcome to CampusBite' : 'Me'}</h1>
        <form className="card stack" onSubmit={saveName}>
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" className="input" value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />
            <span className="tiny muted">{user.email}</span>
          </div>
          <button className="btn btn-primary">Save</button>
          <ErrorBanner error={error} />
        </form>

        <div className="card stack">
          <h2 className="row">
            <Icon name="bell" /> "Food is ready" alerts
          </h2>
          {!config?.vapidPublicKey ? (
            <p className="small muted">Alerts are not set up on this server yet. The order page still updates live while it's open.</p>
          ) : push === 'unsupported' ? (
            <p className="small muted">This browser can't show alerts. On iPhone, add CampusBite to your home screen first.</p>
          ) : push === 'denied' ? (
            <p className="small muted">Alerts are blocked in your browser settings for this site.</p>
          ) : (
            <button className={`btn ${push === 'on' ? 'btn-plain' : 'btn-primary'}`} onClick={togglePush}>
              {push === 'on' ? 'Turn off alerts on this device' : 'Turn on alerts on this device'}
            </button>
          )}
        </div>

        <Timetable />

        {user.role !== 'student' && (
          <div className="row wrap">
            <Link className="btn btn-plain" to="/kitchen">Kitchen screen</Link>
            {user.role === 'admin' && <Link className="btn btn-plain" to="/admin">Admin</Link>}
          </div>
        )}

        <button
          className="btn btn-danger"
          onClick={async () => {
            await signOut();
            navigate('/', { replace: true });
          }}
        >
          Sign out
        </button>
      </div>
      <TabBar />
      {toast}
    </div>
  );
}
