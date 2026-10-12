import { Router } from 'express';
import fs from 'node:fs';
import { db, now } from './db.js';
import { hashPassword, verifyPassword, sha256, randomToken } from './crypto.js';
import { UPLOAD_DIR } from './media.js';

const COOKIE = 'sid';
const SESSION_DAYS = 30;

const secure = () => String(process.env.SERVER_URL).startsWith('https://');

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setSessionCookie(res, token, maxAgeMs) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secure(),
    maxAge: maxAgeMs,
    path: '/',
  });
}

function startSession(res, userId) {
  const token = randomToken();
  const ttl = SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, now() + ttl);
  setSessionCookie(res, token, ttl);
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });

/** Attaches req.user when a valid session cookie is present. */
export function loadUser(req, _res, next) {
  const token = readCookie(req, COOKIE);
  if (token) {
    const row = db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(sha256(token), now());
    if (row) req.user = publicUser(row);
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in' });
  next();
}

// Simple in-memory brute-force protection: 10 attempts per 15 minutes per IP + email.
const attempts = new Map();
function rateLimited(key) {
  const windowMs = 15 * 60 * 1000;
  const entry = attempts.get(key);
  if (!entry || entry.reset < now()) {
    attempts.set(key, { count: 1, reset: now() + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > 10;
}
setInterval(() => {
  for (const [k, v] of attempts) if (v.reset < now()) attempts.delete(k);
}, 60 * 1000).unref();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const auth = Router();

auth.post('/signup', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!name) return res.status(400).json({ error: 'Enter your name' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (process.env.ALLOW_SIGNUPS === 'false') return res.status(403).json({ error: 'Sign-ups are currently closed' });
  if (rateLimited(`signup:${req.ip}`)) return res.status(429).json({ error: 'Too many attempts, try again later' });

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (email, name, password_hash, brand, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(email, name, await hashPassword(password), JSON.stringify({ name }), now());
  startSession(res, Number(lastInsertRowid));
  res.json(publicUser({ id: Number(lastInsertRowid), email, name }));
});

auth.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (rateLimited(`login:${req.ip}:${email}`)) return res.status(429).json({ error: 'Too many attempts, try again in 15 minutes' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  startSession(res, user.id);
  res.json(publicUser(user));
});

auth.post('/logout', (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

auth.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  res.json(req.user);
});

auth.post('/change-password', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await verifyPassword(String(req.body.current || ''), user.password_hash))) {
    return res.status(401).json({ error: 'Current password is wrong' });
  }
  if (String(req.body.next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(req.body.next), user.id);
  // Sign out every other device.
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, sha256(readCookie(req, COOKIE)));
  res.json({ ok: true });
});

/** Permanently deletes the user, their connected accounts, posts, plans and media files. */
auth.delete('/account', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await verifyPassword(String(req.body.password || ''), user.password_hash))) {
    return res.status(401).json({ error: 'Password is wrong' });
  }
  const files = db.prepare('SELECT filename FROM media WHERE user_id = ?').all(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id); // cascades to all user data
  for (const f of files) fs.rmSync(`${UPLOAD_DIR}/${f.filename}`, { force: true });
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

export function cleanupExpired() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  db.prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(now());
}
