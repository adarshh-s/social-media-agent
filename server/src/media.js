import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { db, now, DATA_DIR } from './db.js';

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'video/mp4': '.mp4', 'audio/mpeg': '.mp3' };

export const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + (EXT[file.mimetype] || path.extname(file.originalname))),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    EXT[file.mimetype] ? cb(null, true) : cb(Object.assign(new Error('Only PNG, JPEG, MP4 and MP3 files are allowed'), { status: 400 })),
});

export const mediaPath = (media) => path.join(UPLOAD_DIR, media.filename);

/** Public URL for a media file. Instagram must be able to fetch this from the internet. */
export const mediaUrl = (media) =>
  `${process.env.PUBLIC_MEDIA_URL || process.env.SERVER_URL}/uploads/${media.filename}`;

export function saveMedia(userId, { kind, filename, mime, label }) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO media (user_id, kind, filename, mime, label, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, kind, filename, mime, label ?? null, now());
  return db.prepare('SELECT * FROM media WHERE id = ?').get(lastInsertRowid);
}
