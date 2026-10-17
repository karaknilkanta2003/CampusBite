import { Router } from 'express';
import { config } from '../config.ts';
import { all } from '../db.ts';
import { canteenView, getCanteen, listCanteenViews, menuView, slotsFor } from '../domain/canteens.ts';
import { boardView } from '../domain/orders.ts';
import { recommendSlot } from '../domain/slots.ts';
import type { TimetableRow } from '../domain/types.ts';
import { pushEnabled } from '../notify/push.ts';

export const publicRouter = Router();

publicRouter.get('/config', (_req, res) => {
  res.json({
    paymentProvider: config.payment.provider,
    feePaise: config.payment.feePaise,
    vapidPublicKey: pushEnabled ? config.vapid.publicKey : null,
    allowedEmailDomains: config.allowedEmailDomains,
    map: config.map,
    // No mail server in development: sign-in codes are shown on screen, so offer one-tap demo accounts.
    demoSignIn: !config.isProduction && !config.smtp.host && config.devCodes === 'all',
  });
});

publicRouter.get('/canteens', (_req, res) => {
  res.json({ canteens: listCanteenViews() });
});

publicRouter.get('/canteens/:id', (req, res) => {
  const c = getCanteen(req.params.id);
  res.json({ canteen: canteenView(c), menu: menuView(c.id) });
});

publicRouter.get('/canteens/:id/slots', (req, res) => {
  const c = getCanteen(req.params.id);
  const now = Date.now();
  const slots = slotsFor(c, now);
  const classes = req.user ? all<TimetableRow>('SELECT * FROM timetable_entries WHERE user_id = ?', req.user.id) : [];
  const recommended = recommendSlot(slots, classes, now, config.rules.walkBufferMinutes);
  res.json({ slots, recommended, hasTimetable: classes.length > 0 });
});

publicRouter.get('/board/:id', (req, res) => {
  const c = getCanteen(req.params.id);
  res.json({ canteen: canteenView(c), board: boardView(c.id), soldOut: menuView(c.id).filter((m) => !m.available).map((m) => m.name) });
});
