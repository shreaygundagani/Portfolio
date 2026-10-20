import * as THREE from 'three';
import { ISSUES, IssueId, IDENTITY, IssueMeta } from '../config';
import type { Colourway, CoverStyle } from '../theme';
import type { Shot } from '../scene/studio';
import { makeCanvas, toTexture, font, wrapText, hexToRgba, backdrop, SERIF, SANS, TEXT, MONO } from './canvas';

/* ============================================================================
 * The inside pages. Each issue is laid out like a real magazine: running
 * heads, folios, feature openers, a flat-lay spread with numbered callouts,
 * two-column body copy with drop caps, pull quotes and a colophon.
 * Even page indices sit on the right of a spread, odd ones on the left.
 * ========================================================================= */

export const PAGE_W = 1100;
export const PAGE_H = 1458;
const OUT = 88;   // outer margin
const INN = 104;  // inner (gutter) margin
const TOP = 112;
const BOT = 118;

export interface PageKit {
  cw: Colourway;
  photos: { bag: Shot; work: Shot; cartier: Shot; contact: Shot };
  flatlay?: Shot;
}

type Side = 'L' | 'R';
interface Page { c: HTMLCanvasElement; x: CanvasRenderingContext2D; side: Side; l: number; r: number; }

/** pixel density of the page canvases (layout is always in 1100×1458 units) */
let S = 1;
export function setPageScale(s: number) { S = s; }

function page(side: Side, bg: string): Page {
  const { c, x } = makeCanvas(Math.round(PAGE_W * S), Math.round(PAGE_H * S));
  x.scale(S, S);
  x.fillStyle = bg;
  x.fillRect(0, 0, PAGE_W, PAGE_H);
  const l = side === 'L' ? OUT : INN;
  const r = side === 'L' ? PAGE_W - INN : PAGE_W - OUT;
  return { c, x, side, l, r };
}

