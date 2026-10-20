import * as THREE from 'three';

/* Shared 2D-canvas helpers for everything printed: covers, pages, props. */

export const SERIF = '"Bodoni Moda", "Didot", Georgia, serif';
export const TEXT = '"Newsreader", "Georgia", serif';
export const SANS = '"Archivo", "Helvetica Neue", Arial, sans-serif';
export const MONO = '"DM Mono", ui-monospace, monospace';

/** Canvas `letterSpacing` is recent (older Safari lacks it); the covers and pages
 *  lean on tracking, so browsers without it get a small per-glyph fallback. */
const NATIVE_TRACKING = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;

function polyfillTracking(x: CanvasRenderingContext2D) {
  let ls = 0;
  Object.defineProperty(x, 'letterSpacing', {
    configurable: true,
    get: () => `${ls}px`,
    set: (v: string) => { ls = parseFloat(String(v)) || 0; },
  });
  const fill = x.fillText.bind(x);
  const measure = x.measureText.bind(x);
  x.fillText = (text: string, px: number, py: number) => {
    if (!ls || text.length < 2) { fill(text, px, py); return; }
    const chars = Array.from(text);
    // place glyph i where the run *including* it ends, minus its own advance —
    // that keeps the kerning pair it forms with the glyph before it
    const total = measure(text).width + ls * chars.length;
    const align = x.textAlign;
    const x0 = align === 'center' ? px - total / 2 : align === 'right' || align === 'end' ? px - total : px;
    x.textAlign = 'left';
    let run = '';
    chars.forEach((ch, i) => {
      run += ch;
      fill(ch, x0 + measure(run).width - measure(ch).width + ls * i, py);
    });
    x.textAlign = align;
  };
  x.measureText = (text: string) => {
    const m = measure(text);
    if (!ls) return m;
    const extra = ls * Array.from(text).length;
    return new Proxy(m, { get: (t, k) => (k === 'width' ? t.width + extra : Reflect.get(t, k, t)) });
  };
}

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  if (!NATIVE_TRACKING) polyfillTracking(x);
  x.textBaseline = 'alphabetic';
  return { c, x };
}

export function toTexture(c: HTMLCanvasElement, aniso = 8, release = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  // once the pixels are on the GPU the canvas is dead weight — free it (iOS
  // Safari caps total canvas memory, and printed pages add up fast)
  if (release) {
    let freed = false;
    t.onUpdate = () => {
      if (freed) return;
      freed = true;
      c.width = 1;
      c.height = 1;
    };
  }
  return t;
}

/** Load every face/weight the canvases use (canvas text never triggers a load). */
export async function loadFonts() {
  if (!document.fonts) return;
  const faces = [
    `900 100px "Bodoni Moda"`, `800 100px "Bodoni Moda"`, `700 100px "Bodoni Moda"`, `600 100px "Bodoni Moda"`,
    `500 100px "Bodoni Moda"`, `400 100px "Bodoni Moda"`,
    `italic 500 100px "Bodoni Moda"`, `italic 400 100px "Bodoni Moda"`, `italic 700 100px "Bodoni Moda"`,
    `400 40px "Newsreader"`, `italic 400 40px "Newsreader"`, `500 40px "Newsreader"`, `600 40px "Newsreader"`, `italic 300 40px "Newsreader"`,
    `400 40px "Archivo"`, `500 40px "Archivo"`, `600 40px "Archivo"`, `700 40px "Archivo"`, `800 40px "Archivo"`,
    `400 40px "DM Mono"`, `500 40px "DM Mono"`,
  ];
  try {
    await Promise.race([
      Promise.all(faces.map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 4500)),
    ]);
  } catch { /* fall back to system faces */ }
}

export function font(x: CanvasRenderingContext2D, spec: string, tracking = 0) {
  x.font = spec;
  (x as any).letterSpacing = `${tracking}px`;
}

/** Fit a single line of text into maxW by shrinking the size. Returns the size used. */
export function fitText(x: CanvasRenderingContext2D, text: string, template: (s: number) => string, size: number, maxW: number, tracking = 0) {
  let s = size;
  for (let i = 0; i < 40; i++) {
    font(x, template(s), tracking * (s / size));
    if (x.measureText(text).width <= maxW) break;
    s *= 0.96;
  }
  return s;
}

/** Word-wrap; returns the y after the last line. */
export function wrapText(x: CanvasRenderingContext2D, text: string, px: number, y: number, maxW: number, lh: number, maxLines = 99, align: CanvasTextAlign = 'left') {
  x.textAlign = align;
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (x.measureText(test).width > maxW && line) {
      x.fillText(line, px, y);
      lines++;
      if (lines >= maxLines) return y + lh;
      line = words[i];
      y += lh;
    } else line = test;
  }
  if (line) { x.fillText(line, px, y); y += lh; }
  return y;
}

let grainTile: HTMLCanvasElement | null = null;
/** one tile of mid-grey noise, made once */
function noiseTile() {
  if (grainTile) return grainTile;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const img = x.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return (grainTile = c);
}

/** Paper / print grain: a noise tile laid over in 'overlay' (no pixel read-back,
 *  which on a GPU canvas stalls — and covers are 1200×1590). */
export function grain(x: CanvasRenderingContext2D, w: number, h: number, amount = 0.035, dark = true) {
  const pattern = x.createPattern(noiseTile(), 'repeat');
  if (!pattern) return;
  x.save();
  x.globalCompositeOperation = 'overlay';
  x.globalAlpha = Math.min(1, amount * (dark ? 1 : 0.8));
  x.fillStyle = pattern;
  x.fillRect(0, 0, w, h);
  x.restore();
}

/** A believable EAN-13-ish barcode block. */
export function barcode(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, ink: string, bg: string, digits = '9 771234 567003') {
  x.fillStyle = bg;
  x.fillRect(px - 10, py - 10, w + 20, h + 40);
  x.fillStyle = ink;
  let cx = px;
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  while (cx < px + w) {
    const bw = rnd() < 0.5 ? 1.6 : rnd() < 0.5 ? 3.2 : 4.6;
    const guard = cx - px < 6 || px + w - cx < 6 || Math.abs(cx - (px + w / 2)) < 4;
    x.fillRect(cx, py, bw, guard ? h + 10 : h);
    cx += bw + (rnd() < 0.5 ? 1.6 : 3.2);
  }
  font(x, `500 ${Math.round(h * 0.22)}px ${MONO}`, 1);
  x.textAlign = 'center';
  x.fillText(digits, px + w / 2, py + h + h * 0.3);
  font(x, `500 10px ${MONO}`, 0);
}

export function hexToRgba(hex: string, a: number) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

/** Studio-backdrop ground: soft radial light falloff, like a lit paper sweep. */
export function backdrop(x: CanvasRenderingContext2D, w: number, h: number, bg: string, deep: string, cx = 0.5, cy = 0.42) {
  x.fillStyle = deep;
  x.fillRect(0, 0, w, h);
  const g = x.createRadialGradient(w * cx, h * cy, 0, w * cx, h * cy, Math.max(w, h) * 0.78);
  g.addColorStop(0, bg);
  g.addColorStop(0.55, bg);
  g.addColorStop(1, deep);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
}
