import { useEffect, useRef, useState } from 'react';

type Handlers = Record<string, (data: never) => void>;

interface LiveOptions {
  /** Refetches the page's data. Called after every reconnect and whenever the page comes back on screen. */
  resync?: () => void;
  /** Also calls resync on this interval while the page is visible, as a backup if live events are blocked. */
  pollMs?: number;
}

/**
 * Subscribes to the server's live event stream.
 *
 * Phones drop the stream when the screen locks or the user switches apps, and events sent in the
 * meantime are lost. So the hook reconnects itself, and after each reconnect (and each time the
 * page becomes visible again) it calls `resync` so the page fetches anything it missed. The optional
 * `pollMs` refresh keeps the page current even on networks that block live streams entirely.
 * Returns whether the stream is currently connected.
 */
export function useLive(handlers: Handlers, params: Record<string, string> = {}, options: LiveOptions = {}): boolean {
  const ref = useRef(handlers);
  ref.current = handlers;
  const resyncRef = useRef(options.resync);
  resyncRef.current = options.resync;
  const [connected, setConnected] = useState(false);
  const query = new URLSearchParams(params).toString();
  const pollMs = options.pollMs;

  useEffect(() => {
    let es: EventSource | null = null;
    let opened = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const resync = () => resyncRef.current?.();

    const connect = () => {
      if (disposed) return;
      es?.close();
      const source = new EventSource(`/api/events${query ? `?${query}` : ''}`);
      es = source;
      source.onopen = () => {
        setConnected(true);
        // The first open follows the page's own load; later opens are reconnects that may have missed events.
        if (opened) resync();
        opened = true;
      };
      source.onerror = () => {
        setConnected(false);
        // The browser retries on its own while CONNECTING; if it has given up (CLOSED), start again.
        if (source.readyState === EventSource.CLOSED && !retry) {
          retry = setTimeout(() => {
            retry = null;
            connect();
          }, 3000);
        }
      };
      for (const name of Object.keys(ref.current)) {
        source.addEventListener(name, (e: MessageEvent) => {
          try {
            ref.current[name]?.(JSON.parse(e.data) as never);
          } catch {
            // ignore malformed events
          }
        });
      }
    };

    // Back on screen (unlocked phone, switched back to the tab, network returned): catch up at once.
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      resync();
      if (!es || es.readyState === EventSource.CLOSED) connect();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);

    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('pageshow', wake);
      es?.close();
    };
  }, [query]);

  // Backup refresh, kept separate so changing the interval never restarts the live connection.
  useEffect(() => {
    if (!pollMs) return;
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') resyncRef.current?.();
    }, pollMs);
    return () => clearInterval(poll);
  }, [pollMs]);

  return connected;
}

/** Re-renders every `ms` so countdowns and "x min ago" stay current. */
export function useNow(ms = 15_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const reported = new Set<string>();
/**
 * Tells the server this screen has displayed a kitchen status or menu change, so the
 * H1 update delay can be measured. Each change is reported once per screen.
 */
export function reportShown(data: { change?: { id: string } }): void {
  const id = data.change?.id;
  if (!id || reported.has(id)) return;
  reported.add(id);
  // Report after the browser has painted the update.
  requestAnimationFrame(() =>
    setTimeout(() => {
      fetch('/api/events/shown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeId: id }),
        keepalive: true,
      }).catch(() => undefined);
    }, 0),
  );
}
