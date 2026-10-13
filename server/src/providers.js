// Free-tier media providers. Each function is the single place to swap in a paid
// provider (e.g. fal.ai for images/video, ElevenLabs for voice) later.
import fs from 'node:fs';
import path from 'node:path';
import { geminiImage } from './llm.js';
import { DATA_DIR } from './db.js';

/* ---------- AI images ---------- */

const hasCloudflare = () => Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);

/** Image providers in the order they're tried. */
export function imageProviders() {
  return [hasCloudflare() && 'cloudflare', process.env.GEMINI_API_KEY && 'gemini', 'pollinations'].filter(Boolean);
}
export const imageProvider = () => imageProviders()[0];

async function cloudflareImage(prompt) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 8 }),
    }
  );
  const data = await res.json().catch(() => ({}));
  const image = data.result?.image ?? data.image;
  if (!res.ok || !image) {
    throw new Error(`Cloudflare image generation failed (${res.status}): ${JSON.stringify(data.errors ?? data).slice(0, 300)}`);
  }
  return { buffer: Buffer.from(image, 'base64'), mime: 'image/jpeg' };
}

async function pollinationsImage(prompt, { width, height }) {
  const params = new URLSearchParams({
    width: String(width), height: String(height), model: 'flux', nologo: 'true', seed: String(Math.floor(Math.random() * 1e6)),
  });
  const res = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 1000))}?${params}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) {
    throw new Error(`Pollinations image generation failed (${res.status})`);
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') };
}

/**
 * Generate an image from a prompt. Returns { buffer, mime }.
 * Tries Cloudflare Workers AI (FLUX), then Gemini's image model, then Pollinations'
 * keyless endpoint — moving on whenever one fails or hits its free limit.
 */
export async function generateImage(prompt, { width = 1024, height = 1024 } = {}) {
  const errors = [];
  for (const provider of imageProviders()) {
    try {
      if (provider === 'cloudflare') return await cloudflareImage(prompt);
      if (provider === 'gemini') {
        const shape = width > height ? 'wide landscape' : height > width ? 'tall portrait' : 'square';
        return await geminiImage(`${prompt}. ${shape} composition.`);
      }
      return await pollinationsImage(prompt, { width, height });
    } catch (err) {
      errors.push(`${provider}: ${err.message.slice(0, 160)}`);
    }
  }
  throw new Error(`All image providers failed — ${errors.join(' | ')}`);
}

/* ---------- Stock video (Pexels, Pixabay) ---------- */

export const stockProviders = () =>
  [process.env.PEXELS_API_KEY && 'pexels', process.env.PIXABAY_API_KEY && 'pixabay'].filter(Boolean);
export const hasStockVideo = () => stockProviders().length > 0;

// Pixabay's terms require caching search results for 24 hours.
const CACHE_FILE = path.join(DATA_DIR, 'stock-cache.json');
const DAY = 24 * 60 * 60 * 1000;
let cache;
function cached(key, fetcher) {
  cache ??= fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
  const hit = cache[key];
  if (hit && Date.now() - hit.at < DAY) return hit.data;
  return fetcher().then((data) => {
    for (const [k, v] of Object.entries(cache)) if (Date.now() - v.at >= DAY) delete cache[k];
    cache[key] = { at: Date.now(), data };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    return data;
  });
}

/** Normalised candidates: [{ id, duration, width, height, url, credit }] */
async function searchPexels(query, orientation) {
  const params = new URLSearchParams({ query, orientation, size: 'medium', per_page: '15' });
  const res = await fetch(`https://api.pexels.com/v1/videos/search?${params}`, {
    headers: { Authorization: process.env.PEXELS_API_KEY },
  });
  if (!res.ok) throw new Error(`Pexels search failed (${res.status})`);
  const { videos = [] } = await res.json();
  return videos.flatMap((v) => {
    // Prefer an HD mp4 around 1080px on the short side — big enough, not huge.
    const [f] = v.video_files
      .filter((f) => f.file_type === 'video/mp4' && f.width && f.height)
      .sort((a, b) => Math.abs(Math.min(a.width, a.height) - 1080) - Math.abs(Math.min(b.width, b.height) - 1080));
    return f ? [{ id: `pexels-${v.id}`, duration: v.duration, width: f.width, height: f.height, url: f.link, credit: `${v.user?.name ?? 'Creator'} on Pexels` }] : [];
  });
}

