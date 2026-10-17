import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { emailAllowed, endSession, findOrCreateUser, issueOtp, normaliseEmail, requireUser, startSession, verifyOtp } from '../auth.ts';
import { sendSignInCode } from '../notify/email.ts';
import { config } from '../config.ts';
import { get, run } from '../db.ts';
import { HttpError, type UserRow } from '../domain/types.ts';

export const authRouter = Router();

const codeLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.isProduction ? 5 : 100, // demo devices share accounts, so allow more outside production
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.email ?? '').toLowerCase()}`,
  message: { error: { code: 'rate_limited', message: 'Too many codes requested. Try again in 15 minutes.' } },
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.isProduction ? 20 : 200,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' } },
});

export function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, canteenId: u.canteen_id };
}

authRouter.post('/request-code', codeLimiter, async (req, res) => {
  const { email } = z.object({ email: z.email() }).parse(req.body);
  const normalised = normaliseEmail(email);
  if (!emailAllowed(normalised)) {
    throw new HttpError(403, 'domain_not_allowed', `Use your college email (${config.allowedEmailDomains.join(', ')})`);
  }
  const code = issueOtp(normalised);
  await sendSignInCode(normalised, code);
  const role = get<{ role: string }>('SELECT role FROM users WHERE email = ?', normalised)?.role ?? 'student';
  const showCode =
    !config.isProduction && !config.smtp.host && (config.devCodes === 'all' || (config.devCodes === 'students' && role === 'student'));
  res.json({ ok: true, devCode: showCode ? code : undefined });
});

authRouter.post('/verify', verifyLimiter, (req, res) => {
  const body = z.object({ email: z.email(), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  const email = normaliseEmail(body.email);
  if (!verifyOtp(email, body.code)) throw new HttpError(400, 'bad_code', 'That code is wrong or has expired');
  const user = findOrCreateUser(email);
  startSession(res, user);
  res.json({ user: publicUser(user) });
});

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

authRouter.patch('/me', (req, res) => {
  const user = requireUser(req);
  const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
  run('UPDATE users SET name = ? WHERE id = ?', name, user.id);
  res.json({ user: publicUser(get<UserRow>('SELECT * FROM users WHERE id = ?', user.id)!) });
});

authRouter.post('/logout', (_req, res) => {
  endSession(res);
  res.json({ ok: true });
});
