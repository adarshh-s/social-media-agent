import { z } from 'zod';
import { generateJSON, webResearch } from './llm.js';
import { db, getBrand } from './db.js';
import { TEMPLATES, IMAGE_TEMPLATES } from '../../shared/render.js';


const DEFAULT_BRAND = {
  name: '',
  role: '',
  audience: '',
  topics: '',
  voice: 'Clear, warm, practical. Short paragraphs. No corporate jargon.',
  avoid: 'Clickbait, excessive emojis, hashtag spam.',
  examples: '',
};

export function brandProfile(userId) {
  return { ...DEFAULT_BRAND, ...getBrand(userId) };
}

/* ---------- Quota: one unit per user-facing action, not per model call ---------- */

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 100);

export function useQuota(userId, units = 1) {
  const day = new Date().toISOString().slice(0, 10);
  const { count } = db.prepare(`
    INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, ?)
    ON CONFLICT(user_id, day) DO UPDATE SET count = count + excluded.count
    RETURNING count
  `).get(userId, day, units);
  if (count > DAILY_LIMIT) {
    throw Object.assign(new Error(`Daily AI limit of ${DAILY_LIMIT} generations reached. It resets at midnight UTC.`), { status: 429 });
  }
}

export function usageToday(userId) {
  const day = new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?').get(userId, day);
  return { used: row?.count ?? 0, limit: DAILY_LIMIT };
}

/* ---------- Prompts ---------- */

// Phrases and habits that make posts read as AI-written. Both the writer and the critic use this.
const AI_TELLS = `"In today's fast-paced world", "delve", "game-changer", "unlock", "elevate", "navigate the landscape",
"it's not just X, it's Y", "Here's the thing", "Let that sink in", "buckle up", "I'm thrilled/humbled to announce",
rhetorical triads everywhere, every line a one-sentence paragraph, em-dash overuse, generic motivational closers,
questions like "What do you think?" with no specific prompt, hashtags in the middle of sentences.`;

function systemPrompt(userId) {
  const b = brandProfile(userId);
  const examples = b.examples?.trim()
    ? `\n\nThe person's own best-performing posts. Match their rhythm, vocabulary, sentence length and formatting — this matters more than any rule above:\n<examples>\n${b.examples.slice(0, 12000)}\n</examples>`
    : '';
  return `You are an elite social media ghostwriter for one person/brand. Your posts consistently outperform because they are specific, human and useful — never generic.

Brand profile:
- Name: ${b.name || 'not set'}
- Role / what they do: ${b.role || 'not set'}
- Target audience: ${b.audience || 'not set'}
- Core topics: ${b.topics || 'not set'}
- Voice: ${b.voice}
- Avoid: ${b.avoid}

What makes a post great:
- The first line earns the click on "see more": a surprising claim, a specific number, a tension, or a moment from a story. Under ~12 words.
- One idea per post, made concrete with real specifics: numbers, names, examples, before/after, a mistake and what it taught.
- The reader leaves with something they can use or a perspective they didn't have.
- It sounds like a smart person talking, not a brand or an AI.
- Never invent statistics, quotes, clients or personal experiences. When you need a specific the brand hasn't given you, use verified research provided to you, or frame it as an opinion or a hypothetical.

Never use these AI tells: ${AI_TELLS}

Platform conventions:
- LinkedIn: hook line, short paragraphs with line breaks, 120–300 words unless asked otherwise, end with a specific question or clear takeaway, 0–3 relevant hashtags at the very end. Max 3000 characters.
- Instagram: caption supports the visual; hook first line, conversational, purposeful emojis at most, a clear call to action (save, share, comment a keyword), 5–12 targeted hashtags at the end. Max 2200 characters.
- Comments and replies: human, specific to what they're responding to, 1–4 sentences, no hashtags.${examples}

Return only the requested content; never wrap it in quotes or add commentary about it.`;
}

function structured(userId, schema, prompt, { effort = 'medium', images = [] } = {}) {
  return generateJSON({ system: systemPrompt(userId), prompt, schema, effort, images });
}

/* ---------- Research (web search via the active model) ---------- */

/**
 * Searches the web for current, citable facts about a topic.
 * Returns { notes, sources } — notes are short bullet points with source numbers.
 */
async function research(userId, topic, platform) {
  const b = brandProfile(userId);
  return webResearch(`Research this topic for a ${platform} post aimed at ${b.audience || 'professionals'}:
"${topic}"

Find 4–8 specific, recent and verifiable facts, numbers, examples or contrarian angles that would make the post more concrete and credible. Prefer primary sources and data from the last 18 months.
Reply with bullet points only, each ending with the source title and URL in brackets. If you find nothing reliable, say so.`);
}

/* ---------- Writing ---------- */

const Variants = z.object({
  variants: z.array(z.object({ text: z.string(), angle: z.string() })),
});

