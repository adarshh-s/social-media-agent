// Minimal persistent job queue for long-running work (video renders, autopilot weeks).
// Runs in-process; swap for BullMQ/a worker service when scaling past one server.
import { db, now } from './db.js';

const handlers = {};
const CONCURRENCY = Number(process.env.JOB_CONCURRENCY || 2);
let running = 0;

export function registerJob(kind, handler) {
  handlers[kind] = handler;
}

export function enqueue(userId, kind, input = {}) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO jobs (user_id, kind, input, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, kind, JSON.stringify(input), now(), now());
  setImmediate(tick);
  return getJob(userId, Number(lastInsertRowid));
}

export function getJob(userId, id) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ? AND user_id = ?').get(id, userId);
  return row && toJson(row);
}

export function listJobs(userId, limit = 20) {
  return db.prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit).map(toJson);
}

const toJson = ({ input, result, ...j }) => ({ ...j, input: JSON.parse(input), result: result ? JSON.parse(result) : null });

async function run(job) {
  const progress = (text) => db.prepare('UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?').run(text, now(), job.id);
  try {
    const result = await handlers[job.kind]({ ...job, input: JSON.parse(job.input) }, progress);
    db.prepare(`UPDATE jobs SET status = 'done', result = ?, progress = NULL, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(result ?? null), now(), job.id);
  } catch (err) {
    console.error(`[jobs] ${job.kind} #${job.id} failed:`, err);
    db.prepare(`UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`).run(err.message, now(), job.id);
  }
}

function tick() {
  while (running < CONCURRENCY) {
    const job = db.prepare(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1`).get();
    if (!job) return;
    const claimed = db.prepare(`UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'`).run(now(), job.id);
    if (!claimed.changes) continue;
    running++;
    run(job).finally(() => {
      running--;
      setImmediate(tick);
    });
  }
}

export function startJobs() {
  db.prepare(`UPDATE jobs SET status = 'failed', error = 'Server restarted while this was running' WHERE status = 'running'`).run();
  setInterval(tick, 3000).unref();
  tick();
}
