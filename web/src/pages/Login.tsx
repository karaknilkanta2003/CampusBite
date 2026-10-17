import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import type { User } from '../types';
import { BackButton, ErrorBanner } from '../components/ui';

export function Login() {
  const { setUser, config } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ devCode?: string }>('/auth/request-code', { body: { email } });
      setDevCode(r.devCode ?? null);
      if (r.devCode) setCode(r.devCode);
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  }

  function goAfterSignIn(user: User) {
    setUser(user);
    const next = params.get('next');
    if (next && next.startsWith('/')) navigate(next, { replace: true });
    else if (user.role === 'staff') navigate('/kitchen', { replace: true });
    else if (user.role === 'admin') navigate('/admin', { replace: true });
    else navigate(user.name ? '/' : '/me?welcome=1', { replace: true });
  }

  /** Demo only (no mail server): requests a code and uses the one the server returns. */
  async function quickSignIn(demoEmail: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ devCode?: string }>('/auth/request-code', { body: { email: demoEmail } });
      if (!r.devCode) throw new ApiError(400, 'no_code', 'This server sends codes by email, so one-tap sign-in is off.');
      const { user } = await api<{ user: User }>('/auth/verify', { body: { email: demoEmail, code: r.devCode } });
      goAfterSignIn(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: User }>('/auth/verify', { body: { email, code } });
      goAfterSignIn(user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  const domains = config?.allowedEmailDomains ?? [];

  return (
    <div className="app">
      <div className="page">
        <div className="topbar">
          <BackButton to="/" />
        </div>
        <div className="stack-sm">
          <h1>Sign in</h1>
          <p className="muted">Use your college email. We'll send you a 6-digit code. No password needed.</p>
        </div>
        <ErrorBanner error={error} />

        {step === 'email' ? (
          <form className="stack" onSubmit={requestCode}>
            <div className="field">
              <label htmlFor="email">College email</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                placeholder={domains[0] ? `name@${domains[0]}` : 'name@college.edu'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {domains.length > 0 && <span className="tiny muted">Accepted: {domains.map((d) => `@${d}`).join(', ')}</span>}
            </div>
            <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form className="stack" onSubmit={verify}>
            <p className="small">
              Code sent to <strong>{email}</strong>.{' '}
              <button type="button" className="btn btn-sm btn-plain" onClick={() => setStep('email')}>
                Change
              </button>
            </p>
            {devCode && <div className="banner banner-info">Development mode: no mail server is set up, so the code is filled in for you.</div>}
            <div className="field">
              <label htmlFor="code">6-digit code</label>
              <input
                id="code"
                className="input input-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </form>
        )}

        {config?.demoSignIn ? (
          <div className="card stack">
            <div className="stack-sm">
              <h2 style={{ fontSize: 16 }}>Demo: sign in with one tap</h2>
              <p className="small muted">No email needed. These are demo accounts; the code is filled in automatically.</p>
            </div>
            <div className="stack-sm">
              <span className="tiny muted bold">Student</span>
              <button className="btn btn-primary" disabled={busy} onClick={() => quickSignIn('student@students.iiit.ac.in')}>
                Student
              </button>
            </div>
            <div className="stack-sm">
              <span className="tiny muted bold">Kitchen staff (one per canteen)</span>
              <div className="row wrap">
                {[
                  ['bbc', 'BBC'],
                  ['vc', 'VC'],
                  ['jc', 'JC'],
                  ['davids', "David's"],
                  ['cie', 'CIE'],
                ].map(([id, label]) => (
                  <button key={id} className="btn btn-plain" disabled={busy} onClick={() => quickSignIn(`kitchen.${id}@iiit.ac.in`)}>
                    {label} kitchen
                  </button>
                ))}
              </div>
            </div>
            <div className="stack-sm">
              <span className="tiny muted bold">Admin (metrics, menus, any kitchen)</span>
              <button className="btn btn-plain" disabled={busy} onClick={() => quickSignIn('admin@iiit.ac.in')}>
                Admin
              </button>
            </div>
            <p className="tiny muted">
              Want a separate student on each phone? Type any address ending in @students.iiit.ac.in above (for example
              friend1@students.iiit.ac.in); the code fills in by itself.
            </p>
          </div>
        ) : (
          <div className="card card-tight small muted">
            <strong>Demo accounts</strong>
            <div>Student: student@students.iiit.ac.in</div>
            <div>Kitchens, one per canteen: kitchen.vc · kitchen.bbc · kitchen.davids · kitchen.jc · kitchen.cie <span className="faint">(all @iiit.ac.in)</span></div>
            <div>Admin, can open any kitchen: admin@iiit.ac.in</div>
          </div>
        )}
      </div>
    </div>
  );
}