const Critique = z.object({
  reviews: z.array(z.object({
    index: z.number().describe('0-based index of the draft'),
    hook: z.number().describe('1-10'),
    specificity: z.number().describe('1-10'),
    value: z.number().describe('1-10'),
    voice: z.number().describe('1-10: sounds like this person, zero AI tells'),
    format: z.number().describe('1-10: platform formatting and length'),
    engagement: z.number().describe('1-10: invites a real response'),
    overall: z.number().describe('1-10, weighted: hook and specificity count double'),
    problems: z.array(z.string()).describe('Concrete problems, quoting the exact weak phrases'),
  })),
  best: z.number().describe('Index of the draft with the most potential after revision'),
  fixes: z.array(z.string()).describe('Specific edits that would make the best draft a 10'),
});

const Final = z.object({ text: z.string(), changes: z.string().describe('One sentence on what you improved') });

const CRITIC_RUBRIC = `Score like a demanding editor who has studied thousands of top-performing posts. A 7 is "fine but forgettable"; 9+ means it would clearly outperform. Penalise hard:
- a first line that doesn't create curiosity or tension
- vague claims without a specific example, number or story
- any AI tell (${AI_TELLS})
- invented facts or statistics not supported by the research or brand profile
- wrong length or formatting for the platform`;

async function critique(userId, platform, drafts) {
  return structured(
    userId,
    Critique,
    `Critique these ${platform} post drafts.\n\n${CRITIC_RUBRIC}\n\n` +
      drafts.map((d, i) => `<draft index="${i}">\n${d}\n</draft>`).join('\n\n'),
    { effort: 'high' }
  );
}

/**
 * The quality pipeline: (research) → drafts → critique → revise the best → re-score.
 * Returns { text, score, review, alternatives, sources, changes }.
 */
export async function bestPost(userId, { platform, topic, tone, length, cta, research: doResearch = false, draft }, { quota = true } = {}) {
  if (quota) useQuota(userId);

  const found = doResearch ? await research(userId, topic, platform).catch(() => ({ notes: '', sources: [] })) : { notes: '', sources: [] };
  const researchBlock = found.notes ? `\n\nVerified research you may use (cite numbers accurately, never embellish):\n${found.notes}` : '';

  const { variants } = await structured(
    userId,
    Variants,
    `Write 4 genuinely different ${platform} post drafts.
Topic / idea: ${topic}
${tone ? `Tone: ${tone}` : ''}
${length ? `Length: ${length}` : ''}
${cta ? `Call to action: ${cta}` : ''}
${draft ? `Starting draft to improve on (keep its core idea):\n${draft}\n` : ''}
Use different structures: a personal story, a contrarian take, a practical step-by-step, and a data or example-led post. "angle" is a 2-4 word label.${researchBlock}`,
    { effort: 'high' }
  );

  const review = await critique(userId, platform, variants.map((v) => v.text));
  const bestIdx = Math.min(Math.max(review.best, 0), variants.length - 1);

  const final = await structured(
    userId,
    Final,
    `Revise this ${platform} post into the best possible version. Apply every fix, keep what already works, and keep it in the brand's voice.

Fixes to apply:
${review.fixes.map((f) => `- ${f}`).join('\n')}

Post:
${variants[bestIdx].text}${researchBlock}`,
    { effort: 'high' }
  );

  const [score] = (await critique(userId, platform, [final.text])).reviews;
  return {
    text: final.text,
    changes: final.changes,
    score: score?.overall ?? null,
    review: score ?? null,
    alternatives: variants.map((v, i) => ({ ...v, score: review.reviews.find((r) => r.index === i)?.overall ?? null })),
    sources: found.sources,
  };
}

export function writePost(userId, { platform, topic, tone, length, cta, variants = 3 }) {
  useQuota(userId);
  return structured(
    userId,
    Variants,
    `Write ${variants} distinct ${platform} post variants.
Topic / idea: ${topic}
${tone ? `Tone: ${tone}` : ''}
${length ? `Length: ${length}` : ''}
${cta ? `Call to action: ${cta}` : ''}
Give each variant a different angle (e.g. story, contrarian take, how-to list, data-driven). "angle" is a 2-4 word label.`
  );
}

export function improvePost(userId, { platform, text, instruction }) {
  useQuota(userId);
  return structured(
    userId,
    Variants,
    `Rewrite this ${platform} post. Instruction: ${instruction || 'make it more engaging while keeping the meaning'}.
Return 2 variants.

Post:
${text}`
  );
}

export async function scorePost(userId, { platform, text }) {
  useQuota(userId);
  const [review] = (await critique(userId, platform, [text])).reviews;
  return review;
}

export function writeComments(userId, { platform, postText, author, goal, variants = 3 }) {
  useQuota(userId);
  return structured(
    userId,
    Variants,
    `Write ${variants} thoughtful comments I could leave on this ${platform} post${author ? ` by ${author}` : ''}.
Goal of commenting: ${goal || 'build a genuine relationship and show expertise without self-promotion'}.
Each comment must add something: an insight, an experience, or a sharp question. "angle" labels the approach.

Post:
${postText}`
  );
}

export function writeReplies(userId, { platform, myPost, comment, commenter, variants = 3 }) {
  useQuota(userId);
  return structured(
    userId,
    Variants,
    `Someone${commenter ? ` (${commenter})` : ''} commented on my ${platform} post. Write ${variants} reply options.
Be gracious, specific to what they said, and keep the conversation going where natural.

${myPost ? `My post:\n${myPost}\n\n` : ''}Their comment:
${comment}`
  );
}

