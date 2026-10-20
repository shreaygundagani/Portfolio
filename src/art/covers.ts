import type { IssueMeta } from '../config';
import type { CoverStyle } from '../theme';
import { makeCanvas, font, wrapText, grain, barcode, backdrop, hexToRgba, SERIF, SANS, TEXT, MONO } from './canvas';

/* Magazine covers, built the way real ones are: backdrop → masthead →
 * cover photograph (overlapping the masthead) → cover lines → furniture. */

export const COVER_W = 1200;
export const COVER_H = 1590;
const M = 62;

function masthead(x: CanvasRenderingContext2D, cs: CoverStyle, top: number) {
  const word = 'SHREYA';
  x.fillStyle = cs.fg;
  x.textAlign = 'center';
  font(x, `800 300px ${SERIF}`, -6);
  const w = x.measureText(word).width;
  const size = 300 * ((COVER_W - 2 * M + 10) / w);
  font(x, `800 ${size}px ${SERIF}`, -6 * (size / 300));
  const m = x.measureText(word);
  const asc = m.actualBoundingBoxAscent;
  x.fillText(word, COVER_W / 2, top + asc);
  return top + asc + m.actualBoundingBoxDescent;
}

function topLine(x: CanvasRenderingContext2D, cs: CoverStyle, meta: IssueMeta) {
  x.fillStyle = cs.fg;
  font(x, `600 20px ${SANS}`, 6);
  x.textAlign = 'left'; x.fillText('THE PORTFOLIO ISSUE', M, 62);
  x.textAlign = 'center'; x.fillText(`No. ${meta.no}`, COVER_W / 2, 62);
  x.textAlign = 'right'; x.fillText('MMXXVI', COVER_W - M, 62);
}

function kicker(x: CanvasRenderingContext2D, color: string, text: string, px: number, y: number, align: CanvasTextAlign = 'left') {
  x.fillStyle = color;
  font(x, `700 24px ${SANS}`, 5);
  x.textAlign = align;
  x.fillText(text.toUpperCase(), px, y);
}

function mainLine(x: CanvasRenderingContext2D, color: string, lines: string[], px: number, y: number, size: number, align: CanvasTextAlign = 'left') {
  x.fillStyle = color;
  x.textAlign = align;
  lines.forEach((l, i) => {
    font(x, `italic 500 ${size}px ${SERIF}`, -size * 0.012);
    x.fillText(l, px, y + i * size * 0.94);
  });
  return y + (lines.length - 1) * size * 0.94;
}

function secondary(x: CanvasRenderingContext2D, color: string, head: string, sub: string, px: number, y: number, maxW: number, align: CanvasTextAlign = 'left') {
  x.fillStyle = color;
  font(x, `800 25px ${SANS}`, 3.5);
  x.textAlign = align;
  x.fillText(head.toUpperCase(), px, y);
  font(x, `italic 400 31px ${TEXT}`, 0);
  return wrapText(x, sub, px, y + 40, maxW, 36, 3, align);
}

function roundel(x: CanvasRenderingContext2D, bg: string, fg: string, l1: string, l2: string, cx: number, cy: number, r: number) {
  x.save();
  x.fillStyle = bg;
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  x.strokeStyle = fg; x.globalAlpha = 0.6; x.lineWidth = 2;
  x.beginPath(); x.arc(cx, cy, r - 10, 0, Math.PI * 2); x.stroke();
  x.globalAlpha = 1;
  x.fillStyle = fg; x.textAlign = 'center';
  font(x, `700 22px ${SANS}`, 4);
  x.fillText(l1, cx, cy - 8);
  font(x, `italic 500 40px ${SERIF}`, 0);
  x.fillText(l2, cx, cy + 34);
  x.restore();
}

function footer(x: CanvasRenderingContext2D, cs: CoverStyle, meta: IssueMeta, barcodeRight = true) {
  const y = COVER_H - M;
  x.fillStyle = cs.fg;
  font(x, `600 19px ${SANS}`, 5);
  x.textAlign = barcodeRight ? 'left' : 'right';
  const px = barcodeRight ? M : COVER_W - M;
  x.fillText('NOT FOR SALE  ·  PRINTED AT HOME', px, y);
  font(x, `italic 400 26px ${TEXT}`, 0);
  x.fillText(`The ${meta.id === 'bag' ? 'bag' : meta.id === 'work' ? 'work' : meta.id === 'cartier' ? 'Cartier' : 'contact'} issue`, px, y - 34);
  const bw = 150, bh = 74;
  barcode(x, barcodeRight ? COVER_W - M - bw : M, COVER_H - M - bh - 18, bw, bh, '#111', '#f5f1e8', `0 ${meta.no}26 9771 2026`);
}

