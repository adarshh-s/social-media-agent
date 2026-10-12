// Browser helpers around the shared poster renderer.
export * from '../../../shared/render.js';

export async function ensureFonts() {
  await Promise.all([
    document.fonts.load('800 64px "Inter"'),
    document.fonts.load('500 32px "Inter"'),
    document.fonts.load('700 64px "Playfair Display"'),
  ]).catch(() => {});
}

export const canvasToBlob = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/png'));

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
