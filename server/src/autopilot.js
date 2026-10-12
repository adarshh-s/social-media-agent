// Autopilot: plan a week, run every post through the quality pipeline, create its
// poster or video, and schedule it. Posts below the user's quality threshold wait for approval.
import fs from 'node:fs';
import { db, now, getPrefs, setPrefs, getMedia } from './db.js';
import * as ai from './ai.js';
import { createPoster } from './poster.js';
import { createReel } from './reel.js';
import { registerJob, enqueue } from './jobs.js';
import { mediaPath } from './media.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** UTC timestamp for a wall-clock time in an IANA time zone. */
export function zonedTime(dateStr, time, timeZone = 'UTC') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (time || '09:00').split(':').map(Number);
  const target = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  const offsetAt = (ts) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
        .formatToParts(new Date(ts)).map((p) => [p.type, p.value])
    );
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - ts;
  };
  let guess = target - offsetAt(target);
  guess = target - offsetAt(guess); // second pass handles DST boundaries
  return guess;
}

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Next Monday's date (YYYY-MM-DD) in the user's time zone. */
export function nextMonday(timeZone = 'UTC') {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, ((8 - dow) % 7) || 7);
}

function brandHandle(userId) {
  return ai.brandProfile(userId).name || '';
}

async function produceItem(userId, item, { weekStart, prefs, planId, progress, label }) {
  const at = zonedTime(addDays(weekStart, DAYS.indexOf(item.day)), item.time, prefs.timezone);
  const needsVisual = item.platform === 'instagram' || item.format !== 'text';
  let text = item.content, score = null, notes = {}, mediaId = null, problem = null;

  try {
    progress(`${label}: writing the best version`);
    const best = await ai.bestPost(userId, {
      platform: item.platform, topic: item.title, draft: item.content, research: prefs.autopilot.research,
    }, { quota: false });
    text = best.text;
    score = best.score;
    notes = { problems: best.review?.problems ?? [], changes: best.changes, sources: best.sources };

    if (needsVisual && item.format === 'video') {
      progress(`${label}: scripting the video`);
      const script = await ai.videoScript(userId, { idea: item.visual || item.title, platform: item.platform, seconds: 30 }, { quota: false });
      progress(`${label}: rendering the video`);
      const reel = await createReel(userId, {
        script, size: item.platform === 'instagram' ? 'story' : 'square', voice: prefs.voice, brand: brandHandle(userId),
        onProgress: (p) => progress(`${label}: ${p}`),
      });
      mediaId = reel.media.id;
      if (reel.credits.length) notes.credits = reel.credits;
    } else if (needsVisual) {
      progress(`${label}: designing the poster`);
      const poster = await createPoster(userId, {
        idea: item.visual || item.title, size: item.platform === 'instagram' ? 'portrait' : 'square', brand: brandHandle(userId),
      });
      mediaId = poster.media.id;
    }
  } catch (err) {
    problem = err.message;
  }

  const ready = !problem && score != null && score >= prefs.qualityThreshold && (!needsVisual || mediaId) && at > now();
  if (problem) notes.error = problem;
  const status = ready ? 'scheduled' : 'needs_approval';

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO posts (user_id, platform, content, media_id, status, scheduled_at, plan_id, quality_score, quality_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, item.platform, text, mediaId, status, at, planId, score, JSON.stringify(notes), now(), now());
  return { id: Number(lastInsertRowid), status, score };
}

registerJob('autopilot', async (job, progress) => {
  const userId = job.user_id;
  const prefs = getPrefs(userId);
  const { weekStart, goal, platforms, postsPerWeek } = job.input;

  progress('Planning the week');
  ai.useQuota(userId);
  const plan = await ai.weeklyPlan(userId, { goal, platforms, postsPerWeek, weekStart }, { quota: false });
  const { lastInsertRowid: planId } = db
    .prepare('INSERT INTO plans (user_id, week_start, goal, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, weekStart, goal, JSON.stringify(plan), now());

  ai.useQuota(userId, plan.items.length); // one generation per post, checked before doing the work
  const posts = [];
  for (const [i, item] of plan.items.entries()) {
    posts.push(await produceItem(userId, item, {
      weekStart, prefs, planId: Number(planId), progress, label: `Post ${i + 1}/${plan.items.length} (${item.platform})`,
    }));
  }
  return {
    plan_id: Number(planId),
    theme: plan.theme,
    scheduled: posts.filter((p) => p.status === 'scheduled').length,
    needs_approval: posts.filter((p) => p.status === 'needs_approval').length,
    posts,
  };
});

registerJob('reel', async (job, progress) => {
  const { script, size, voice, music_id } = job.input;
  const music = music_id ? getMedia(job.user_id, music_id) : null;
  const reel = await createReel(job.user_id, {
    script, size, voice: voice || getPrefs(job.user_id).voice, brand: brandHandle(job.user_id),
    musicFile: music && fs.existsSync(mediaPath(music)) ? mediaPath(music) : null,
    onProgress: progress,
  });
  return { media: { ...reel.media, url: `/uploads/${reel.media.filename}` }, credits: reel.credits };
});

export function startAutopilot(userId, overrides = {}) {
  const prefs = getPrefs(userId);
  const a = { ...prefs.autopilot, ...overrides };
  if (!a.goal?.trim()) throw Object.assign(new Error('Set an autopilot goal first'), { status: 400 });
  const weekStart = overrides.weekStart || nextMonday(prefs.timezone);
  return enqueue(userId, 'autopilot', {
    weekStart, goal: a.goal, platforms: a.platforms, postsPerWeek: a.postsPerWeek,
  });
}

/** Called weekly by the scheduler: queue next week for every user with autopilot on. */
export function runWeeklyAutopilot() {
  const users = db.prepare('SELECT id FROM users').all();
  for (const { id } of users) {
    const prefs = getPrefs(id);
    if (!prefs.autopilot.enabled || !prefs.autopilot.goal) continue;
    const weekStart = nextMonday(prefs.timezone);
    if (prefs.autopilot.lastWeek === weekStart) continue;
    try {
      startAutopilot(id, { weekStart });
      setPrefs(id, { ...prefs, autopilot: { ...prefs.autopilot, lastWeek: weekStart } });
      console.log(`[autopilot] queued week of ${weekStart} for user ${id}`);
    } catch (err) {
      console.error(`[autopilot] user ${id}: ${err.message}`);
    }
  }
}
