import cron from 'node-cron';
import { db, now, getAccount, getMedia, updateAccountToken } from './db.js';
import { cleanupExpired } from './auth.js';
import { runWeeklyAutopilot } from './autopilot.js';
import * as linkedin from './platforms/linkedin.js';
import * as instagram from './platforms/instagram.js';

export const platforms = { linkedin, instagram };

export async function publishPost(userId, id) {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND user_id = ?').get(id, userId);
  if (!post) throw Object.assign(new Error('Post not found'), { status: 404 });

  // Claim the post so a concurrent scheduler tick can't publish it twice.
  const claimed = db
    .prepare(`UPDATE posts SET status = 'publishing', updated_at = ? WHERE id = ? AND status IN ('draft','scheduled','failed','needs_approval')`)
    .run(now(), id);
  if (claimed.changes === 0) throw Object.assign(new Error(`Post is already ${post.status}`), { status: 409 });

  try {
    const account = getAccount(userId, post.platform);
    if (!account) throw new Error(`Connect your ${post.platform} account first`);
    if (account.expires_at && account.expires_at < now()) {
      throw new Error(`${post.platform} connection expired — reconnect it on the Accounts page`);
    }
    const externalId = await platforms[post.platform].publish(account, {
      content: post.content,
      media: getMedia(userId, post.media_id),
    });
    db.prepare(
      `UPDATE posts SET status = 'published', published_at = ?, external_id = ?, error = NULL, updated_at = ? WHERE id = ?`
    ).run(now(), externalId, now(), id);
  } catch (err) {
    db.prepare(`UPDATE posts SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).run(err.message, now(), id);
    throw err;
  }
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
}

const CONCURRENCY = 5;

async function publishDuePosts() {
  const due = db
    .prepare(`SELECT id, user_id FROM posts WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 200`)
    .all(now());
  // Small worker pool so one slow upload (e.g. a video) doesn't hold up everyone else's posts.
  const queue = [...due];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        try {
          await publishPost(p.user_id, p.id);
          console.log(`[scheduler] published post ${p.id} (user ${p.user_id})`);
        } catch (err) {
          console.error(`[scheduler] post ${p.id} (user ${p.user_id}) failed: ${err.message}`);
        }
      }
    })
  );
}

async function refreshInstagramTokens() {
  const tenDays = 10 * 24 * 60 * 60 * 1000;
  const rows = db
    .prepare(`SELECT user_id FROM accounts WHERE platform = 'instagram' AND expires_at > ? AND expires_at < ?`)
    .all(now(), now() + tenDays);
  for (const { user_id } of rows) {
    try {
      const t = await instagram.refreshToken(getAccount(user_id, 'instagram'));
      updateAccountToken(user_id, 'instagram', t);
    } catch (err) {
      console.error(`[scheduler] Instagram token refresh failed for user ${user_id}: ${err.message}`);
    }
  }
}

export function startScheduler() {
  // Recover posts stuck in 'publishing' after a crash/restart.
  db.prepare(`UPDATE posts SET status = 'failed', error = 'Interrupted while publishing' WHERE status = 'publishing'`).run();

  let running = false;
  cron.schedule('* * * * *', async () => {
    if (running) return;
    running = true;
    try {
      await publishDuePosts();
    } finally {
      running = false;
    }
  });
  // Friday evening: autopilot drafts next week, leaving the weekend to approve anything flagged.
  cron.schedule('0 18 * * 5', runWeeklyAutopilot);
  cron.schedule('0 3 * * *', async () => {
    cleanupExpired();
    await refreshInstagramTokens();
  });
  console.log('[scheduler] running — checks for due posts every minute');
}
