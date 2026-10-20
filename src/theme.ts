/**
 * Colourways — the site ships in two "editions", like a bag that comes in two
 * colours. Each colourway drives the CSS (studio backdrop, type, accents) and
 * the 3D materials (cord, satin, magazine covers).
 *
 *   Bordeaux  — butter backdrop, black net, burgundy satin   (#832E4B · #000 · #F7DF7D)
 *   Teal      — slate-teal backdrop, cacao net, cacao satin  (#537C80 · #301617)
 */

export type ColourwayId = 'bordeaux' | 'teal';

export interface CoverStyle {
  bg: string;      // cover ground / seamless backdrop of the cover photo
  bgDeep: string;  // vignette tone for the backdrop
  fg: string;      // masthead + cover-line ink
  accent: string;  // small accents (rules, numerals)
}

export interface Colourway {
  id: ColourwayId;
  label: string;
  swatch: [string, string];
  /** CSS custom properties applied to :root */
  css: Record<string, string>;
  /** 3D */
  cord: string;
  cordSheen: number;
  pouch: string;
  pouchSheen: string;
  /** environment-map tint (studio walls) */
  envTop: string;
  envBottom: string;
  /** reader backdrop (behind the open magazine) */
  readerGround: string;
  /** four magazine covers, in issue order */
  covers: [CoverStyle, CoverStyle, CoverStyle, CoverStyle];
  /** interior page palette */
  paper: string;
  paperInk: string;
  pageAccent: string;
}

export const COLOURWAYS: Record<ColourwayId, Colourway> = {
  bordeaux: {
    id: 'bordeaux',
    label: 'Bordeaux',
    swatch: ['#832E4B', '#F7DF7D'],
    css: {
      '--ground-hi': '#fbecb4',
      '--ground': '#f5dc80',
      '--ground-lo': '#dcb95a',
      '--ink': '#160f10',
      '--ink-soft': '#46302f',
      '--muted': '#8a6448',
      '--accent': '#832e4b',
      '--accent-hi': '#9c3a5b',
      '--accent-ink': '#fbecb4',
      '--line': 'rgba(22, 15, 16, 0.88)',
      '--line-soft': 'rgba(22, 15, 16, 0.2)',
      '--masthead': '#160f10',
      '--shadow': 'rgba(70, 40, 10, 0.32)',
      '--reader-ground': '#2a1219',
    },
    cord: '#0d0c0c',
    cordSheen: 0.35,
    pouch: '#0b0a0b',
    pouchSheen: '#4b4a50',
    envTop: '#fff8ec',
    envBottom: '#a39a86',
    readerGround: '#2a1219',
    covers: [
      { bg: '#efe6d3', bgDeep: '#cdbd9c', fg: '#832e4b', accent: '#141011' },
      { bg: '#832e4b', bgDeep: '#4c1729', fg: '#f7df7d', accent: '#f7df7d' },
      { bg: '#191415', bgDeep: '#060505', fg: '#f4ead8', accent: '#e3c262' },
      { bg: '#ebc955', bgDeep: '#b98f24', fg: '#160f10', accent: '#832e4b' },
    ],
    paper: '#f6f1e6',
    paperInk: '#141011',
    pageAccent: '#832e4b',
  },
  teal: {
    id: 'teal',
    label: 'Teal',
    swatch: ['#537C80', '#301617'],
    css: {
      '--ground-hi': '#7da3a6',
      '--ground': '#557e82',
      '--ground-lo': '#36585c',
      '--ink': '#f5ede0',
      '--ink-soft': '#dfe6e1',
      '--muted': '#bcd0cd',
      '--accent': '#301617',
      '--accent-hi': '#4a2224',
      '--accent-ink': '#f5ede0',
      '--line': 'rgba(245, 237, 224, 0.9)',
      '--line-soft': 'rgba(245, 237, 224, 0.26)',
      '--masthead': '#301617',
      '--shadow': 'rgba(10, 30, 32, 0.4)',
      '--reader-ground': '#132629',
    },
    cord: '#2a1314',
    cordSheen: 0.3,
    pouch: '#2b1516',
    pouchSheen: '#8a5a52',
    envTop: '#eef4f2',
    envBottom: '#647a78',
    readerGround: '#16282a',
    covers: [
      { bg: '#ece4d4', bgDeep: '#cbbfa6', fg: '#301617', accent: '#537c80' },
      { bg: '#b9cecb', bgDeep: '#8aa8a4', fg: '#301617', accent: '#3e6a6e' },
      { bg: '#301617', bgDeep: '#130708', fg: '#ece2d0', accent: '#8fb7b9' },
      { bg: '#1d3537', bgDeep: '#0b1819', fg: '#f0e8da', accent: '#c8a27a' },
    ],
    paper: '#f4efe6',
    paperInk: '#1f1213',
    pageAccent: '#3e6a6e',
  },
};

const KEY = 'sg-colourway';

export function initialColourway(): ColourwayId {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'bordeaux' || v === 'teal') return v;
  } catch { /* storage blocked — fine */ }
  return 'bordeaux';
}

export function rememberColourway(id: ColourwayId) {
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
}

/** Push a colourway's tokens onto :root. */
export function applyColourwayCSS(c: Colourway) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(c.css)) root.style.setProperty(k, v);
  root.dataset.colourway = c.id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', c.css['--ground']);
}
