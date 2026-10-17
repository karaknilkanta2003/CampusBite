import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { loadUser } from './auth.ts';
import { config } from './config.ts';
import { HttpError } from './domain/types.ts';
import { authRouter } from './routes/auth.ts';
import { publicRouter } from './routes/public.ts';
import { ordersRouter, razorpayWebhook } from './routes/orders.ts';
import { meRouter } from './routes/me.ts';
import { kitchenRouter } from './routes/kitchen.ts';
import { adminRouter } from './routes/admin.ts';
import { sensorsRouter } from './routes/sensors.ts';
import { eventsRouter } from './routes/events.ts';

/** The tile server's origin for the Content-Security-Policy, e.g. https://tile.openstreetmap.org or https://*.example.com for {s} subdomains. */
function tileOrigin(): string {
  const url = new URL(config.map.tileUrl.replace(/\{[a-z]\}/g, '0'));
  return config.map.tileUrl.includes('{s}.') ? `${url.protocol}//*.${url.host.split('.').slice(1).join('.')}` : url.origin;
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
          frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
          connectSrc: ["'self'", 'https://*.razorpay.com'],
          imgSrc: ["'self'", 'data:', 'https://*.razorpay.com', tileOrigin()],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          // Only force HTTPS when the site is served over HTTPS; otherwise phones on the
          // local network (http://<laptop-ip>:8080) would fail to load scripts.
          upgradeInsecureRequests: config.publicUrl.startsWith('https://') ? [] : null,
        },
      },
    }),
  );

  // The webhook needs the raw body for signature checks, so it is mounted before the JSON parser.
  app.use('/api/payments/razorpay/webhook', razorpayWebhook);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(loadUser);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter);
  app.use('/api', publicRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/me', meRouter);
  app.use('/api/kitchen', kitchenRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/sensors', sensorsRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint' } });
  });

  // Serve the built web app, with client-side routing fallback.
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      res.status(400).json({ error: { code: 'invalid', message: `${where}${issue?.message ?? 'Invalid request'}` } });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on our side' } });
  });

  return app;
}