/** soft paper shading toward the gutter, like a real bound page */
function gutterShade(p: Page, strength = 0.07) {
  const { x } = p;
  const g = p.side === 'R' ? x.createLinearGradient(0, 0, 140, 0) : x.createLinearGradient(PAGE_W, 0, PAGE_W - 140, 0);
  g.addColorStop(0, `rgba(30,20,10,${strength})`);
  g.addColorStop(1, 'rgba(30,20,10,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, PAGE_W, PAGE_H);
}

function runningHead(p: Page, ink: string, left: string, right: string) {
  const { x } = p;
  x.fillStyle = ink;
  font(x, `700 17px ${SANS}`, 4.5);
  if (p.side === 'L') { x.textAlign = 'left'; x.fillText(left.toUpperCase(), p.l, 66); }
  else { x.textAlign = 'right'; x.fillText(right.toUpperCase(), p.r, 66); }
}

function folio(p: Page, ink: string, n: number) {
  const { x } = p;
  x.fillStyle = ink;
  const num = String(n).padStart(2, '0');
  font(x, `600 17px ${SANS}`, 4);
  if (p.side === 'L') {
    x.textAlign = 'left';
    x.fillText(num, p.l, PAGE_H - 58);
    x.globalAlpha = 0.55;
    x.fillText('SHREYA', p.l + 52, PAGE_H - 58);
  } else {
    x.textAlign = 'right';
    x.fillText(num, p.r, PAGE_H - 58);
    x.globalAlpha = 0.55;
    x.fillText('THE PORTFOLIO ISSUE', p.r - 52, PAGE_H - 58);
  }
  x.globalAlpha = 1;
}

function kicker(x: CanvasRenderingContext2D, text: string, px: number, y: number, color: string, align: CanvasTextAlign = 'left', size = 19) {
  x.fillStyle = color;
  font(x, `700 ${size}px ${SANS}`, size * 0.3);
  x.textAlign = align;
  x.fillText(text.toUpperCase(), px, y);
}

/** lines of display type; `italicFrom` sets the tail in italic */
function headline(x: CanvasRenderingContext2D, lines: string[], px: number, y: number, size: number, color: string, italicFrom = 99, align: CanvasTextAlign = 'left', weight = 500) {
  x.fillStyle = color;
  x.textAlign = align;
  const lead = size * 0.95;
  lines.forEach((ln, i) => {
    font(x, `${i >= italicFrom ? 'italic ' : ''}${weight} ${size}px ${SERIF}`, -size * 0.015);
    x.fillText(ln, px, y + i * lead);
  });
  return y + (lines.length - 1) * lead;
}

function dek(x: CanvasRenderingContext2D, text: string, px: number, y: number, maxW: number, color: string, size = 34, align: CanvasTextAlign = 'left') {
  x.fillStyle = color;
  font(x, `italic 400 ${size}px ${TEXT}`, 0);
  return wrapText(x, text, px, y, maxW, size * 1.3, 8, align);
}

function rule(x: CanvasRenderingContext2D, px: number, y: number, w: number, color: string, h = 2) {
  x.fillStyle = color;
  x.fillRect(px, y, w, h);
}

/** body copy flowed through columns (balanced); optional drop cap on the first paragraph */
function body(x: CanvasRenderingContext2D, paras: string[], cols: { x: number; y: number; w: number; h: number }[], color: string, accent: string, dropCap = true, size = 30) {
  const lh = Math.round(size * 1.44);
  if (cols.length > 1) {
    // balance: lay out once without drawing, then share the lines out evenly
    const total = flow(x, paras, [{ ...cols[0], h: 1e5 }], color, accent, dropCap, size, lh, true).lines;
    const per = Math.ceil(total / cols.length);
    cols = cols.map((c) => ({ ...c, h: Math.min(c.h, (per - 1) * lh + 2) }));
  }
  return flow(x, paras, cols, color, accent, dropCap, size, lh, false).y;
}

function flow(x: CanvasRenderingContext2D, paras: string[], cols: { x: number; y: number; w: number; h: number }[], color: string, accent: string, dropCap: boolean, size: number, lh: number, dry: boolean) {
  let ci = 0, lines = 0;
  let cx = cols[0].x, cy = cols[0].y, cw = cols[0].w, bottom = cols[0].y + cols[0].h;
  const nextLine = () => {
    cy += lh;
    lines++;
    if (cy > bottom) {
      ci++;
      if (ci >= cols.length) return false;
      cx = cols[ci].x; cy = cols[ci].y; cw = cols[ci].w; bottom = cols[ci].y + cols[ci].h;
    }
    return true;
  };
  x.textAlign = 'left';
  for (let pi = 0; pi < paras.length; pi++) {
    const words = paras[pi].split(/\s+/);
    let indent = 0;
    let capLines = 0;
    if (pi === 0 && dropCap) {
      const ch = words[0][0];
      words[0] = words[0].slice(1);
      font(x, `700 ${size * 4.1}px ${SERIF}`, 0);
      x.fillStyle = accent;
      const capW = x.measureText(ch).width;
      if (!dry) x.fillText(ch, cx - 4, cy + size * 2.62);
      indent = capW + 12;
      capLines = 3;
    }
    font(x, `400 ${size}px ${TEXT}`, 0);
    x.fillStyle = color;
    let line = '';
    let lineNo = 0;
    for (const w of words) {
      if (!w) continue;
      const avail = cw - (lineNo < capLines ? indent : 0);
      const test = line ? line + ' ' + w : w;
      if (x.measureText(test).width > avail && line) {
        if (!dry) x.fillText(line, cx + (lineNo < capLines ? indent : 0), cy);
        lineNo++;
        if (!nextLine()) return { y: cy, lines };
        line = w;
      } else line = test;
    }
    if (line) {
      if (!dry) x.fillText(line, cx + (lineNo < capLines ? indent : 0), cy);
      lineNo++;
    }
    while (lineNo < capLines) { lineNo++; if (!nextLine()) return { y: cy, lines }; }
    if (!nextLine()) return { y: cy, lines };
    cy += lh * 0.35;
  }
  return { y: cy, lines };
}

function pullQuote(x: CanvasRenderingContext2D, text: string, px: number, y: number, w: number, color: string, accent: string, size = 52) {
  rule(x, px, y, w, color, 2);
  x.fillStyle = accent;
  font(x, `italic 500 ${size}px ${SERIF}`, -0.5);
  const end = wrapText(x, text, px, y + size * 1.35, w, size * 1.12, 6);
  rule(x, px, end - size * 0.45, 64, accent, 4);
  return end;
}

/** a lit colour plate (a "photo" ground) */
function plate(x: CanvasRenderingContext2D, rx: number, ry: number, rw: number, rh: number, cs: { bg: string; bgDeep: string }) {
  x.save();
  x.beginPath(); x.rect(rx, ry, rw, rh); x.clip();
  x.translate(rx, ry);
  backdrop(x, rw, rh, cs.bg, cs.bgDeep, 0.5, 0.45);
  x.restore();
}

/** draw a transparent studio shot into a box, scaled to cover (crop) or contain */
function photo(x: CanvasRenderingContext2D, img: HTMLCanvasElement, rx: number, ry: number, rw: number, rh: number, zoom = 1, ox = 0.5, oy = 0.5) {
  const s = Math.max(rw / img.width, rh / img.height) * zoom;
  const w = img.width * s, h = img.height * s;
  x.save();
  x.beginPath(); x.rect(rx, ry, rw, rh); x.clip();
  x.drawImage(img, rx + (rw - w) * ox, ry + (rh - h) * oy, w, h);
  x.restore();
}

function caption(x: CanvasRenderingContext2D, head: string, text: string, px: number, y: number, w: number, color: string, accent: string, align: CanvasTextAlign = 'left') {
  kicker(x, head, px, y, accent, align, 16);
  x.fillStyle = color;
  font(x, `italic 400 27px ${TEXT}`, 0);
  return wrapText(x, text, px, y + 36, w, 34, 4, align);
}

function chips(x: CanvasRenderingContext2D, items: string[], px: number, y: number, color: string) {
  font(x, `700 16px ${SANS}`, 3);
  x.textAlign = 'left';
  let cx = px;
  items.forEach((t) => {
    const w = x.measureText(t.toUpperCase()).width + 36;
    x.strokeStyle = color; x.lineWidth = 1.8; x.globalAlpha = 0.9;
    x.strokeRect(cx, y - 28, w, 44);
    x.globalAlpha = 1;
    x.fillStyle = color;
    x.fillText(t.toUpperCase(), cx + 17, y + 1);
    cx += w + 12;
  });
}

function endMark(x: CanvasRenderingContext2D, px: number, y: number, accent: string, ink: string, next: string) {
  x.fillStyle = accent;
  x.fillRect(px, y - 18, 18, 18);
  x.fillStyle = ink;
  font(x, `700 17px ${SANS}`, 4);
  x.textAlign = 'left';
  x.fillText(next.toUpperCase(), px + 34, y - 1);
}

function finish(p: Page, _grain = 0) {
  // paper grain is added in the page shader — cheaper than per-pixel canvas work
  gutterShade(p);
  return p.c;
}

/** draw across a double-width canvas, then cut it into a left and a right page */
function spread(draw: (x: CanvasRenderingContext2D, W: number, H: number) => void): [HTMLCanvasElement, HTMLCanvasElement] {
  const pw = Math.round(PAGE_W * S), ph = Math.round(PAGE_H * S);
  const { c, x } = makeCanvas(pw * 2, ph);
  x.scale(S, S);
  draw(x, PAGE_W * 2, PAGE_H);
  const L = makeCanvas(pw, ph), R = makeCanvas(pw, ph);
  L.x.drawImage(c, 0, 0);
  R.x.drawImage(c, -pw, 0);
  L.x.setTransform(S, 0, 0, S, 0, 0);
  R.x.setTransform(S, 0, 0, S, 0, 0);
  const shadeL: Page = { c: L.c, x: L.x, side: 'L', l: OUT, r: PAGE_W - INN };
  const shadeR: Page = { c: R.c, x: R.x, side: 'R', l: INN, r: PAGE_W - OUT };
  gutterShade(shadeL, 0.1); gutterShade(shadeR, 0.1);
  return [L.c, R.c];
}

const meta = (id: IssueId) => ISSUES.find((i) => i.id === id)!;
const folioNo = (m: IssueMeta, pageIndex: number) => parseInt(m.page, 10) + pageIndex - 1;

/* ===================================================================== 01 */
function issueBag(k: PageKit): HTMLCanvasElement[] {
  const { cw } = k;
  const m = meta('bag');
  const ink = cw.paperInk, acc = cw.pageAccent, paper = cw.paper;
  const soft = hexToRgba(ink, 0.84);
  const out: HTMLCanvasElement[] = [];

  // p1 — contents + editor's letter (left)
  {
    const p = page('L', paper);
    const { x } = p;
    runningHead(p, ink, `Shreya — No. ${m.no}`, '');
    kicker(x, 'The Portfolio Issue · MMXXVI', p.l, 200, acc);
    headline(x, ['Contents'], p.l - 4, 330, 150, ink);
    rule(x, p.l, 392, p.r - p.l, ink, 3);
    let y = 470;
    ISSUES.forEach((it) => {
      x.fillStyle = acc;
      font(x, `500 64px ${SERIF}`, 0);
      x.textAlign = 'left';
      x.fillText(it.no, p.l, y + 8);
      x.fillStyle = ink;
      font(x, `italic 500 46px ${SERIF}`, -0.5);
      x.fillText(it.navLabel, p.l + 120, y);
      font(x, `400 27px ${TEXT}`, 0);
      x.fillStyle = soft;
      x.fillText(it.teaser, p.l + 122, y + 40);
      font(x, `600 17px ${MONO}`, 1);
      x.fillStyle = ink;
      x.textAlign = 'right';
      x.fillText('p.' + it.page, p.r, y);
      rule(x, p.l, y + 66, p.r - p.l, hexToRgba(ink, 0.18), 1.5);
      y += 132;
    });
    // editor's letter
    y += 30;
    kicker(x, 'From the editor', p.l, y, acc);
    x.fillStyle = ink;
    font(x, `400 31px ${TEXT}`, 0);
    y = wrapText(x, 'Nobody has the attention span for a paragraph about me. So I put everything in a bag — and the bag in a magazine. Four issues, no filler. Turn the pages, take what you need.', p.l, y + 52, p.r - p.l - 20, 44);
    font(x, `italic 400 44px ${SERIF}`, 0);
    x.fillStyle = acc;
    x.fillText('— Shreya', p.l, y + 34);
    folio(p, ink, folioNo(m, 1));
    out.push(finish(p));
  }

  // p2 — feature opener (right)
  {
    const p = page('R', paper);
    const { x } = p;
    runningHead(p, ink, '', 'The bag issue');
    const cs = cw.covers[0];
    plate(x, 0, 0, PAGE_W, 760, cs);
    photo(x, k.photos.bag, PAGE_W * 0.08, -30, PAGE_W * 0.84, 800, 1.12, 0.62, 0.32);
    kicker(x, 'Feature · Self-portrait', p.l, 840, acc);
    headline(x, ['What’s in', 'my bag'], p.l - 6, 970, 128, ink, 0);
    dek(x, 'A CS engineer who took a hard left into luxury fashion — and never signalled. Everything worth knowing, itemised, because nobody reads the paragraph.', p.l, 1150, p.r - p.l - 20, soft, 34);
    kicker(x, `Words & styling: ${IDENTITY.name}`, p.l, PAGE_H - 150, ink, 'left', 13);
    folio(p, ink, folioNo(m, 2));
    out.push(finish(p));
  }

  // p3–p4 — the inventory: a flat-lay across the spread with numbered callouts
  {
    const cs = cw.covers[1];
    const [L, R] = spread((x, W, H) => {
      backdrop(x, W, H, cs.bg, cs.bgDeep, 0.5, 0.5);
      if (k.flatlay) x.drawImage(k.flatlay, 0, 0, W, H);
      const fg = cs.fg;
      // title block, top-left
      x.fillStyle = fg;
      font(x, `700 15px ${SANS}`, 4.5);
      x.textAlign = 'left';
      x.fillText(`SHREYA — No. ${m.no}`, OUT, 66);
      kicker(x, 'The inventory', OUT, 170, cs.accent);
      headline(x, ['Everything', 'in the bag'], OUT - 4, 290, 104, fg, 1);
      x.fillStyle = hexToRgba(fg, 0.82);
      font(x, `italic 400 32px ${TEXT}`, 0);
      wrapText(x, '— and what each thing says about the person who packed it.', OUT, 470, 440, 40);
      // numbered callouts
      const items = INVENTORY;
      const anchors = k.flatlay?.anchors ?? [];
      const sx = W / (k.flatlay?.width ?? W), sy = H / (k.flatlay?.height ?? H);
      items.forEach((it, i) => {
        const a = anchors[i];
        if (!a) return;
        const ax = a.x * sx, ay = a.y * sy;
        x.fillStyle = fg;
        x.beginPath(); x.arc(ax, ay, 30, 0, Math.PI * 2); x.fill();
        x.fillStyle = cs.bg;
        font(x, `700 27px ${SANS}`, 0);
        x.textAlign = 'center';
        x.fillText(String(i + 1), ax, ay + 10);
      });
      // the key, bottom of the right page
      const kx = W / 2 + INN, ky = H - 500, colW = (W / 2 - INN - OUT - 40) / 2;
      x.fillStyle = hexToRgba(cs.bgDeep, 0.0);
      items.forEach((it, i) => {
        const col = i < 4 ? 0 : 1;
        const row = i < 4 ? i : i - 4;
        const px = kx + col * (colW + 40), py = ky + row * 112;
        x.fillStyle = cs.accent;
        font(x, `700 18px ${SANS}`, 3);
        x.textAlign = 'left';
        x.fillText(`${i + 1}  ${it.name.toUpperCase()}`, px, py);
        x.fillStyle = hexToRgba(fg, 0.9);
        font(x, `italic 400 25px ${TEXT}`, 0);
        wrapText(x, it.line, px, py + 33, colW, 30, 2);
      });
      x.fillStyle = fg;
      font(x, `600 17px ${SANS}`, 4);
      x.textAlign = 'left'; x.fillText(String(folioNo(m, 3)).padStart(2, '0'), OUT, H - 58);
      x.textAlign = 'right'; x.fillText(String(folioNo(m, 4)).padStart(2, '0'), W - OUT, H - 58);
    });
    out.push(L, R);
  }

  // p5 — hats in rotation (left)
  {
    const p = page('L', paper);
    const { x } = p;
    runningHead(p, ink, `Shreya — No. ${m.no}`, '');
    kicker(x, 'Worn professionally', p.l, 200, acc);
    headline(x, ['Hats,', 'in rotation'], p.l - 6, 320, 120, ink, 1);
    let y = 520;
    const hats: [string, string, string][] = [
      ['Brand strategist', 'Positioning', 'Finding the why, then making everything else agree with it.'],
      ['Fashion marketer', 'Campaigns', 'Ideas that look good on a mood board and better on a calendar.'],
      ['Graphic designer', 'Canva, loudly', 'Decks, posts and the occasional magazine cover.'],
    ];
    hats.forEach(([h, tag, line]) => {
      rule(x, p.l, y, p.r - p.l, ink, 2);
      x.fillStyle = ink;
      font(x, `500 56px ${SERIF}`, -0.5);
      x.textAlign = 'left';
      x.fillText(h, p.l, y + 84);
      kicker(x, tag, p.r, y + 80, acc, 'right', 14);
      x.fillStyle = soft;
      font(x, `400 30px ${TEXT}`, 0);
      wrapText(x, line, p.l, y + 134, p.r - p.l - 60, 40, 2);
      y += 222;
    });
    pullQuote(x, '“If working on Canva counts as graphic design — and I have decided that it does.”', p.l, y + 40, p.r - p.l - 60, ink, acc, 46);
    folio(p, ink, folioNo(m, 5));
    out.push(finish(p));
  }

  // p6 — credentials + side projects (right)
  {
    const p = page('R', paper);
    const { x } = p;
    runningHead(p, ink, '', 'Credentials');
    kicker(x, 'The paperwork', p.l, 200, acc);
    headline(x, ['Credentials,', 'briefly'], p.l - 6, 320, 104, ink, 1);
    let y = 500;
    const creds: [string, string, string][] = [
      ['i.', 'Post-grad, Luxury Fashion Brand Management', 'My whole personality these days ;)'],
      ['ii.', 'Cartier · “Through the Lens of India”', 'Finalist. The full story is Issue 03.'],
      ['iii.', 'Computer Science engineer', 'Which is how the decks arrive on time.'],
    ];
    creds.forEach(([n, h, s]) => {
      x.fillStyle = acc;
      font(x, `italic 500 34px ${SERIF}`);
      x.textAlign = 'left';
      x.fillText(n, p.l, y);
      x.fillStyle = ink;
      font(x, `600 30px ${SANS}`, 0);
      const end = wrapText(x, h, p.l + 76, y, p.r - p.l - 80, 38, 2);
      x.fillStyle = soft;
      font(x, `italic 400 29px ${TEXT}`, 0);
      x.fillText(s, p.l + 76, end + 4);
      y = end + 90;
    });
    rule(x, p.l, y, p.r - p.l, ink, 3);
    kicker(x, 'Also, and simultaneously', p.l, y + 72, acc);
    y += 140;
    const side: [string, string, string][] = [
      ['01', 'A very small, very controversial magazine', 'Printed at home. Circulated by hand. Editorial policy: say the thing.'],
      ['02', 'A questionable clothing brand', 'Questionable is the brief, not the execution.'],
    ];
    side.forEach(([n, h, s]) => {
      x.fillStyle = acc;
      font(x, `500 50px ${SERIF}`);
      x.textAlign = 'left';
      x.fillText(n, p.l, y + 8);
      x.fillStyle = ink;
      font(x, `italic 500 38px ${SERIF}`, -0.3);
      const end = wrapText(x, h, p.l + 96, y, p.r - p.l - 100, 44, 2);
      x.fillStyle = soft;
      font(x, `400 28px ${TEXT}`, 0);
      y = wrapText(x, s, p.l + 96, end + 6, p.r - p.l - 100, 37, 3) + 44;
    });
    endMark(x, p.l, PAGE_H - 170, acc, ink, 'Next: No. 02 — Brands that trusted me');
    folio(p, ink, folioNo(m, 6));
    out.push(finish(p));
  }
  return out;
}

export const INVENTORY = [
  { name: 'The magazines', line: 'Four issues, one person. A portfolio you can actually hold.' },
  { name: 'The lipstick', line: 'Reapplied before every pitch. Undefeated.' },
  { name: 'The boarding pass', line: 'One way: engineering → luxury. Post-grad in Luxury Fashion Brand Management.' },
  { name: 'The card', line: 'Brand strategist. Fashion marketer. Designer, if Canva counts.' },
  { name: 'The lens', line: 'Cartier, “Through the Lens of India” — finalist.' },
  { name: 'The envelope', line: 'Open to briefs. Directions in Issue 04.' },
];

/* ===================================================================== 02 */
const BRANDS: { name: string[]; client: string; role: string; dek: string; body: string[]; tags: string[] }[] = [
  {
    name: ['Style', 'Potli'], client: 'Client 01', role: 'Brand strategy · Social direction',
    dek: 'Finding the brand’s voice — then making sure it sounds the same everywhere it shows up.',
    body: [
      'The work started where brand work should: with positioning. Who the brand is for, what it stands for, and the one thing it should be remembered by.',
      'From there, social direction — turning that position into a feed with a point of view, so the grid reads like the same brand on every post.',
    ],
    tags: ['Positioning', 'Social', 'Content'],
  },
  {
    name: ['Zykaz'], client: 'Client 02', role: 'Reels · Shoot campaigns',
    dek: 'Reels concepts, pitched and presented. Shoot campaign ideas, from first thought to storyboard.',
    body: [
      'Short-form first: reel concepts built to stop a thumb, then pitched and presented to the brand.',
      'And the shoots behind them — campaign ideas taken from a single line to a full storyboard, ready for the camera.',
    ],
    tags: ['Reels', 'Shoot concepts', 'Storyboards'],
  },
  {
    name: ['Ikigai'], client: 'Client 03', role: 'The podcast',
    dek: 'A podcast for Ikigai Hospitals — brand strategy, out loud.',
    body: [
      'Brand strategy doesn’t only live on a grid. For Ikigai Hospitals it lived in conversation: a podcast.',
    ],
    tags: ['Podcast', 'Content'],
  },
  {
    name: ['One Off', 'Society'], client: 'Client 04', role: 'Fashion marketing · Content',
    dek: 'Fashion marketing and content for a brand whose name already does half the work.',
    body: [
      'Fashion marketing, and the content that carries it — so the brand looks and sounds like itself wherever it shows up.',
    ],
    tags: ['Fashion marketing', 'Content'],
  },
];

/** a typographic "plate" standing in for campaign photography */
function brandPlate(x: CanvasRenderingContext2D, rx: number, ry: number, rw: number, rh: number, cs: CoverStyle, name: string[], client: string) {
  plate(x, rx, ry, rw, rh, cs);
  x.save();
  x.beginPath(); x.rect(rx, ry, rw, rh); x.clip();
  x.fillStyle = cs.fg;
  // largest size at which every line fits the plate with a margin
  let size = rh / (name.length * 1.02 + 0.5);
  font(x, `italic 500 ${size}px ${SERIF}`, -size * 0.02);
  const widest = Math.max(...name.map((n) => x.measureText(n).width));
  size = Math.min(size, size * ((rw - 120) / widest));
  font(x, `italic 500 ${size}px ${SERIF}`, -size * 0.02);
  x.textAlign = 'left';
  const lead = size * 0.9;
  const block = (name.length - 1) * lead + size * 0.72;
  const top = ry + (rh - block) / 2 + size * 0.72 + 18;
  name.forEach((n, i) => x.fillText(n, rx + 56, top + i * lead));
  kicker(x, client, rx + 58, ry + 58, cs.accent, 'left', 16);
  x.restore();
}

/** a little audio waveform — the podcast's signature */
function waveform(x: CanvasRenderingContext2D, px: number, y: number, w: number, h: number, color: string) {
  x.fillStyle = color;
  const bars = 64, bw = w / bars;
  for (let i = 0; i < bars; i++) {
    const t = i / bars;
    const a = 0.22 + 0.78 * Math.abs(Math.sin(t * 9.3) * Math.sin(t * 3.1 + 1) * (0.6 + 0.4 * Math.sin(t * 23)));
    x.fillRect(px + i * bw, y - (h * a) / 2, bw * 0.55, h * a);
  }
}

function issueWork(k: PageKit): HTMLCanvasElement[] {
  const { cw } = k;
  const m = meta('work');
  const ink = cw.paperInk, acc = cw.pageAccent, paper = cw.paper;
  const soft = hexToRgba(ink, 0.84);
  const out: HTMLCanvasElement[] = [];
  const plates = [cw.covers[1], cw.covers[2], cw.covers[0], cw.covers[3]];

  // p1 — intro (left)
  {
    const p = page('L', paper);
    const { x } = p;
    runningHead(p, ink, `Shreya — No. ${m.no}`, '');
    x.fillStyle = acc;
    font(x, `500 420px ${SERIF}`, -12);
    x.textAlign = 'left';
    x.fillText('04', p.l - 18, 560);
    kicker(x, 'Four case notes', p.l, 680, acc);
    headline(x, ['Brands that', 'trusted me'], p.l - 6, 800, 108, ink, 1);
    body(x, [
      'Strategy, campaign ideas, shoot direction — and one podcast. Four names that let me near the brief, and what I did once I got there.',
      'What follows are the case notes: the client, the remit, the work. The full decks are a message away.',
    ], [{ x: p.l, y: 1010, w: p.r - p.l - 40, h: 300 }], ink, acc, true, 27);
    folio(p, ink, folioNo(m, 1));
    out.push(finish(p));
  }

  // p2 … p5 — one brand per page
  BRANDS.forEach((b, i) => {
    const side: Side = i % 2 === 0 ? 'R' : 'L';
    const p = page(side, paper);
    const { x } = p;
    runningHead(p, ink, `Shreya — No. ${m.no}`, 'Brands that trusted me');
    brandPlate(x, p.l, 112, p.r - p.l, 600, plates[i], b.name, b.client);
    kicker(x, b.role, p.l, 790, acc);
    x.fillStyle = ink;
    font(x, `italic 500 40px ${SERIF}`, -0.4);
    x.textAlign = 'left';
    const end = wrapText(x, b.dek, p.l, 856, p.r - p.l - 20, 48, 3);
    const colW = (p.r - p.l - 44) / 2;
    const short = b.body.join(' ').length < 220;
    const after = body(x, b.body, short
      ? [{ x: p.l, y: end + 40, w: p.r - p.l - 40, h: PAGE_H - BOT - end - 150 }]
      : [
        { x: p.l, y: end + 40, w: colW, h: PAGE_H - BOT - end - 150 },
        { x: p.l + colW + 44, y: end + 40, w: colW, h: PAGE_H - BOT - end - 150 },
      ], ink, acc, true, 29);
    if (b.name[0] === 'Ikigai') {
      const wy = Math.max(after + 10, PAGE_H - 318);
      waveform(x, p.l, wy, p.r - p.l, 96, acc);
      kicker(x, 'EP. 01 — Now playing', p.l, wy + 78, ink, 'left', 15);
    }
    chips(x, b.tags, p.l, PAGE_H - 175, ink);
    folio(p, ink, folioNo(m, i + 2));
    out.push(finish(p));
  });

  // p6 — full decks on request (right)
  {
    const p = page('R', paper);
    const { x } = p;
    runningHead(p, ink, '', 'Brands that trusted me');
    const cs = cw.covers[1];
    plate(x, 0, 0, PAGE_W, PAGE_H * 0.56, cs);
    photo(x, k.photos.work, 0, -40, PAGE_W, PAGE_H * 0.56 + 40, 1.0, 0.7, 0.4);
    kicker(x, 'The fine print', p.l, PAGE_H * 0.56 + 78, acc);
    headline(x, ['Full decks,', 'on request'], p.l - 6, PAGE_H * 0.56 + 186, 92, ink, 1);
    dek(x, 'Ask, and I’ll walk you through the full decks — slowly, with the lipstick freshly applied.', p.l, PAGE_H * 0.56 + 352, p.r - p.l - 40, soft, 30);
    endMark(x, p.l, PAGE_H - 150, acc, ink, 'Next: No. 03 — Through the lens of India');
    folio(p, ink, folioNo(m, 6));
    out.push(finish(p));
  }
  return out;
}

/* ===================================================================== 03 */
function issueCartier(k: PageKit): HTMLCanvasElement[] {
  const { cw } = k;
  const m = meta('cartier');
  const ink = cw.paperInk, acc = cw.pageAccent, paper = cw.paper;
  const soft = hexToRgba(ink, 0.84);
  const cs = cw.covers[2];
  const out: HTMLCanvasElement[] = [];

  // p1 — full-bleed photograph (left)
  {
    const p = page('L', cs.bg);
    const { x } = p;
    backdrop(x, PAGE_W, PAGE_H, cs.bg, cs.bgDeep, 0.55, 0.5);
    photo(x, k.photos.cartier, -60, 120, PAGE_W + 120, PAGE_H - 160, 1.18, 0.62, 0.6);
    runningHead(p, cs.fg, `Shreya — No. ${m.no}`, '');
    caption(x, 'The lens', 'Cartier’s competition, “Through the Lens of India” — and an entry that made the finals.', p.l, PAGE_H - 210, 520, hexToRgba(cs.fg, 0.86), cs.accent);
    x.fillStyle = cs.fg;
    font(x, `600 15px ${SANS}`, 4);
    x.textAlign = 'left';
    x.fillText(String(folioNo(m, 1)).padStart(2, '0'), p.l, PAGE_H - 58);
    out.push(finish(p, 0.02));
  }

  // p2 — opener (right)
  {
    const p = page('R', paper);
    const { x } = p;
    runningHead(p, ink, '', 'Cartier · Finalist');
    kicker(x, 'Cartier · Finalist', p.l, 220, acc);
    headline(x, ['Through', 'the lens', 'of India'], p.l - 8, 380, 150, ink, 1);
    rule(x, p.l, 760, 120, acc, 5);
    dek(x, 'Cartier’s competition, “Through the Lens of India”. I made the finals.', p.l, 850, p.r - p.l - 40, ink, 36);
    body(x, [
      'The competition: Cartier’s “Through the Lens of India”. The entry: a concept, and the narrative to carry it.',
      'It made the finals — and it was the first time I understood that heritage is a strategy, not a mood board.',
    ], [{ x: p.l, y: 1000, w: p.r - p.l - 30, h: 330 }], ink, acc, true, 30);
    folio(p, ink, folioNo(m, 2));
    out.push(finish(p));
  }

  // p3 — what a finalist learns (left)
  {
    const p = page('L', paper);
    const { x } = p;
    runningHead(p, ink, `Shreya — No. ${m.no}`, '');
    kicker(x, 'The strategist’s notes', p.l, 200, acc);
    headline(x, ['Three notes', 'on luxury'], p.l - 6, 330, 92, ink, 1);
    let y = 590;
    const notes: [string, string][] = [
      ['Heritage is a strategy.', 'Not a mood board. The past is a brand’s most underused asset — if you know what to do with it.'],
      ['Restraint is a luxury.', 'Say one thing beautifully rather than five things loudly.'],
      ['Look closer.', 'The story is rarely in the obvious frame. Crop in. Then crop in again.'],
    ];
    notes.forEach(([h, s], i) => {
      x.fillStyle = acc;
      font(x, `500 120px ${SERIF}`);
      x.textAlign = 'left';
      x.fillText(String(i + 1), p.l, y + 56);
      x.fillStyle = ink;
      font(x, `italic 500 54px ${SERIF}`, -0.4);
      x.fillText(h, p.l + 118, y);
      x.fillStyle = soft;
      font(x, `400 31px ${TEXT}`, 0);
      y = wrapText(x, s, p.l + 118, y + 56, p.r - p.l - 128, 42, 3) + 78;
    });
    chips(x, ['Concept', 'Narrative', 'Finalist'], p.l, PAGE_H - 175, ink);
    folio(p, ink, folioNo(m, 3));
    out.push(finish(p));
  }

  // p4 — pull quote (right)
  {
    const p = page('R', cs.bg);
    const { x } = p;
    backdrop(x, PAGE_W, PAGE_H, cs.bg, cs.bgDeep, 0.5, 0.45);
    runningHead(p, cs.fg, '', 'Through the lens of India');
    x.fillStyle = cs.accent;
    font(x, `500 300px ${SERIF}`);
    x.textAlign = 'left';
    x.fillText('“', p.l - 10, 520);
    x.fillStyle = cs.fg;
    font(x, `italic 500 92px ${SERIF}`, -1);
    ['Heritage is', 'a strategy —', 'not a mood', 'board.'].forEach((l, i) => x.fillText(l, p.l, 640 + i * 100));
    rule(x, p.l, 1120, 120, cs.accent, 5);
    x.fillStyle = hexToRgba(cs.fg, 0.86);
    font(x, `600 17px ${SANS}`, 4.5);
    x.fillText('SHREYA GUNDAGANI — CARTIER FINALIST', p.l, 1190);
    endMark(x, p.l, PAGE_H - 170, cs.accent, cs.fg, 'Next: No. 04 — How to reach me');
    x.fillStyle = cs.fg;
    font(x, `600 15px ${SANS}`, 4);
    x.textAlign = 'right';
    x.fillText(String(folioNo(m, 4)).padStart(2, '0'), p.r, PAGE_H - 58);
    out.push(finish(p, 0.02));
  }
  return out;
}

/* ===================================================================== 04 */
function issueContact(k: PageKit): HTMLCanvasElement[] {
  const { cw } = k;
  const m = meta('contact');
  const ink = cw.paperInk, acc = cw.pageAccent, paper = cw.paper;
  const soft = hexToRgba(ink, 0.84);
  const cs = cw.covers[3];
  const out: HTMLCanvasElement[] = [];

  // p1 — the envelope (left)
  {
    const p = page('L', cs.bg);
    const { x } = p;
    backdrop(x, PAGE_W, PAGE_H, cs.bg, cs.bgDeep, 0.5, 0.5);
    photo(x, k.photos.contact, -40, 60, PAGE_W + 80, PAGE_H - 60, 1.12, 0.5, 0.62);
    runningHead(p, cs.fg, `Shreya — No. ${m.no}`, '');
    kicker(x, 'Write to me', p.l, 210, cs.accent);
    headline(x, ['Sealed,', 'not sent'], p.l - 6, 330, 110, cs.fg, 1);
    x.fillStyle = cs.fg;
    font(x, `600 15px ${SANS}`, 4);
    x.textAlign = 'left';
    x.fillText(String(folioNo(m, 1)).padStart(2, '0'), p.l, PAGE_H - 58);
    out.push(finish(p, 0.02));
  }

  // p2 — how to reach me (right)
  {
    const p = page('R', paper);
    const { x } = p;
    runningHead(p, ink, '', 'How to reach me');
    kicker(x, 'The back page', p.l, 200, acc);
    headline(x, ['How to', 'reach me'], p.l - 6, 330, 132, ink, 1);
    dek(x, 'Briefs, collaborations, and unsolicited opinions on packaging.', p.l, 560, p.r - p.l - 80, soft, 32);
    let y = 720;
    const lines: [string, string][] = [
      ['LinkedIn', IDENTITY.linkedinLabel],
      ['Instagram', IDENTITY.instagramLabel],
    ];
    if (IDENTITY.email) lines.push(['Email', IDENTITY.email]);
    if (IDENTITY.phone) lines.push(['Phone', IDENTITY.phone]);
    lines.forEach(([a, b]) => {
      rule(x, p.l, y, p.r - p.l, ink, 2);
      x.fillStyle = ink;
      font(x, `500 64px ${SERIF}`, -0.6);
      x.textAlign = 'left';
      x.fillText(a, p.l, y + 96);
      x.fillStyle = acc;
      font(x, `600 20px ${SANS}`, 2.5);
      x.textAlign = 'right';
      x.fillText(b.toUpperCase() + '  ↗', p.r, y + 92);
      y += 150;
    });
    rule(x, p.l, y, p.r - p.l, ink, 2);
    x.fillStyle = soft;
    font(x, `italic 400 26px ${TEXT}`, 0);
    x.textAlign = 'left';
    x.fillText(`${matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click'} the links below the magazine to open them.`, p.l, y + 60);
    folio(p, ink, folioNo(m, 2));
    out.push(finish(p));
  }

  // p3 — open to (left)
  {
    const p = page('L', paper);
    const { x } = p;
    runningHead(p, ink, `Shreya — No. ${m.no}`, '');
    kicker(x, 'Currently', p.l, 200, acc);
    headline(x, ['Open to'], p.l - 6, 330, 150, ink, 0);
    let y = 470;
    ['Brand strategy & positioning', 'Fashion marketing', 'Campaign & shoot concepts', 'Reels & social direction', 'Podcasts, apparently'].forEach((t, i) => {
      rule(x, p.l, y, p.r - p.l, hexToRgba(ink, 0.25), 1.5);
      x.fillStyle = acc;
      font(x, `600 17px ${MONO}`, 1);
      x.textAlign = 'left';
      x.fillText(String(i + 1).padStart(2, '0'), p.l, y + 62);
      x.fillStyle = ink;
      font(x, `italic 500 44px ${SERIF}`, -0.4);
      x.fillText(t, p.l + 74, y + 66);
      y += 108;
    });
    pullQuote(x, 'Response time: faster than a reel loads.', p.l, y + 70, p.r - p.l - 80, ink, acc, 44);
    folio(p, ink, folioNo(m, 3));
    out.push(finish(p));
  }

  // p4 — colophon (right)
  {
    const p = page('R', paper);
    const { x } = p;
    runningHead(p, ink, '', 'Colophon');
    x.fillStyle = ink;
    font(x, `italic 500 250px ${SERIF}`, -4);
    x.textAlign = 'left';
    x.fillText('Fin.', p.l - 12, 480);
    rule(x, p.l, 560, p.r - p.l, ink, 3);
    let y = 640;
    const credits: [string, string][] = [
      ['Editor-in-chief', IDENTITY.name],
      ['Words & strategy', IDENTITY.name],
      ['Styling', 'The bag'],
      ['Printing', 'At home, by hand'],
      ['Price', 'Not for sale'],
    ];
    credits.forEach(([a, b]) => {
      kicker(x, a, p.l, y, acc, 'left', 15);
      x.fillStyle = ink;
      font(x, `500 34px ${SERIF}`, -0.3);
      x.textAlign = 'right';
      x.fillText(b, p.r, y + 4);
      rule(x, p.l, y + 34, p.r - p.l, hexToRgba(ink, 0.16), 1.5);
      y += 86;
    });
    pullQuote(x, 'The magazines are not for sale. Everything else is negotiable.', p.l, y + 60, p.r - p.l - 60, ink, acc, 44);
    folio(p, ink, folioNo(m, 4));
    out.push(finish(p));
  }
  return out;
}

/** All interior pages for an issue (cover and back cover are added by the caller). */
export function interiorPages(id: IssueId, kit: PageKit): HTMLCanvasElement[] {
  switch (id) {
    case 'bag': return issueBag(kit);
    case 'work': return issueWork(kit);
    case 'cartier': return issueCartier(kit);
    case 'contact': return issueContact(kit);
  }
}

export function pageTexture(c: HTMLCanvasElement): THREE.Texture {
  return toTexture(c, 16);
}

/** which spread (0-based leaf turn) holds the contact links, for the reader's DOM buttons */
export const CONTACT_SPREAD = 1;
