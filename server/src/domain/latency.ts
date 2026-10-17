import crypto from 'node:crypto';
import { all, run } from '../db.ts';

// QFD spec H1: how long a kitchen-tablet status or menu change takes to appear on student screens.
// The server stamps each change; a student screen reports back when it has displayed it. The
// recorded delay runs from the server receiving the change to the server receiving that report,
// so it includes the report's own trip and slightly overstates the true delay (a safe upper bound).

export interface StatusChange {
  id: string;
  at: number;
}

interface Pending {
  canteenId: string;
  kind: 'status' | 'menu';
  at: number;
  reports: number;
}

const pending = new Map<string, Pending>();
const KEEP_MS = 10 * 60_000;
const MAX_REPORTS_PER_CHANGE = 50;

export function stampChange(canteenId: string, kind: 'status' | 'menu', now = Date.now()): StatusChange {
  for (const [id, p] of pending) if (now - p.at > KEEP_MS) pending.delete(id);
  const id = crypto.randomUUID();
  pending.set(id, { canteenId, kind, at: now, reports: 0 });
  return { id, at: now };
}

/** Records one student screen showing the change. Unknown, expired or over-reported changes are ignored. */
export function recordShown(changeId: string, now = Date.now()): boolean {
  const p = pending.get(changeId);
  if (!p || now - p.at > KEEP_MS || p.reports >= MAX_REPORTS_PER_CHANGE) return false;
  p.reports++;
  run(
    'INSERT INTO status_latency (canteen_id, change_id, kind, changed_at, shown_at, latency_ms) VALUES (?, ?, ?, ?, ?, ?)',
    p.canteenId,
    changeId,
    p.kind,
    p.at,
    now,
    now - p.at,
  );
  return true;
}

export interface LatencySummary {
  samples: number;
  p95Seconds: number | null;
  within30sRate: number | null;
  over60s: number;
}

export function latencySummary(since: number, canteenId: string | null): LatencySummary {
  const rows = all<{ latency_ms: number }>(
    `SELECT latency_ms FROM status_latency WHERE shown_at >= ? ${canteenId ? 'AND canteen_id = ?' : ''} ORDER BY latency_ms`,
    ...(canteenId ? [since, canteenId] : [since]),
  );
  if (rows.length === 0) return { samples: 0, p95Seconds: null, within30sRate: null, over60s: 0 };
  const ms = rows.map((r) => r.latency_ms);
  const p95 = ms[Math.min(ms.length - 1, Math.ceil(ms.length * 0.95) - 1)];
  return {
    samples: ms.length,
    p95Seconds: Math.round(p95 / 100) / 10,
    within30sRate: ms.filter((x) => x <= 30_000).length / ms.length,
    over60s: ms.filter((x) => x > 60_000).length,
  };
}
