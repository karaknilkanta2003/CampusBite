import { config } from '../config.ts';
import { get, openDb, run } from '../db.ts';

// Usage: npm run make-admin --workspace server -- someone@iiit.ac.in
const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email.includes('@')) {
  console.error('Usage: npm run make-admin --workspace server -- <email>');
  process.exit(1);
}
openDb(config.databasePath);
if (get('SELECT id FROM users WHERE email = ?', email)) {
  run("UPDATE users SET role = 'admin', canteen_id = NULL WHERE email = ?", email);
} else {
  run("INSERT INTO users (email, name, role, created_at) VALUES (?, '', 'admin', ?)", email, Date.now());
}
console.log(`${email} is now an admin`);
