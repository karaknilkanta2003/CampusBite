import { Router } from 'express';
import { subscribe } from '../events.ts';
import { get } from '../db.ts';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { recordShown } from '../domain/latency.ts';

export const eventsRouter = Router();

/**
 * One live stream per screen.
 *   /api/events                     public canteen updates (+ your orders when signed in)
 *   /api/events?kitchen=<canteenId> also that kitchen's orders (staff of that canteen or admin)
 *   /api/events?board=<canteenId>   also that pickup board (no sign-in needed)
 */
eventsRouter.get('/', (req, res) => {
  const channels = ['public'];
  if (req.user) channels.push(`user:${req.user.id}`);

  const kitchen = typeof req.query.kitchen === 'string' ? req.query.kitchen : null;
  if (kitchen && req.user && (req.user.role === 'admin' || (req.user.role === 'staff' && req.user.canteen_id === kitchen))) {
    channels.push(`kitchen:${kitchen}`);
  }

  const board = typeof req.query.board === 'string' ? req.query.board : null;
  if (board && get('SELECT id FROM canteens WHERE id = ?', board)) channels.push(`board:${board}`);

  const unsubscribe = subscribe(res, channels);
  req.on('close', unsubscribe);
});

const shownLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });

/** A student screen reports that it has displayed a kitchen status or menu change (QFD spec H1). */
eventsRouter.post('/shown', shownLimiter, (req, res) => {
  const { changeId } = z.object({ changeId: z.string().uuid() }).parse(req.body);
  res.json({ recorded: recordShown(changeId) });
});
