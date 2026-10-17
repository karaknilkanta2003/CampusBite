import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.ts';
import { get, run } from './db.ts';
import { HttpError, type Role, type UserRow } from './domain/types.ts';

const COOKIE = 'cb_session';
const SESSION_DAYS = 30;
const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailAllowed(email: string): boolean {
  const domain = email.split('@')[1] ?? '';
  return config.allowedEmailDomains.length === 0 || config.allowedEmailDomains.includes(domain);
}

function hashCode(email: string, code: string): string {
  return crypto.createHmac('sha256', config.jwtSecret).update(`${email}:${code}`).digest('hex');
}

/** Creates a 6-digit code, stores only its hash and returns the code to email. */
export function issueOtp(email: string, now = Date.now()): string {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  run(
    `INSERT INTO otps (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
     ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`,
    email,
    hashCode(email, code),
    now + OTP_TTL_MS,
  );
  return code;
}

export function verifyOtp(email: string, code: string, now = Date.now()): boolean {
  const row = get<{ code_hash: string; expires_at: number; attempts: number }>('SELECT * FROM otps WHERE email = ?', email);
  if (!row || row.expires_at < now || row.attempts >= OTP_MAX_ATTEMPTS) return false;
  const expected = Buffer.from(row.code_hash);
  const actual = Buffer.from(hashCode(email, code));
  if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
    run('DELETE FROM otps WHERE email = ?', email);
    return true;
  }
  run('UPDATE otps SET attempts = attempts + 1 WHERE email = ?', email);
  return false;
}

export function findOrCreateUser(email: string, now = Date.now()): UserRow {
  const existing = get<UserRow>('SELECT * FROM users WHERE email = ?', email);
  const shouldBeAdmin = config.adminEmails.includes(email);
  if (existing) {
    if (shouldBeAdmin && existing.role !== 'admin') run("UPDATE users SET role = 'admin' WHERE id = ?", existing.id);
    return get<UserRow>('SELECT * FROM users WHERE id = ?', existing.id)!;
  }
  const { id } = run('INSERT INTO users (email, name, role, created_at) VALUES (?, ?, ?, ?)', email, '', shouldBeAdmin ? 'admin' : 'student', now);
  return get<UserRow>('SELECT * FROM users WHERE id = ?', id)!;
}

export function startSession(res: Response, user: UserRow): void {
  const token = jwt.sign({ sub: String(user.id) }, config.jwtSecret, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: SESSION_DAYS * 86_400_000,
    path: '/',
  });
}

export function endSession(res: Response): void {
  res.clearCookie(COOKIE, { path: '/' });
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export function loadUser(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
      req.user = get<UserRow>('SELECT * FROM users WHERE id = ?', Number(payload.sub));
    } catch {
      // expired or tampered: treat as signed out
    }
  }
  next();
}

export function requireUser(req: Request): UserRow {
  if (!req.user) throw new HttpError(401, 'unauthenticated', 'Please sign in');
  return req.user;
}

export function requireRole(req: Request, ...roles: Role[]): UserRow {
  const user = requireUser(req);
  if (!roles.includes(user.role)) throw new HttpError(403, 'forbidden', 'You do not have access to this');
  return user;
}

/** Staff may only run their own canteen's kitchen; admins may run any. */
export function requireKitchen(req: Request, canteenId: string): UserRow {
  const user = requireRole(req, 'staff', 'admin');
  if (user.role === 'staff' && user.canteen_id !== canteenId) {
    throw new HttpError(403, 'forbidden', 'You are not staff at this canteen');
  }
  return user;
}
