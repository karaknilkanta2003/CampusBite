import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.ts';
import { all, run, tx } from '../db.ts';
import type { TimetableRow } from '../domain/types.ts';
import { isValidHm, parseHm } from '../lib/time.ts';
import { removeSubscription, saveSubscription } from '../notify/push.ts';

export const meRouter = Router();

const hm = z.string().refine(isValidHm, 'Use HH:MM');

meRouter.get('/timetable', (req, res) => {
  const user = requireUser(req);
  const rows = all<TimetableRow>('SELECT * FROM timetable_entries WHERE user_id = ? ORDER BY weekday, start_time', user.id);
  res.json({ entries: rows.map((r) => ({ id: r.id, weekday: r.weekday, start: r.start_time, end: r.end_time, title: r.title })) });
});

/** Replaces the whole weekly timetable. */
meRouter.put('/timetable', (req, res) => {
  const user = requireUser(req);
  const { entries } = z
    .object({
      entries: z
        .array(
          z
            .object({ weekday: z.number().int().min(0).max(6), start: hm, end: hm, title: z.string().trim().max(60).default('') })
            .refine((e) => parseHm(e.end) > parseHm(e.start), 'A class must end after it starts'),
        )
        .max(80),
    })
    .parse(req.body);
  tx(() => {
    run('DELETE FROM timetable_entries WHERE user_id = ?', user.id);
    for (const e of entries) {
      run('INSERT INTO timetable_entries (user_id, weekday, start_time, end_time, title) VALUES (?, ?, ?, ?, ?)', user.id, e.weekday, e.start, e.end, e.title);
    }
  });
  res.json({ ok: true });
});

meRouter.post('/push', (req, res) => {
  const user = requireUser(req);
  const sub = z.object({ endpoint: z.url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).parse(req.body);
  saveSubscription(user.id, sub);
  res.json({ ok: true });
});

meRouter.delete('/push', (req, res) => {
  requireUser(req);
  const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body);
  removeSubscription(endpoint);
  res.json({ ok: true });
});
