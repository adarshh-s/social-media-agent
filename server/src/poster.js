import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { drawDesign, SIZES, IMAGE_TEMPLATES } from '../../shared/render.js';
import { designPoster, reviewPoster } from './ai.js';
import { generateImage } from './providers.js';
import { UPLOAD_DIR, saveMedia } from './media.js';

// Same font families the browser loads from Google Fonts, so previews match server renders.
const FONT_DIR = path.resolve('assets/fonts');
for (const f of fs.readdirSync(FONT_DIR)) {
  GlobalFonts.registerFromPath(path.join(FONT_DIR, f), f.startsWith('Playfair') ? 'Playfair Display' : 'Inter');
}

export async function renderPoster(design, imageBuffer) {
  const canvas = createCanvas(10, 10);
  const image = imageBuffer ? await loadImage(imageBuffer) : null;
  drawDesign(canvas, { ...design, image });
  return canvas.toBuffer('image/png');
}

async function imageFor(design) {
  if (!IMAGE_TEMPLATES.includes(design.template) || !design.image_prompt) return null;
  const { w, h } = SIZES[design.size] || SIZES.square;
  const { buffer } = await generateImage(`${design.image_prompt}. No text, no letters, no logos, no watermark.`, { width: w, height: h });
  return buffer;
}

/**
 * Full poster pipeline: AI design → AI background image → render →
 * Claude reviews the rendered image → apply fixes → final render.
 * Saves the poster (and its background photo) to the user's media library.
 */
export async function createPoster(userId, { idea, style, size = 'square', brand, label }) {
  let design = { ...(await designPoster(userId, { idea, style, size })), size, brand };

  let image = await imageFor(design).catch((err) => {
    console.warn(`[poster] image generation failed, using a text layout: ${err.message}`);
    design = { ...design, template: 'bold' };
    return null;
  });
  let png = await renderPoster(design, image);

  const review = await reviewPoster(userId, { design, png });
  let score = review.score;
  if (review.score < 9) {
    const revised = { ...review.revised, size, brand };
    if (review.regenerate_image || (IMAGE_TEMPLATES.includes(revised.template) && !image)) {
      image = await imageFor(revised).catch(() => image);
    }
    if (IMAGE_TEMPLATES.includes(revised.template) && !image) revised.template = 'bold';
    design = revised;
    png = await renderPoster(design, image);
    score = null; // revised version hasn't been re-scored
  }

  const filename = `${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), png);
  const media = saveMedia(userId, { kind: 'image', filename, mime: 'image/png', label: label || design.headline.slice(0, 60) });

  let background = null;
  if (image) {
    const bgName = `${crypto.randomUUID()}.jpg`;
    fs.writeFileSync(path.join(UPLOAD_DIR, bgName), image);
    background = saveMedia(userId, { kind: 'image', filename: bgName, mime: 'image/jpeg', label: `Background: ${design.headline.slice(0, 40)}` });
  }

  return { media, design, background, review: { firstScore: review.score, score, problems: review.problems } };
}