async function searchPixabay(query, orientation) {
  const params = new URLSearchParams({ key: process.env.PIXABAY_API_KEY, q: query.slice(0, 100), video_type: 'film', per_page: '20', safesearch: 'true' });
  const hits = await cached(`pixabay:${query}`, async () => {
    const res = await fetch(`https://pixabay.com/api/videos/?${params}`);
    if (!res.ok) throw new Error(`Pixabay search failed (${res.status})`);
    return (await res.json()).hits ?? [];
  });
  const items = hits.flatMap((v) => {
    const f = v.videos.medium?.url ? v.videos.medium : v.videos.small;
    return f?.url ? [{ id: `pixabay-${v.id}`, duration: v.duration, width: f.width, height: f.height, url: f.url, credit: `${v.user} on Pixabay` }] : [];
  });
  // Pixabay has no orientation filter, so rank clips whose shape matches the video first.
  const fits = (c) => (orientation === 'portrait' ? c.height > c.width : orientation === 'landscape' ? c.width > c.height : true);
  return [...items.filter(fits), ...items.filter((c) => !fits(c))];
}

/**
 * Find a stock clip for a search query and download it.
 * Returns { file, credit } or null when nothing suitable is found.
 */
export async function findStockClip(query, { orientation, minDuration, dir, exclude = new Set() }) {
  for (const provider of stockProviders()) {
    try {
      const results = provider === 'pexels' ? await searchPexels(query, orientation) : await searchPixabay(query, orientation);
      const pick = results.find((c) => !exclude.has(c.id) && c.duration >= Math.min(minDuration, 8));
      if (!pick) continue;
      const dl = await fetch(pick.url);
      if (!dl.ok) throw new Error(`${provider} download failed (${dl.status})`);
      const dest = path.join(dir, `${pick.id}.mp4`);
      fs.writeFileSync(dest, Buffer.from(await dl.arrayBuffer()));
      exclude.add(pick.id);
      return { file: dest, credit: pick.credit };
    } catch (err) {
      console.warn(`[stock] ${err.message}`);
    }
  }
  return null;
}

/* ---------- Voiceover (Kokoro, runs locally) ---------- */

export const VOICES = {
  af_heart: 'Heart (US, female, warm)',
  af_bella: 'Bella (US, female, bright)',
  af_nicole: 'Nicole (US, female, calm)',
  am_michael: 'Michael (US, male, confident)',
  am_fenrir: 'Fenrir (US, male, deep)',
  am_puck: 'Puck (US, male, energetic)',
  bf_emma: 'Emma (UK, female)',
  bm_george: 'George (UK, male)',
};

let ttsPromise;
function loadTTS() {
  // ~90 MB model, downloaded from Hugging Face on first use and cached afterwards.
  ttsPromise ??= (async () => {
    // Keep the model on the data disk so container rebuilds don't re-download it.
    const { env } = await import('@huggingface/transformers');
    env.cacheDir = path.join(DATA_DIR, 'models');
    const { KokoroTTS } = await import('kokoro-js');
    return KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
  })();
  return ttsPromise;
}

/** Synthesize speech to a WAV file. Returns its duration in seconds. */
export async function speak(text, { voice = 'af_heart', speed = 1.05, file }) {
  const tts = await loadTTS();
  const audio = await tts.generate(text, { voice: VOICES[voice] ? voice : 'af_heart', speed });
  await audio.save(file);
  return audio.audio.length / audio.sampling_rate;
}
