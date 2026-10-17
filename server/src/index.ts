import { config } from './config.ts';
import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { seedDemo } from './seed.ts';
import { startJobs } from './jobs.ts';
import { pushEnabled } from './notify/push.ts';

openDb(config.databasePath);
if (config.seedDemo) seedDemo();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`CampusBite running at ${config.publicUrl} (port ${config.port})`);
  console.log(`  payments: ${config.payment.provider} · push: ${pushEnabled ? 'on' : 'off (set VAPID keys)'} · email: ${config.smtp.host ? 'smtp' : 'printed to this log'}`);
  if (config.demoAutopilot) console.log('  demo kitchen autopilot: on (canteens with no kitchen screen open run themselves)');
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Is another CampusBite server running? Stop it or set PORT to another number.`);
  } else {
    console.error('Server failed to start:', err);
  }
  process.exit(1);
});

startJobs();

function shutdown() {
  console.log('Shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