export function drawCover(meta: IssueMeta, cs: CoverStyle, photo: HTMLCanvasElement | null): HTMLCanvasElement {
  const W = COVER_W, H = COVER_H;
  const { c, x } = makeCanvas(W, H);
  backdrop(x, W, H, cs.bg, cs.bgDeep, 0.5, 0.52);
  topLine(x, cs, meta);
  const mastBottom = masthead(x, cs, 92);

  // the photograph sits over the masthead — the subject breaks the title
  if (photo) x.drawImage(photo, 0, 0, W, H);

  const soft = hexToRgba(cs.fg, 0.88);
  switch (meta.id) {
    case 'bag': {
      // the bag hangs right of centre; the lines run down the left
      const y0 = mastBottom + 120;
      kicker(x, cs.accent, meta.kicker, M, y0);
      const end = mainLine(x, cs.fg, meta.title, M - 4, y0 + 104, 100);
      x.fillStyle = soft;
      font(x, `italic 400 33px ${TEXT}`, 0);
      let y = wrapText(x, meta.dek, M, end + 66, 340, 38) + 70;
      meta.lines.forEach((l) => { y = secondary(x, cs.fg, l.head, l.sub, M, y, 300) + 30; });
      footer(x, cs, meta);
      break;
    }
    case 'work': {
      const y0 = mastBottom + 120;
      kicker(x, cs.accent, meta.kicker, M, y0);
      const end = mainLine(x, cs.fg, meta.title, M - 4, y0 + 128, 124);
      x.fillStyle = soft;
      font(x, `italic 400 34px ${TEXT}`, 0);
      wrapText(x, meta.dek, M, end + 80, 470, 42);
      let y = H - 420;
      meta.lines.forEach((l) => { y = secondary(x, cs.fg, l.head, l.sub, M, y, 360) + 30; });
      footer(x, cs, meta);
      break;
    }
    case 'cartier': {
      roundel(x, cs.accent, cs.bg, 'CARTIER', 'Finalist', W - M - 104, mastBottom + 140, 100);
      let y = mastBottom + 110;
      meta.lines.forEach((l) => { y = secondary(x, cs.fg, l.head, l.sub, M, y, 300) + 30; });
      const yb = H - 380;
      kicker(x, cs.accent, meta.kicker, M, yb - 124);
      mainLine(x, cs.fg, meta.title, M - 4, yb, 112);
      x.fillStyle = soft;
      font(x, `italic 400 32px ${TEXT}`, 0);
      wrapText(x, meta.dek, M, yb + 112 + 60, 620, 38);
      footer(x, cs, meta);
      break;
    }
    case 'contact': {
      const y0 = mastBottom + 110;
      kicker(x, cs.accent, meta.kicker, M, y0);
      const end = mainLine(x, cs.fg, meta.title, M - 4, y0 + 150, 148);
      x.fillStyle = soft;
      font(x, `italic 400 34px ${TEXT}`, 0);
      wrapText(x, meta.dek, M, end + 82, 520, 42);
      let y = mastBottom + 120;
      meta.lines.forEach((l) => { y = secondary(x, cs.fg, l.head, l.sub, W - M, y, 300, 'right') + 30; });
      footer(x, cs, meta);
      break;
    }
  }
  grain(x, W, H, 0.028);
  return c;
}

/** Back cover — the "advertisement" every magazine carries. */
export function drawBack(meta: IssueMeta, cs: CoverStyle): HTMLCanvasElement {
  const W = COVER_W, H = COVER_H;
  const { c, x } = makeCanvas(W, H);
  backdrop(x, W, H, cs.bgDeep, cs.bg, 0.5, 0.5);
  x.fillStyle = cs.fg;
  x.textAlign = 'center';
  font(x, `700 22px ${SANS}`, 9);
  x.fillText('SHREYA GUNDAGANI', W / 2, 170);
  x.globalAlpha = 0.5;
  x.fillRect(W / 2 - 40, 200, 80, 2);
  x.globalAlpha = 1;
  font(x, `italic 400 112px ${SERIF}`, -1);
  ['Everything', 'I am is', 'in the bag.'].forEach((l, i) => x.fillText(l, W / 2, 640 + i * 112));
  font(x, `400 30px ${TEXT}`, 0);
  x.globalAlpha = 0.82;
  x.fillText('Brand strategy · Fashion marketing · Campaigns', W / 2, 1110);
  x.globalAlpha = 1;
  font(x, `600 19px ${SANS}`, 6);
  x.fillText(`ISSUE ${meta.no}  ·  MMXXVI  ·  NOT FOR SALE`, W / 2, H - 120);
  grain(x, W, H, 0.025);
  return c;
}

/** Spine: printed sideways, reading bottom-to-top like a stacked magazine. */
export function drawSpine(meta: IssueMeta, cs: CoverStyle): HTMLCanvasElement {
  const W = 96, H = 2048;
  const { c, x } = makeCanvas(W, H);
  x.fillStyle = cs.bg;
  x.fillRect(0, 0, W, H);
  x.save();
  x.translate(W / 2, H / 2);
  x.rotate(-Math.PI / 2);
  x.fillStyle = cs.fg;
  x.textAlign = 'center';
  font(x, `800 46px ${SERIF}`, 1);
  x.fillText('SHREYA', -H / 2 + 200, 16);
  font(x, `600 26px ${SANS}`, 5);
  x.fillText(`No. ${meta.no}  —  ${meta.navLabel.toUpperCase()}  —  MMXXVI`, 120, 10);
  x.restore();
  return c;
}

export const MONO_FONT = MONO;