/* ---------- Weekly plan ---------- */

const WeeklyPlan = z.object({
  theme: z.string(),
  strategy: z.string(),
  items: z.array(
    z.object({
      day: z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
      time: z.string().describe("24h HH:MM local time, chosen for that platform's engagement"),
      platform: z.enum(['linkedin', 'instagram']),
      format: z.enum(['text', 'image', 'video']).describe('Instagram items must be image or video'),
      title: z.string(),
      content: z.string().describe('The full ready-to-publish post text'),
      visual: z.string().describe('Poster or video idea for this post, or empty for text posts'),
    })
  ),
  engagement: z.array(z.string()).describe('Daily commenting / networking actions for the week'),
});

export function weeklyPlan(userId, { goal, platforms, postsPerWeek, weekStart, notes }, { quota = true } = {}) {
  if (quota) useQuota(userId);
  return structured(
    userId,
    WeeklyPlan,
    `Create my social media content plan for the week starting ${weekStart}.
Goal this week: ${goal}
Platforms: ${platforms.join(', ')}
Total posts: about ${postsPerWeek}
${notes ? `Extra context: ${notes}` : ''}

Mix formats and angles so the week tells a coherent story. Write every post in full, ready to publish.
Every Instagram post needs a visual (image or video). Use video for at most 2 posts.`,
    { effort: 'high' }
  );
}

/* ---------- Posters ---------- */

const PosterDesign = z.object({
  template: z.enum(TEMPLATES),
  headline: z.string().describe('Max 8 words. For the "stat" template: just the number, e.g. "73%"'),
  subheadline: z.string().describe('Max 18 words'),
  cta: z.string().describe('Max 4 words, or empty'),
  palette: z.object({
    background: z.string().describe('hex color'),
    accent: z.string().describe('hex color'),
    text: z.string().describe('hex color with WCAG AA contrast against background'),
  }),
  image_prompt: z.string().describe('For photo/split templates: a detailed prompt for an AI image model (subject, setting, lighting, lens, mood). Must say "no text". Empty otherwise.'),
});

const PosterReview = z.object({
  score: z.number().describe('1-10: would this stop the scroll and read clearly on a phone?'),
  problems: z.array(z.string()),
  revised: PosterDesign.describe('The design with fixes applied; repeat unchanged fields'),
  regenerate_image: z.boolean().describe('True only if the background image itself is the problem'),
});

export function designPoster(userId, { idea, style, size }) {
  return structured(
    userId,
    PosterDesign,
    `Design a social media poster (${size}).
Idea: ${idea}
${style ? `Visual style: ${style}` : ''}

Templates: bold (big type, solid colour), gradient, minimal (serif, elegant), quote, photo (full-bleed AI photo with text over a dark gradient), split (AI photo + text panel), stat (one giant number).
Pick the template that best fits the message — use photo/split when an evocative image adds meaning, stat when there's a strong number.
Copy must be punchy and readable at thumbnail size.`,
    { effort: 'medium' }
  );
}

export function reviewPoster(userId, { design, png }) {
  return structured(
    userId,
    PosterReview,
    `You are an art director. Review this rendered poster for a social feed.
Current design JSON: ${JSON.stringify({ ...design, image: undefined })}

Check: legibility at phone size, visual hierarchy, contrast, text overflowing or crowding, how well the image fits the message, and whether it would stop the scroll.
Return a revised design that fixes the problems (you may change copy, template or colours).`,
    { effort: 'medium', images: [{ mime: 'image/png', base64: png.toString('base64') }] }
  );
}

/* ---------- Video ---------- */

const VideoScript = z.object({
  title: z.string(),
  caption: z.string().describe('Post caption to publish with the video'),
  scenes: z.array(
    z.object({
      narration: z.string().describe('What the voiceover says in this scene: 1-2 short spoken sentences'),
      broll: z.string().describe('2-4 word stock-footage search query showing something concrete and visual, e.g. "woman typing laptop night"'),
      image_prompt: z.string().describe('Fallback prompt for an AI image of the same visual, cinematic, no text'),
    })
  ),
});

export function videoScript(userId, { idea, platform, seconds }, { quota = true } = {}) {
  if (quota) useQuota(userId);
  return structured(
    userId,
    VideoScript,
    `Write a faceless short-form ${platform} video: a voiceover over stock footage with bold captions.
Idea: ${idea}
Target length: about ${seconds} seconds of narration (~2.5 spoken words per second).

Rules for a high-retention video:
- Scene 1 is the hook: a bold claim, question or surprising fact in under 3 seconds. No greetings, no "in this video".
- Each scene is one beat: 1-2 short spoken sentences. 5-9 scenes total.
- Pattern interrupt every scene; build to a payoff; final scene is a clear call to action.
- Write for the ear: contractions, short words, no lists of numbers that are hard to hear.
- B-roll queries must describe filmable things (people, places, objects, actions), not abstract ideas.`,
    { effort: 'high' }
  );
}
