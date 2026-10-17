import webpush from 'web-push';
import { all, run } from '../db.ts';
import { config } from '../config.ts';

export const pushEnabled = !!(config.vapid.publicKey && config.vapid.privateKey);

if (pushEnabled) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

interface SubRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function saveSubscription(userId: number, sub: { endpoint: string; keys: { p256dh: string; auth: string } }): void {
  run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    userId,
    sub.endpoint,
    sub.keys.p256dh,
    sub.keys.auth,
    Date.now(),
  );
}

export function removeSubscription(endpoint: string): void {
  run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
}

/** Sends to every device the user has enabled. Dead subscriptions are removed. */
export async function sendPush(userId: number, msg: PushMessage): Promise<void> {
  if (!pushEnabled) return;
  const subs = all<SubRow>('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', userId);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(msg),
          { TTL: 600, urgency: 'high' },
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) removeSubscription(s.endpoint);
        else console.warn('[push] send failed', code ?? err);
      }
    }),
  );
}
