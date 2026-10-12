import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { db, now, getAccount, saveAccount, getMedia, setBrand, getPrefs, setPrefs } from './db.js';
import * as ai from './ai.js';
import { platforms, publishPost } from './publisher.js';
import { upload, saveMedia, mediaPath, mediaUrl } from './media.js';
import { createPoster } from './poster.js';
import { enqueue, getJob, listJobs } from './jobs.js';
import { startAutopilot } from './autopilot.js';
import { imageProviders, hasStockVideo, stockProviders, VOICES } from './providers.js';
import { textProvider } from './llm.js';
import { postUrnFrom } from './platforms/linkedin.js';
import { requireAuth } from './auth.js';

export const api = Router();

// Wrap async handlers so thrown errors become JSON responses.
const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    if (!err.status || err.status >= 500) console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  });

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const clampVariants = (n) => Math.min(Math.max(Number(n) || 3, 1), 5);

const withMedia = (post) => {
  const media = getMedia(post.user_id, post.media_id);
  return {
    ...post,
    quality_notes: post.quality_notes ? JSON.parse(post.quality_notes) : null,
    media: media && { ...media, url: `/uploads/${media.filename}` },
  };
};

/* ---------- OAuth callback (no session needed: the state row identifies the user) ---------- */

api.get('/accounts/:platform/callback', h(async (req, res) => {
  const { platform } = req.params;
  const back = `${process.env.CLIENT_URL}/accounts`;
  const fail = (msg) => res.redirect(`${back}?error=${encodeURIComponent(msg)}`);
  if (!platforms[platform]) return fail('Unknown platform');

  const row = db.prepare('SELECT * FROM oauth_states WHERE state = ? AND platform = ? AND expires_at > ?')
    .get(String(req.query.state || ''), platform, now());
  if (row) db.prepare('DELETE FROM oauth_states WHERE state = ?').run(row.state);
  if (req.query.error) return fail(req.query.error_description || req.query.error);
  if (!row) return fail('This connection link expired, please try again');

  try {
    const acc = await platforms[platform].exchangeCode(String(req.query.code).replace(/#_$/, ''));
    // One social account can only belong to one user of this app.
    const taken = db.prepare('SELECT user_id FROM accounts WHERE platform = ? AND external_id = ? AND user_id != ?')
      .get(platform, String(acc.external_id), row.user_id);
    if (taken) return fail(`This ${platform} account is already connected to another user`);
    saveAccount(row.user_id, platform, acc);
    res.redirect(`${back}?connected=${platform}`);
  } catch (err) {
    console.error(err);
    fail(err.message);
  }
}));

// Everything below requires a logged-in user.
api.use(requireAuth);
const uid = (req) => req.user.id;

/* ---------- Brand voice ---------- */

api.get('/settings/brand', h((req, res) => res.json(ai.brandProfile(uid(req)))));
api.put('/settings/brand', h((req, res) => {
  const allowed = ['name', 'role', 'audience', 'topics', 'voice', 'avoid', 'examples'];
  setBrand(uid(req), Object.fromEntries(allowed.map((k) => [k, String(req.body[k] ?? '').slice(0, k === 'examples' ? 12000 : 2000)])));
  res.json(ai.brandProfile(uid(req)));
}));

/* ---------- Preferences & capabilities ---------- */

api.get('/settings/prefs', h((req, res) => res.json(getPrefs(uid(req)))));
api.put('/settings/prefs', h((req, res) => {
  const cur = getPrefs(uid(req));
  const b = req.body;
  const a = b.autopilot ?? {};
  const next = {
    ...cur,
    qualityThreshold: Math.min(Math.max(Number(b.qualityThreshold ?? cur.qualityThreshold), 1), 10),
    voice: VOICES[b.voice] ? b.voice : cur.voice,
    timezone: typeof b.timezone === 'string' && b.timezone.length < 64 ? b.timezone : cur.timezone,
    autopilot: {
      ...cur.autopilot,
      enabled: Boolean(a.enabled ?? cur.autopilot.enabled),
      goal: String(a.goal ?? cur.autopilot.goal).slice(0, 1000),
      platforms: (a.platforms ?? cur.autopilot.platforms).filter((p) => platforms[p]),
      postsPerWeek: Math.min(Math.max(Number(a.postsPerWeek ?? cur.autopilot.postsPerWeek) || 5, 1), 14),
      research: Boolean(a.research ?? cur.autopilot.research),
    },
  };
  setPrefs(uid(req), next);
  res.json(next);
}));

api.get('/capabilities', h((_req, res) => res.json({
  text: textProvider(),
  images: imageProviders()[0],
  imageChain: imageProviders(),
  stockVideo: hasStockVideo(),
  stockProviders: stockProviders(),
  voices: VOICES,
})));

/* ---------- Accounts ---------- */

api.get('/accounts', h((req, res) => {
  const rows = db.prepare('SELECT platform, name, avatar, expires_at, connected_at FROM accounts WHERE user_id = ?').all(uid(req));
  res.json({
    accounts: rows,
    configured: {
      linkedin: Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
      instagram: Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
    },
  });
}));

api.get('/accounts/:platform/connect', h((req, res) => {
  const p = platforms[req.params.platform];
  if (!p) throw bad('Unknown platform');
  const state = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO oauth_states (state, user_id, platform, expires_at) VALUES (?, ?, ?, ?)')
    .run(state, uid(req), req.params.platform, now() + 10 * 60 * 1000);
  res.redirect(p.authUrl(state));
}));

api.delete('/accounts/:platform', h((req, res) => {
  db.prepare('DELETE FROM accounts WHERE user_id = ? AND platform = ?').run(uid(req), req.params.platform);
  res.json({ ok: true });
}));

/* ---------- AI writing ---------- */

api.get('/ai/usage', h((req, res) => res.json(ai.usageToday(uid(req)))));
api.post('/ai/best-post', h(async (req, res) => res.json(await ai.bestPost(uid(req), req.body))));
api.post('/ai/score', h(async (req, res) => res.json(await ai.scorePost(uid(req), req.body))));
api.post('/ai/post', h(async (req, res) => res.json(await ai.writePost(uid(req), { ...req.body, variants: clampVariants(req.body.variants) }))));
api.post('/ai/improve', h(async (req, res) => res.json(await ai.improvePost(uid(req), req.body))));
api.post('/ai/comments', h(async (req, res) => res.json(await ai.writeComments(uid(req), { ...req.body, variants: clampVariants(req.body.variants) }))));
api.post('/ai/replies', h(async (req, res) => res.json(await ai.writeReplies(uid(req), { ...req.body, variants: clampVariants(req.body.variants) }))));
api.post('/ai/video-script', h(async (req, res) => res.json(await ai.videoScript(uid(req), req.body))));

/* ---------- Weekly plans ---------- */

api.post('/plans', h(async (req, res) => {
  const { goal, platforms: plats = ['linkedin'], postsPerWeek = 5, weekStart, notes } = req.body;
  if (!goal || !weekStart) throw bad('goal and weekStart are required');
  const plan = await ai.weeklyPlan(uid(req), {
    goal, notes, weekStart,
    platforms: plats.filter((p) => platforms[p]),
    postsPerWeek: Math.min(Math.max(Number(postsPerWeek) || 5, 1), 21),
  });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO plans (user_id, week_start, goal, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uid(req), weekStart, goal, JSON.stringify(plan), now());
  res.json({ id: Number(lastInsertRowid), week_start: weekStart, goal, ...plan });
}));

api.get('/plans', h((req, res) => {
  const rows = db.prepare('SELECT * FROM plans WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(uid(req));
  res.json(rows.map(({ data, ...r }) => ({ ...r, ...JSON.parse(data) })));
}));

/* ---------- Posts ---------- */

const getPost = (req) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND user_id = ?').get(req.params.id, uid(req));
  if (!post) throw Object.assign(new Error('Post not found'), { status: 404 });
  return post;
};

const checkMedia = (req, mediaId) => {
  if (mediaId != null && !getMedia(uid(req), mediaId)) throw bad('Media not found');
};

api.get('/posts', h((req, res) => {
  const { status, platform } = req.query;
  let sql = 'SELECT * FROM posts WHERE user_id = ?';
  const args = [uid(req)];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  if (platform) { sql += ' AND platform = ?'; args.push(platform); }
  sql += ' ORDER BY COALESCE(scheduled_at, published_at, created_at) DESC';
  res.json(db.prepare(sql).all(...args).map(withMedia));
}));

api.post('/posts', h((req, res) => {
  const { platform, content, media_id = null, scheduled_at = null, plan_id = null } = req.body;
  if (!platforms[platform]) throw bad('platform must be linkedin or instagram');
  if (!content?.trim()) throw bad('content is required');
  checkMedia(req, media_id);
  const status = scheduled_at ? 'scheduled' : 'draft';
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO posts (user_id, platform, content, media_id, status, scheduled_at, plan_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uid(req), platform, content, media_id, status, scheduled_at, plan_id, now(), now());
  res.json(withMedia(db.prepare('SELECT * FROM posts WHERE id = ?').get(lastInsertRowid)));
}));

api.patch('/posts/:id', h((req, res) => {
  const post = getPost(req);
  if (['published', 'publishing'].includes(post.status)) throw bad(`Can't edit a ${post.status} post`);
  const { platform = post.platform, content = post.content, media_id = post.media_id, scheduled_at = post.scheduled_at } = req.body;
  if (!platforms[platform]) throw bad('platform must be linkedin or instagram');
  checkMedia(req, media_id);
  db.prepare(`
    UPDATE posts SET platform = ?, content = ?, media_id = ?, scheduled_at = ?, status = ?, error = NULL, updated_at = ?
    WHERE id = ?
  `).run(platform, content, media_id, scheduled_at, scheduled_at ? 'scheduled' : 'draft', now(), post.id);
  res.json(withMedia(db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id)));
}));

api.delete('/posts/:id', h((req, res) => {
  db.prepare('DELETE FROM posts WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
  res.json({ ok: true });
}));

api.post('/posts/:id/publish', h(async (req, res) => res.json(withMedia(await publishPost(uid(req), req.params.id)))));

/* ---------- Engagement ---------- */

api.post('/linkedin/comment', h(async (req, res) => {
  const account = getAccount(uid(req), 'linkedin');
  if (!account) throw bad('Connect LinkedIn first');
  const urn = postUrnFrom(req.body.post);
  if (!urn) throw bad('Paste a LinkedIn post URL or URN (e.g. urn:li:activity:123...)');
  res.json({ id: await platforms.linkedin.comment(account, urn, req.body.text) });
}));

api.get('/instagram/comments', h(async (req, res) => {
  const account = getAccount(uid(req), 'instagram');
  if (!account) throw bad('Connect Instagram first');
  res.json(await platforms.instagram.recentMediaWithComments(account));
}));

api.post('/instagram/comments/:id/reply', h(async (req, res) => {
  const account = getAccount(uid(req), 'instagram');
  if (!account) throw bad('Connect Instagram first');
  res.json({ id: await platforms.instagram.reply(account, req.params.id, req.body.message) });
}));

/* ---------- Media library, posters, videos ---------- */

api.get('/media', h((req, res) => {
  const rows = db.prepare('SELECT * FROM media WHERE user_id = ? ORDER BY created_at DESC').all(uid(req));
  res.json(rows.map((m) => ({ ...m, url: `/uploads/${m.filename}`, public_url: mediaUrl(m) })));
}));

api.post('/media', upload.single('file'), h((req, res) => {
  if (!req.file) throw bad('No file uploaded');
  const kind = req.file.mimetype.split('/')[0] === 'audio' ? 'audio' : req.file.mimetype.startsWith('video/') ? 'video' : 'image';
  const m = saveMedia(uid(req), { kind, filename: req.file.filename, mime: req.file.mimetype, label: req.body.label });
  res.json({ ...m, url: `/uploads/${m.filename}` });
}));

api.delete('/media/:id', h((req, res) => {
  const m = getMedia(uid(req), req.params.id);
  if (m) {
    fs.rmSync(mediaPath(m), { force: true });
    db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
  }
  res.json({ ok: true });
}));

const withUrl = (m) => m && { ...m, url: `/uploads/${m.filename}` };

// Full poster pipeline (AI design → AI image → render → AI art-director review). ~20-60s.
api.post('/posters/generate', h(async (req, res) => {
  const { idea, style, size = 'square' } = req.body;
  if (!idea?.trim()) throw bad('Describe the poster idea');
  ai.useQuota(uid(req));
  const r = await createPoster(uid(req), { idea, style, size, brand: ai.brandProfile(uid(req)).name });
  res.json({ ...r, media: withUrl(r.media), background: withUrl(r.background) });
}));

// Reels render in the background; poll /jobs/:id.
api.post('/reels', h((req, res) => {
  const { script, size = 'story', voice, music_id = null } = req.body;
  if (!script?.scenes?.length) throw bad('The script has no scenes');
  if (script.scenes.length > 15) throw bad('Keep videos to 15 scenes or fewer');
  for (const sc of script.scenes) {
    if (!String(sc.narration || '').trim()) throw bad('Every scene needs narration');
  }
  if (music_id != null && getMedia(uid(req), music_id)?.kind !== 'audio') throw bad('Music file not found');
  res.json(enqueue(uid(req), 'reel', { script, size, voice, music_id }));
}));

api.get('/jobs', h((req, res) => res.json(listJobs(uid(req)))));
api.get('/jobs/:id', h((req, res) => {
  const job = getJob(uid(req), req.params.id);
  if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
  res.json(job);
}));

api.post('/autopilot/run', h((req, res) => res.json(startAutopilot(uid(req), req.body ?? {}))));

api.post('/posts/:id/approve', h((req, res) => {
  const post = getPost(req);
  if (post.status !== 'needs_approval') throw bad(`Post is ${post.status}`);
  if (post.platform === 'instagram' && !post.media_id) throw bad('Attach an image or video before approving');
  // A slot that already passed publishes on the next scheduler tick.
  const at = Math.max(post.scheduled_at ?? 0, now());
  db.prepare(`UPDATE posts SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?`).run(at, now(), post.id);
  res.json(withMedia(db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id)));
}));

/* ---------- Dashboard ---------- */

api.get('/stats', h((req, res) => {
  const u = uid(req);
  const counts = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS n FROM posts WHERE user_id = ? GROUP BY status').all(u).map((r) => [r.status, r.n])
  );
  const upcoming = db
    .prepare(`SELECT * FROM posts WHERE user_id = ? AND status = 'scheduled' ORDER BY scheduled_at LIMIT 5`)
    .all(u).map(withMedia);
  const failed = db
    .prepare(`SELECT * FROM posts WHERE user_id = ? AND status = 'failed' ORDER BY updated_at DESC LIMIT 5`)
    .all(u).map(withMedia);
  res.json({ counts, upcoming, failed, usage: ai.usageToday(u) });
}));
