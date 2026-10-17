import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { get, run } from '../db.ts';
import { broadcastCanteen } from '../domain/canteens.ts';
import { HttpError } from '../domain/types.ts';

export const sensorsRouter = Router();

export function hashDeviceKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function newDeviceKey(): string {
  return `cbdev_${crypto.randomBytes(24).toString('base64url')}`;
}

const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

/**
 * Door counters post the number of people inside, about once a minute:
 *   POST /api/sensors/occupancy   X-Device-Key: cbdev_...   {"people": 42}
 */
sensorsRouter.post('/occupancy', limiter, (req, res) => {
  const key = req.header('x-device-key') ?? '';
  const sensor = get<{ id: number; canteen_id: string }>('SELECT id, canteen_id FROM sensors WHERE key_hash = ?', hashDeviceKey(key));
  if (!sensor) throw new HttpError(401, 'bad_device_key', 'Unknown device key');
  const { people } = z.object({ people: z.number().int().min(0).max(5000) }).parse(req.body);
  const now = Date.now();
  run('INSERT INTO occupancy_readings (canteen_id, people, measured_at) VALUES (?, ?, ?)', sensor.canteen_id, people, now);
  run('UPDATE sensors SET last_seen_at = ? WHERE id = ?', now, sensor.id);
  broadcastCanteen(sensor.canteen_id);
  res.json({ ok: true });
});
