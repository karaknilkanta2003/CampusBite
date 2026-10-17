import path from 'node:path';

const env = process.env;

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const isProduction = env.NODE_ENV === 'production';

export const config = {
  isProduction,
  port: Number(env.PORT ?? 8080),
  publicUrl: env.PUBLIC_URL ?? 'http://localhost:8080',
  jwtSecret: env.JWT_SECRET ?? 'dev-only-secret-change-me',
  databasePath: path.resolve(env.DATABASE_PATH ?? './data/campusbite.db'),
  seedDemo: (env.SEED_DEMO ?? (isProduction ? 'false' : 'true')) === 'true',
  /**
   * Which sign-in codes the development screen fills in when no mail server is set:
   * all | students (staff and admin codes only in the server log) | none. Never in production.
   */
  devCodes: (env.DEV_CODES ?? 'all') as 'all' | 'students' | 'none',
  /** Simulates kitchen staff for canteens with no kitchen screen open. Demo only. */
  demoAutopilot: (env.DEMO_KITCHEN_AUTOPILOT ?? (isProduction ? 'false' : 'true')) === 'true',

  allowedEmailDomains: list(env.ALLOWED_EMAIL_DOMAINS ?? 'iiit.ac.in,students.iiit.ac.in,research.iiit.ac.in'),
  adminEmails: list(env.ADMIN_EMAILS),

  smtp: {
    host: env.SMTP_HOST ?? '',
    port: Number(env.SMTP_PORT ?? 587),
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASS ?? '',
    from: env.MAIL_FROM ?? 'CampusBite <no-reply@example.edu>',
  },

  payment: {
    provider: (env.PAYMENT_PROVIDER ?? 'mock') as 'mock' | 'razorpay',
    razorpayKeyId: env.RAZORPAY_KEY_ID ?? '',
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET ?? '',
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '',
    feePaise: Math.round(Number(env.ORDER_FEE_RUPEES ?? 5) * 100),
  },

  map: {
    /** Map tiles. OpenStreetMap's own servers are fine for light use; use a tile provider for production traffic. */
    tileUrl: env.MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: env.MAP_ATTRIBUTION ?? '© OpenStreetMap contributors',
    center: (env.MAP_CENTER ?? '17.4463,78.3480').split(',').map(Number) as [number, number],
    zoom: Number(env.MAP_ZOOM ?? 17),
  },

  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY ?? '',
    privateKey: env.VAPID_PRIVATE_KEY ?? '',
    subject: env.VAPID_SUBJECT ?? 'mailto:admin@example.edu',
  },

  // Operating rules taken from the CCPD brief (QFD specs)
  rules: {
    /** Kitchen tablet must check in this often or status shows "unconfirmed" (H1). */
    heartbeatStaleMs: 5 * 60_000,
    /** An unpaid order holds its slot for this long. */
    paymentHoldMs: 10 * 60_000,
    /** Remind a student to collect every 2 minutes, at most this many times. */
    reminderEveryMs: 2 * 60_000,
    maxReminders: 5,
    /** Sensor readings older than this are ignored for the crowd meter. */
    sensorFreshMs: 5 * 60_000,
    /** How many pickup slots ahead students can book. */
    slotsAhead: 12,
    /** Minimum minutes between ordering and the earliest slot. */
    minLeadMinutes: 8,
    /** Walking buffer added after a class ends when recommending a slot. */
    walkBufferMinutes: 5,
  },
};

if (isProduction && config.jwtSecret === 'dev-only-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
// Mock payments let anyone mark an order paid, so they need an explicit opt-in outside development.
if (isProduction && config.payment.provider === 'mock' && env.ALLOW_MOCK_PAYMENTS !== 'true') {
  throw new Error('PAYMENT_PROVIDER=mock is not allowed in production. Use razorpay, or set ALLOW_MOCK_PAYMENTS=true for a free trial run.');
}
if (config.payment.provider === 'razorpay' && (!config.payment.razorpayKeyId || !config.payment.razorpayKeySecret)) {
  throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when PAYMENT_PROVIDER=razorpay');
}
