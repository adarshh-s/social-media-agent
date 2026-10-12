// Create (or reset the password of) a user from the command line.
// Usage: npm run create-user -- <email> <password> [name]
import 'dotenv/config';
import { db, now } from '../src/db.js';
import { hashPassword } from '../src/crypto.js';

const [email, password, name = 'Test User'] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error('Usage: npm run create-user -- <email> <password (8+ chars)> [name]');
  process.exit(1);
}

const hash = await hashPassword(password);
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
if (existing) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
  console.log(`Updated password for ${email}`);
} else {
  db.prepare('INSERT INTO users (email, name, password_hash, brand, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(email.toLowerCase(), name, hash, JSON.stringify({ name }), now());
  console.log(`Created user ${email}`);
}
