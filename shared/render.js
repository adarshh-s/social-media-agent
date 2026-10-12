// Poster renderer shared by the browser (live preview) and the server (autopilot
// posters, video captions). Works with any Canvas 2D context: DOM or @napi-rs/canvas.

export const SIZES = {
  square: { w: 1080, h: 1080, label: 'Square 1:1 — Instagram / LinkedIn' },
  portrait: { w: 1080, h: 1350, label: 'Portrait 4:5 — Instagram feed' },
  story: { w: 1080, h: 1920, label: 'Story / Reel 9:16' },
  landscape: { w: 1200, h: 627, label: 'Landscape — LinkedIn link style' },
};

export const TEMPLATES = ['bold', 'gradient', 'minimal', 'quote', 'photo', 'split', 'stat'];
export const IMAGE_TEMPLATES = ['photo', 'split'];

export const PRESET_PALETTES = [
  { background: '#0f172a', accent: '#38bdf8', text: '#f8fafc' },
  { background: '#fef3c7', accent: '#d97706', text: '#1c1917' },
  { background: '#1e1b4b', accent: '#f472b6', text: '#ffffff' },
  { background: '#ecfdf5', accent: '#059669', text: '#064e3b' },
  { background: '#111111', accent: '#facc15', text: '#ffffff' },
  { background: '#ffffff', accent: '#2563eb', text: '#0f172a' },
];

const SANS = '"Inter", system-ui, sans-serif';
const SERIF = '"Playfair Display", Georgia, serif';


function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

/** Largest font size (<= max) at which text fits in the box. */
function fit(ctx, text, { weight, family, max, min = 20, width, height, lh = 1.12 }) {
  for (let size = max; size >= min; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    const lines = wrap(ctx, text, width);
    if (lines.length * size * lh <= height) return { size, lines, lh };
  }
  ctx.font = `${weight} ${min}px ${family}`;
  return { size: min, lines: wrap(ctx, text, width), lh };
}

function drawLines(ctx, { size, lines, lh }, x, y, align = 'left') {
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * lh));
  return y + lines.length * size * lh;
}

function pill(ctx, text, x, y, { bg, fg, size, align = 'left' }) {
  ctx.font = `700 ${size}px ${SANS}`;
  const padX = size * 0.9, padY = size * 0.55;
  const w = ctx.measureText(text).width + padX * 2, h = size + padY * 2;
  const left = align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(left, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, y + h / 2 + 1);
  return h;
}

/** Draw img to fill the box (x, y, bw, bh), cropping the overflow. */
function coverImage(ctx, img, w, h, x = 0, y = 0) {
  const s = Math.max(w / img.width, h / img.height);
  const iw = img.width * s, ih = img.height * s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  ctx.restore();
}

