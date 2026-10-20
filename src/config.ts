/**
 * Content model — who she is, the four issues, the props in the bag.
 * Everything printed (covers, pages, captions) reads from here.
 */

export type IssueId = 'bag' | 'work' | 'cartier' | 'contact';
export type PropId = 'lipstick' | 'pass' | 'card';

export const IDENTITY = {
  name: 'Shreya Gundagani',
  first: 'Shreya',
  last: 'Gundagani',
  role: 'Brand Strategist · Fashion Marketer',
  linkedin: 'https://www.linkedin.com/in/shreya-gundagani-5b7b7b355/',
  instagram: 'https://www.instagram.com/shreya_gundagani/',
  linkedinLabel: 'in/shreya-gundagani',
  instagramLabel: '@shreya_gundagani',
  /** set these when she's ready to publish them — the contact issue adapts */
  email: '',
  phone: '',
};

export interface IssueMeta {
  id: IssueId;
  no: string;
  navLabel: string;
  /** cover: kicker above the main cover line */
  kicker: string;
  /** cover: main cover line, one entry per line */
  title: string[];
  /** cover: standfirst under the main line */
  dek: string;
  /** cover: two secondary cover lines */
  lines: { head: string; sub: string }[];
  /** "p.xx" — the page the issue starts on in the contents */
  page: string;
  /** one-liner used in the landing index */
  teaser: string;
}

export const ISSUES: IssueMeta[] = [
  {
    id: 'bag',
    no: '01',
    navLabel: 'What’s in my bag',
    kicker: 'The bag issue',
    title: ['What’s in', 'my bag'],
    dek: 'A self-portrait, itemised.',
    lines: [
      { head: 'The engineer', sub: 'who took a hard left into luxury — and never signalled' },
      { head: 'No paragraphs', sub: 'nobody reads them — so it’s all in the bag' },
    ],
    page: '02',
    teaser: 'A self-portrait, itemised',
  },
  {
    id: 'work',
    no: '02',
    navLabel: 'Brands that trusted me',
    kicker: 'Four case notes',
    title: ['Brands', 'that trusted', 'me'],
    dek: 'Style Potli · Zykaz · Ikigai · One Off Society',
    lines: [
      { head: 'Strategy', sub: 'positioning, reels, shoots — and one podcast' },
      { head: 'Full decks', sub: 'on request — ask for the walkthrough' },
    ],
    page: '14',
    teaser: 'Style Potli, Zykaz, Ikigai & One Off Society',
  },
  {
    id: 'cartier',
    no: '03',
    navLabel: 'Through the lens of India',
    kicker: 'Cartier · Finalist',
    title: ['Through the', 'lens of India'],
    dek: 'Heritage is a strategy, not a mood board.',
    lines: [
      { head: 'The entry', sub: 'how a finalist reads a brand' },
      { head: 'The brief', sub: 'India, through a jeweller’s eye' },
    ],
    page: '28',
    teaser: 'Cartier competition — finalist',
  },
  {
    id: 'contact',
    no: '04',
    navLabel: 'How to reach me',
    kicker: 'The back page',
    title: ['How to', 'reach me'],
    dek: 'Briefs, collaborations & unsolicited opinions on packaging.',
    lines: [
      { head: 'Open to', sub: 'brand strategy, fashion marketing, campaigns' },
      { head: 'Response time', sub: 'faster than a reel loads' },
    ],
    page: '40',
    teaser: 'Briefs, collabs & opinions on packaging',
  },
];

export const PROP_COPY: Record<PropId, { label: string; ex: string; line: string }> = {
  lipstick: { label: 'The lipstick', ex: 'Exhibit A · The lipstick', line: 'Reapplied before every pitch. Undefeated.' },
  pass: { label: 'The boarding pass', ex: 'Exhibit B · The boarding pass', line: 'One way: from engineering to luxury. Post-grad in Luxury Fashion Brand Management.' },
  card: { label: 'The card', ex: 'Exhibit C · The card', line: 'The card says brand strategist. The bag says the rest.' },
};
