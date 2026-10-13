import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { api } from './routes.js';
import { auth, loadUser } from './auth.js';
import { encrypt } from './crypto.js';
import { UPLOAD_DIR } from './media.js';
import { startScheduler } from './publisher.js';
import { startJobs } from './jobs.js';
import './autopilot.js'; // registers job handlers

const PORT = Number(process.env.PORT) || 4000;
process.env.SERVER_URL ||= `http://localhost:${PORT}`;
process.env.CLIENT_URL ||= 'http://localhost:5173';

encrypt('startup check'); // fail fast if TOKEN_ENCRYPTION_KEY is missing or invalid

const app = express();
// Number of proxies in front of the app (Vercel → Caddy → app = 2), so req.ip is the real visitor.
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(loadUser);

// Media files have unguessable UUID names; they must stay public because Instagram fetches them by URL.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true }));
app.use('/api/auth', auth);
app.use('/api', api);

// In production, serve the built React app from the same origin as the API.
const CLIENT_DIST = path.resolve('../client/dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/api\/|\/uploads\/).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

// Errors thrown by middleware such as multer (bad file type, file too large).
app.use((err, _req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`API listening on ${process.env.SERVER_URL}`);
  startScheduler();
  startJobs();
});
