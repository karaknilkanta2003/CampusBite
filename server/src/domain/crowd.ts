export type CrowdLevel = 'quiet' | 'moderate' | 'busy';

export interface CrowdInput {
  seats: number;
  throughputPer10Min: number;
  /** Latest door-counter reading, if any. */
  reading: { people: number; measured_at: number } | null;
  /** Orders placed or cooking (not yet ready). */
  queuedOrders: number;
  now: number;
  sensorFreshMs: number;
}

export interface Crowd {
  level: CrowdLevel;
  /** 0..1 fill for the crowd bar. */
  ratio: number;
  /** Estimated minutes until a new order would be ready. */
  waitMinutes: number;
  source: 'sensor' | 'orders';
  people: number | null;
}

export function crowdLevel(ratio: number): CrowdLevel {
  if (ratio < 0.4) return 'quiet';
  if (ratio < 0.75) return 'moderate';
  return 'busy';
}

/** Kitchen queue in minutes: queued orders divided by orders finished per minute. */
export function queueWaitMinutes(queuedOrders: number, throughputPer10Min: number): number {
  const perMinute = Math.max(throughputPer10Min, 1) / 10;
  return Math.max(2, Math.ceil(queuedOrders / perMinute) + 2);
}

/**
 * Crowd meter. Uses the door counter when it has reported recently; otherwise
 * falls back to the kitchen queue as a proxy for how busy the counter is.
 */
export function computeCrowd(input: CrowdInput): Crowd {
  const waitMinutes = queueWaitMinutes(input.queuedOrders, input.throughputPer10Min);
  const fresh = input.reading !== null && input.now - input.reading.measured_at <= input.sensorFreshMs;
  if (fresh && input.reading) {
    const ratio = Math.min(1, Math.max(0, input.reading.people / Math.max(input.seats, 1)));
    return { level: crowdLevel(ratio), ratio, waitMinutes, source: 'sensor', people: input.reading.people };
  }
  // Queue proxy: one full 10-minute batch of orders waiting = busy.
  const ratio = Math.min(1, input.queuedOrders / Math.max(input.throughputPer10Min, 1));
  return { level: crowdLevel(ratio), ratio, waitMinutes, source: 'orders', people: null };
}