export function drawDesign(canvas, d) {
  const { w, h } = SIZES[d.size] || SIZES.square;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const p = d.palette;
  const m = Math.round(Math.min(w, h) * 0.08); // margin
  const unit = Math.min(w, h) / 1080;
  const innerW = w - m * 2;

  ctx.fillStyle = p.background;
  ctx.fillRect(0, 0, w, h);

  const brand = () => {
    if (!d.brand) return;
    ctx.font = `600 ${Math.round(26 * unit)}px ${SANS}`;
    ctx.fillStyle = d.template === 'photo' ? '#ffffff' : p.text;
    ctx.globalAlpha = 0.75;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(d.brand, w - m, h - m * 0.6);
    ctx.globalAlpha = 1;
  };

  if (d.template === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, p.background);
    g.addColorStop(1, p.accent);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = p.text;
    const head = fit(ctx, d.headline, { weight: 800, family: SANS, max: 120 * unit, width: innerW, height: h * 0.42 });
    const sub = fit(ctx, d.subheadline, { weight: 500, family: SANS, max: 40 * unit, width: innerW * 0.9, height: h * 0.16, lh: 1.35 });
    const ctaH = d.cta ? 90 * unit : 0;
    const total = head.lines.length * head.size * head.lh + 30 * unit + sub.lines.length * sub.size * sub.lh + ctaH;
    let y = (h - total) / 2;
    ctx.font = `800 ${head.size}px ${SANS}`;
    y = drawLines(ctx, head, w / 2, y, 'center') + 30 * unit;
    ctx.font = `500 ${sub.size}px ${SANS}`;
    ctx.globalAlpha = 0.9;
    y = drawLines(ctx, sub, w / 2, y, 'center') + 36 * unit;
    ctx.globalAlpha = 1;
    if (d.cta) pill(ctx, d.cta, w / 2, y, { bg: p.text, fg: p.accent, size: 30 * unit, align: 'center' });
  } else if (d.template === 'minimal') {
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 6 * unit;
    ctx.strokeRect(m / 2, m / 2, w - m, h - m);
    ctx.fillStyle = p.text;
    const head = fit(ctx, d.headline, { weight: 700, family: SERIF, max: 110 * unit, width: innerW * 0.88, height: h * 0.45 });
    const sub = fit(ctx, d.subheadline, { weight: 500, family: SANS, max: 34 * unit, width: innerW * 0.8, height: h * 0.15, lh: 1.4 });
    const total = head.lines.length * head.size * head.lh + 50 * unit + sub.lines.length * sub.size * sub.lh;
    let y = (h - total) / 2;
    ctx.font = `700 ${head.size}px ${SERIF}`;
    y = drawLines(ctx, head, w / 2, y, 'center') + 20 * unit;
    ctx.fillStyle = p.accent;
    ctx.fillRect(w / 2 - 40 * unit, y, 80 * unit, 5 * unit);
    y += 30 * unit;
    ctx.fillStyle = p.text;
    ctx.font = `500 ${sub.size}px ${SANS}`;
    drawLines(ctx, sub, w / 2, y, 'center');
    if (d.cta) {
      ctx.font = `700 ${28 * unit}px ${SANS}`;
      ctx.fillStyle = p.accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(d.cta.toUpperCase(), w / 2, h - m * 1.1);
    }
  } else if (d.template === 'quote') {
    ctx.fillStyle = p.accent;
    ctx.font = `700 ${320 * unit}px ${SERIF}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('“', m - 10 * unit, m - 60 * unit);
    ctx.fillStyle = p.text;
    const head = fit(ctx, d.headline, { weight: 700, family: SERIF, max: 96 * unit, width: innerW, height: h * 0.5, lh: 1.2 });
    ctx.font = `700 ${head.size}px ${SERIF}`;
    let y = drawLines(ctx, head, m, m + 230 * unit) + 40 * unit;
    if (d.subheadline) {
      ctx.fillStyle = p.accent;
      ctx.font = `600 ${34 * unit}px ${SANS}`;
      ctx.fillText(`— ${d.subheadline}`, m, y);
    }
  } else if (d.template === 'photo') {
    if (d.image) coverImage(ctx, d.image, w, h);
    const g = ctx.createLinearGradient(0, h * 0.3, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const sub = fit(ctx, d.subheadline, { weight: 500, family: SANS, max: 36 * unit, width: innerW, height: h * 0.14, lh: 1.35 });
    const head = fit(ctx, d.headline, { weight: 800, family: SANS, max: 104 * unit, width: innerW, height: h * 0.3 });
    const ctaH = d.cta ? 100 * unit : 0;
    const subH = sub.lines.length * sub.size * sub.lh;
    const headH = head.lines.length * head.size * head.lh;
    let y = h - m * 1.4 - ctaH - subH - 24 * unit - headH;
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${head.size}px ${SANS}`;
    y = drawLines(ctx, head, m, y) + 24 * unit;
    ctx.font = `500 ${sub.size}px ${SANS}`;
    ctx.globalAlpha = 0.9;
    y = drawLines(ctx, sub, m, y) + 30 * unit;
    ctx.globalAlpha = 1;
    if (d.cta) pill(ctx, d.cta, m, y, { bg: p.accent, fg: '#ffffff', size: 30 * unit });
  } else if (d.template === 'split') {
    // Image on top (or left for landscape), text panel below.
    const landscape = w > h;
    const imgW = landscape ? w * 0.5 : w, imgH = landscape ? h : h * 0.52;
    if (d.image) coverImage(ctx, d.image, imgW, imgH);
    else { ctx.fillStyle = p.accent; ctx.fillRect(0, 0, imgW, imgH); }
    const tx = landscape ? imgW + m * 0.8 : m, ty = landscape ? m : imgH + m * 0.7;
    const tw = landscape ? w - imgW - m * 1.6 : innerW;
    const th = landscape ? h - m * 2 : h - imgH - m * 1.5;
    ctx.fillStyle = p.accent;
    ctx.fillRect(tx, ty, 90 * unit, 10 * unit);
    ctx.fillStyle = p.text;
    const head = fit(ctx, d.headline, { weight: 800, family: SANS, max: 92 * unit, width: tw, height: th * 0.55 });
    ctx.font = `800 ${head.size}px ${SANS}`;
    let y = drawLines(ctx, head, tx, ty + 34 * unit) + 22 * unit;
    const sub = fit(ctx, d.subheadline, { weight: 500, family: SANS, max: 36 * unit, width: tw, height: th * 0.28, lh: 1.35 });
    ctx.font = `500 ${sub.size}px ${SANS}`;
    ctx.globalAlpha = 0.85;
    y = drawLines(ctx, sub, tx, y) + 24 * unit;
    ctx.globalAlpha = 1;
    if (d.cta && y + 80 * unit < h - m * 0.5) pill(ctx, d.cta, tx, y, { bg: p.accent, fg: p.background, size: 28 * unit });
  } else if (d.template === 'stat') {
    // Giant number/stat as the hero; headline holds the stat, subheadline explains it.
    ctx.fillStyle = p.accent;
    const head = fit(ctx, d.headline, { weight: 800, family: SANS, max: 300 * unit, min: 60, width: innerW, height: h * 0.4, lh: 1 });
    ctx.font = `800 ${head.size}px ${SANS}`;
    let y = drawLines(ctx, head, m, h * 0.18) + 30 * unit;
    ctx.fillStyle = p.text;
    const sub = fit(ctx, d.subheadline, { weight: 700, family: SANS, max: 56 * unit, width: innerW * 0.92, height: h * 0.28, lh: 1.25 });
    ctx.font = `700 ${sub.size}px ${SANS}`;
    drawLines(ctx, sub, m, y);
    if (d.cta) {
      ctx.font = `600 ${30 * unit}px ${SANS}`;
      ctx.fillStyle = p.accent;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${d.cta} →`, m, h - m * 0.9);
    }
  } else {
    // bold
    ctx.fillStyle = p.accent;
    ctx.fillRect(0, 0, w, 18 * unit);
    ctx.fillRect(m, m + 20 * unit, 120 * unit, 12 * unit);
    ctx.fillStyle = p.text;
    const head = fit(ctx, d.headline, { weight: 800, family: SANS, max: 130 * unit, width: innerW, height: h * 0.48 });
    ctx.font = `800 ${head.size}px ${SANS}`;
    let y = drawLines(ctx, head, m, m + 80 * unit) + 36 * unit;
    const sub = fit(ctx, d.subheadline, { weight: 500, family: SANS, max: 42 * unit, width: innerW * 0.92, height: h * 0.18, lh: 1.35 });
    ctx.font = `500 ${sub.size}px ${SANS}`;
    ctx.globalAlpha = 0.85;
    drawLines(ctx, sub, m, y);
    ctx.globalAlpha = 1;
    if (d.cta) pill(ctx, d.cta, m, h - m - 80 * unit, { bg: p.accent, fg: p.background, size: 32 * unit });
  }
  brand();
}


