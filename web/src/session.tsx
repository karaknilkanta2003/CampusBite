import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { AppConfig, User } from './types';

interface Session {
  user: User | null;
  config: AppConfig | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api<{ user: User | null }>('/auth/me'), api<AppConfig>('/config')])
      .then(([me, cfg]) => {
        setUser(me.user);
        setConfig(cfg);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', body: {} });
    setUser(null);
  }, []);

  return <SessionContext.Provider value={{ user, config, loading, setUser, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
