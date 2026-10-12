import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt } from './crypto.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

// Databases from the single-user version have no user_id columns.
const legacy = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'posts'`).get() &&
  !db.prepare(`SELECT 1 FROM pragma_table_info('posts') WHERE name = 'user_id'`).get();
if (legacy) {
  throw new Error('server/data/app.db is from the single-user version. Move or delete it, then restart.');
}

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name           TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    brand          TEXT NOT NULL DEFAULT '{}',
    created_at     INTEGER NOT NULL
  );

  -- Only a SHA-256 of the session token is stored, so a leaked DB can't be used to log in.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    state       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform    TEXT NOT NULL,
    expires_at  INTEGER NOT NULL
  );

  -- access_token is AES-256-GCM encrypted (see crypto.js)
  CREATE TABLE IF NOT EXISTS accounts (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform      TEXT NOT NULL,
    external_id   TEXT NOT NULL,
    name          TEXT,
    avatar        TEXT,
    access_token  TEXT NOT NULL,
    expires_at    INTEGER,
    connected_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, platform)
  );

  CREATE TABLE IF NOT EXISTS media (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,          -- image | video
    filename    TEXT NOT NULL,
    mime        TEXT NOT NULL,
    label       TEXT,
    created_at  INTEGER NOT NULL
  );

  -- status: draft | scheduled | publishing | published | failed
  CREATE TABLE IF NOT EXISTS posts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform      TEXT NOT NULL,
    content       TEXT NOT NULL,
    media_id      INTEGER REFERENCES media(id) ON DELETE SET NULL,
    status        TEXT NOT NULL DEFAULT 'draft',
    scheduled_at  INTEGER,
    published_at  INTEGER,
    external_id   TEXT,
    error         TEXT,
    plan_id       INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS posts_user ON posts(user_id, status);
  CREATE INDEX IF NOT EXISTS posts_due ON posts(status, scheduled_at);

  CREATE TABLE IF NOT EXISTS plans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start  TEXT NOT NULL,
    goal        TEXT,
    data        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_usage (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day      TEXT NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );

  -- Long-running work (video renders, autopilot weeks). status: queued | running | done | failed
  CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued',
    progress    TEXT,
    input       TEXT NOT NULL DEFAULT '{}',
    result      TEXT,
    error       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
`);

// Additive migrations for databases created by earlier versions.
function addColumn(table, column, type) {
  if (!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
addColumn('posts', 'quality_score', 'REAL');
addColumn('posts', 'quality_notes', 'TEXT');
addColumn('users', 'prefs', `TEXT NOT NULL DEFAULT '{}'`);

export const now = () => Date.now();

export const DEFAULT_PREFS = {
  qualityThreshold: 8, // posts scoring below this (out of 10) wait for approval
  voice: 'af_heart',
  autopilot: { enabled: false, goal: '', platforms: ['linkedin', 'instagram'], postsPerWeek: 5, research: true },
};

export function getPrefs(userId) {
  const row = db.prepare('SELECT prefs FROM users WHERE id = ?').get(userId);
  const p = row ? JSON.parse(row.prefs) : {};
  return { ...DEFAULT_PREFS, ...p, autopilot: { ...DEFAULT_PREFS.autopilot, ...p.autopilot } };
}

export function setPrefs(userId, prefs) {
  db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(prefs), userId);
}

export function getAccount(userId, platform) {
  const row = db.prepare('SELECT * FROM accounts WHERE user_id = ? AND platform = ?').get(userId, platform);
  return row ? { ...row, access_token: decrypt(row.access_token) } : null;
}

export function saveAccount(userId, platform, acc) {
  db.prepare(`
    INSERT INTO accounts (user_id, platform, external_id, name, avatar, access_token, expires_at, connected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, platform) DO UPDATE SET external_id = excluded.external_id, name = excluded.name,
      avatar = excluded.avatar, access_token = excluded.access_token, expires_at = excluded.expires_at,
      connected_at = excluded.connected_at
  `).run(userId, platform, String(acc.external_id), acc.name, acc.avatar, encrypt(acc.access_token), acc.expires_at, now());
}

export function updateAccountToken(userId, platform, { access_token, expires_at }) {
  db.prepare('UPDATE accounts SET access_token = ?, expires_at = ? WHERE user_id = ? AND platform = ?')
    .run(encrypt(access_token), expires_at, userId, platform);
}

export function getMedia(userId, id) {
  return id ? db.prepare('SELECT * FROM media WHERE id = ? AND user_id = ?').get(id, userId) ?? null : null;
}

export function getBrand(userId) {
  const row = db.prepare('SELECT brand FROM users WHERE id = ?').get(userId);
  return row ? JSON.parse(row.brand) : {};
}

export function setBrand(userId, brand) {
  db.prepare('UPDATE users SET brand = ? WHERE id = ?').run(JSON.stringify(brand), userId);
}
