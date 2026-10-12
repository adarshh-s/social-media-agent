import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import { SIZES, PRESET_PALETTES, drawDesign } from '../../shared/render.js';
import { findStockClip, generateImage, speak } from './providers.js';
import { UPLOAD_DIR, saveMedia } from './media.js';
import { DATA_DIR } from './db.js';
import './poster.js'; // registers fonts

const FPS = 30;
const TMP_ROOT = path.join(DATA_DIR, 'tmp');

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let stderr = '';
    ff.stderr.on('data', (d) => (stderr = (stderr + d).slice(-3000)));
    ff.on('error', (e) => reject(new Error(`Could not start ffmpeg: ${e.message}`)));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${stderr}`))));
  });
}

/** Split narration into 2-4 word caption chunks, timed by character share of the spoken audio. */
function captionChunks(text, duration) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const chunks = [];
  for (let i = 0; i < words.length;) {
    let n = 3;
    if (words.length - i === 4) n = 2; // avoid a lonely last word
    chunks.push(words.slice(i, i + n).join(' '));
    i += n;
  }
  const total = chunks.reduce((a, c) => a + c.length + 2, 0);
  let t = 0;
  return chunks.map((c) => {
    const d = ((c.length + 2) / total) * duration;
    const chunk = { text: c, start: t, end: t + d };
    t += d;
    return chunk;
  });
}

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; } else line = test;
  }
  lines.push(line);
  return lines;
}

/** Transparent PNG with one caption chunk: heavy white text, dark outline, accent on the key word. */
function renderCaption(text, { w, h, accent, hook }) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const size = Math.round(Math.min(w, h) * (hook ? 0.105 : 0.085));
  ctx.font = `800 ${size}px Inter`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const lines = wrapLines(ctx, text, w * 0.84);
  const lh = size * 1.15;
  const y0 = h * (w > h ? 0.72 : 0.64) - ((lines.length - 1) * lh) / 2;
  // Emphasise the longest word — usually the meaningful one.
  const key = text.split(' ').reduce((a, b) => (b.replace(/\W/g, '').length > a.replace(/\W/g, '').length ? b : a), '');

  lines.forEach((line, i) => {
    const y = y0 + i * lh;
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(line, w / 2, y);
    // Draw word by word so the key word can be coloured.
    const width = ctx.measureText(line).width;
    let x = w / 2 - width / 2;
    ctx.textAlign = 'left';
    for (const word of line.split(' ')) {
      ctx.fillStyle = word === key ? accent : '#ffffff';
      ctx.fillText(word, x, y);
      x += ctx.measureText(`${word} `).width;
    }
    ctx.textAlign = 'center';
  });
  return canvas.toBuffer('image/png');
}

function renderBrand(brand, { w, h }) {
  const canvas = createCanvas(w, h);
  if (brand) {
    const ctx = canvas.getContext('2d');
    const size = Math.round(Math.min(w, h) * 0.032);
    ctx.font = `700 ${size}px Inter`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = size * 0.4;
    ctx.fillText(brand, w / 2, h * 0.08);
  }
  return canvas.toBuffer('image/png');
}

function fallbackFrame({ w, h, palette, size }) {
  const canvas = createCanvas(w, h);
  drawDesign(canvas, { template: 'gradient', size, palette, headline: '', subheadline: '', cta: '' });
  return canvas.toBuffer('image/png');
}

async function renderScene(i, scene, ctx) {
  const { w, h, dir, voice, accent, onProgress, used } = ctx;
  onProgress(`Scene ${i + 1}/${ctx.total}: voiceover`);
  const wav = path.join(dir, `voice-${i}.wav`);
  const speech = await speak(scene.narration, { voice, file: wav });
  const duration = speech + 0.35;

  onProgress(`Scene ${i + 1}/${ctx.total}: finding footage`);
  const orientation = w > h ? 'landscape' : w === h ? 'square' : 'portrait';
  let visual = await findStockClip(scene.broll, { orientation, minDuration: duration, dir, exclude: used }).catch((e) => {
    console.warn(`[reel] stock search failed: ${e.message}`);
    return null;
  });
  if (visual) ctx.credits.add(visual.credit);

  let isImage = false;
  if (!visual) {
    isImage = true;
    const img = path.join(dir, `image-${i}.png`);
    try {
      const { buffer } = await generateImage(`${scene.image_prompt}. Cinematic, vertical composition, no text.`, { width: w, height: h });
      fs.writeFileSync(img, buffer);
    } catch (e) {
      console.warn(`[reel] image generation failed: ${e.message}`);
      fs.writeFileSync(img, fallbackFrame(ctx));
    }
    visual = { file: img };
  }

  const captions = captionChunks(scene.narration, speech);
  const captionFiles = captions.map((c, j) => {
    const f = path.join(dir, `cap-${i}-${j}.png`);
    fs.writeFileSync(f, renderCaption(c.text, { w, h, accent, hook: i === 0 }));
    return f;
  });

  const frames = Math.round(duration * FPS);
  const input = isImage ? ['-i', visual.file] : ['-stream_loop', '-1', '-t', duration.toFixed(3), '-i', visual.file];
  const base = isImage
    ? `[0:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},` +
      `zoompan=z='min(zoom+0.0009,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${FPS}`
    : `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${FPS}`;

  // Slight darkening keeps white captions readable on bright footage.
  const filters = [`${base},setsar=1,eq=brightness=-0.06:saturation=1.08[v0]`];
  let last = 'v0';
  captions.forEach((c, j) => {
    const out = `c${j}`;
    filters.push(`[${last}][${j + 3}:v]overlay=enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[${out}]`);
    last = out;
  });
  filters.push(`[${last}][2:v]overlay[vout]`);
  filters.push(`[1:a]aresample=44100,aformat=channel_layouts=stereo,apad[aout]`);

  const out = path.join(dir, `scene-${i}.mp4`);
  await ffmpeg([
    ...input,
    '-i', wav,
    '-i', ctx.brandFile,
    ...captionFiles.flatMap((f) => ['-i', f]),
    '-filter_complex', filters.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-t', duration.toFixed(3),
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
    out,
  ]);
  return out;
}

/**
 * Render a faceless reel from a script: per-scene voiceover + stock footage (or AI image)
 * + animated captions, concatenated, with optional background music. Saves to the media library.
 */
export async function createReel(userId, { script, size = 'story', voice = 'af_heart', brand = '', musicFile = null, onProgress = () => {} }) {
  const { w, h } = SIZES[size] || SIZES.story;
  const dir = path.join(TMP_ROOT, crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  const palette = PRESET_PALETTES[Math.floor(Math.random() * PRESET_PALETTES.length)];

  try {
    const ctx = {
      w, h, dir, voice, size, palette, onProgress,
      accent: '#ffd400',
      total: script.scenes.length,
      used: new Set(),
      credits: new Set(),
      brandFile: path.join(dir, 'brand.png'),
    };
    fs.writeFileSync(ctx.brandFile, renderBrand(brand, { w, h }));

    const segments = [];
    for (const [i, scene] of script.scenes.entries()) segments.push(await renderScene(i, scene, ctx));

    onProgress('Stitching scenes');
    const list = path.join(dir, 'list.txt');
    fs.writeFileSync(list, segments.map((s) => `file '${s}'`).join('\n'));
    const joined = path.join(dir, 'joined.mp4');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', joined]);

    const filename = `${crypto.randomUUID()}.mp4`;
    const final = path.join(UPLOAD_DIR, filename);
    if (musicFile) {
      onProgress('Adding music');
      await ffmpeg([
        '-i', joined, '-stream_loop', '-1', '-i', musicFile,
        '-filter_complex', '[1:a]volume=0.12[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]',
        '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', final,
      ]);
    } else {
      fs.copyFileSync(joined, final);
    }

    const media = saveMedia(userId, { kind: 'video', filename, mime: 'video/mp4', label: script.title?.slice(0, 60) });
    return { media, credits: [...ctx.credits] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
