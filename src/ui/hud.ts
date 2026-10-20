import { ISSUES, IssueId, PropId, PROP_COPY } from '../config';
import { COLOURWAYS, ColourwayId } from '../theme';
import { magnetic } from './magnetic';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** "Tap" on touch screens, "Click" with a mouse */
export const ACT = matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click';

export interface TagPos { id: IssueId; x: number; y: number; visible: boolean; hover: boolean; }

/**
 * The cover furniture around the bag: top line, cover lines (the contents),
 * the bottom bar with the colourway swatches, plus the issue tags that follow
 * the fanned magazines and the caption card for the props.
 */
export class HUD {
  root = el('div', 'hud');
  onIssue: (id: IssueId) => void = () => {};
  onSound: () => boolean = () => false;
  onColourway: (id: ColourwayId) => void = () => {};
  /** the pointer is heading for the swatches — a good moment to prepare */
  onColourwayIntent: () => void = () => {};
  onCloseCaption: () => void = () => {};

  private cueText!: HTMLElement;
  private swatches = new Map<ColourwayId, HTMLButtonElement>();
  private tags = new Map<IssueId, HTMLButtonElement>();
  private caption = el('aside', 'caption');
  private captionEx = el('div', 'caption__ex');
  private captionLine = el('div', 'caption__line');
  private captionAt = 0;
  private soundEl: HTMLElement | null = null;

  constructor(active: ColourwayId) {
    // ---- top line
    const top = el('header', 'hud-top');
    top.innerHTML = `
      <div class="hud-top__name">Shreya Gundagani</div>
      <div class="hud-top__issue">No. 01 — Autumn / Winter MMXXVI</div>
      <div class="hud-top__tools"></div>`;
    const sound = el('button', 'sound-toggle', '<span class="sound-toggle__bars"><i></i><i></i><i></i></span><span>Sound</span>');
    sound.type = 'button';
    sound.setAttribute('aria-pressed', 'false');
    sound.addEventListener('click', () => {
      const on = this.onSound();
      sound.classList.toggle('is-on', on);
      sound.setAttribute('aria-pressed', String(on));
    });
    top.querySelector('.hud-top__tools')!.appendChild(sound);
    this.soundEl = sound;
    this.root.appendChild(top);

    // ---- cover lines (two each side)
    const left = el('nav', 'coverlines coverlines--left');
    const right = el('nav', 'coverlines coverlines--right');
    left.setAttribute('aria-label', 'Contents');
    right.setAttribute('aria-label', 'Contents, continued');
    ISSUES.forEach((it, i) => {
      const b = el('button', 'cline');
      b.type = 'button';
      b.innerHTML = `
        <span class="cline__kicker"><span>No. ${it.no}</span><span class="cline__pg">p.${it.page}</span></span>
        <span class="cline__title">${it.navLabel}</span>
        <span class="cline__dek">${it.teaser}</span>
        <span class="cline__rule"></span>`;
      b.setAttribute('aria-label', `Read issue ${it.no}: ${it.navLabel}`);
      b.addEventListener('click', () => this.onIssue(it.id));
      magnetic(b, 0.12);
      (i < 2 ? left : right).appendChild(b);
    });
    this.root.append(left, right);

    // ---- mobile contents strip
    const mob = el('nav', 'mobile-index');
    mob.setAttribute('aria-label', 'Issues');
    const short: Record<IssueId, string> = { bag: 'The bag', work: 'Brands', cartier: 'Cartier', contact: 'Contact' };
    ISSUES.forEach((it) => {
      const b = el('button', '', `<span>${it.no}</span>${short[it.id]}`);
      b.type = 'button';
      b.addEventListener('click', () => this.onIssue(it.id));
      mob.appendChild(b);
    });
    this.root.appendChild(mob);

    // ---- bottom bar
    const bottom = el('footer', 'hud-bottom');
    bottom.innerHTML = `
      <div class="barcode"><i></i><span>No. 01 · MMXXVI · NOT FOR SALE</span></div>
      <div class="cue" role="status"><span class="cue__pip"></span><span class="cue__text">${ACT} the bag to open it</span></div>
      <div class="colourway"><span class="colourway__label">Colourway</span></div>`;
    this.cueText = bottom.querySelector('.cue__text') as HTMLElement;
    const cwWrap = bottom.querySelector('.colourway') as HTMLElement;
    cwWrap.addEventListener('pointerenter', () => this.onColourwayIntent());
    cwWrap.addEventListener('focusin', () => this.onColourwayIntent());
    (Object.keys(COLOURWAYS) as ColourwayId[]).forEach((id) => {
      const c = COLOURWAYS[id];
      const b = el('button', 'swatch', `<span class="swatch__chip"><b style="background:${c.swatch[0]}"></b><b style="background:${c.swatch[1]}"></b></span><span>${c.label}</span>`);
      b.type = 'button';
      b.setAttribute('aria-label', `${c.label} colourway`);
      b.addEventListener('click', () => this.onColourway(id));
      this.swatches.set(id, b);
      cwWrap.appendChild(b);
    });
    this.root.appendChild(bottom);
    this.setColourway(active);

    // ---- issue tags (follow the magazines when the bag is open)
    ISSUES.forEach((it) => {
      const t = el('button', 'itag', `<span class="itag__no">No. ${it.no}</span><span class="itag__title"><span class="itag__full">${it.navLabel}</span><span class="itag__short">${short[it.id]}</span></span>`);
      t.type = 'button';
      t.tabIndex = -1;
      t.addEventListener('click', () => this.onIssue(it.id));
      this.tags.set(it.id, t);
      this.root.appendChild(t);
    });

    // ---- prop caption
    const card = el('div', 'caption__card');
    card.append(this.captionEx, this.captionLine, el('div', 'caption__hint', `${ACT} anywhere to put it back`));
    // announced when it opens; hidden from assistive tech while closed
    card.setAttribute('aria-live', 'polite');
    this.caption.setAttribute('aria-label', 'From the bag');
    this.caption.setAttribute('aria-hidden', 'true');
    this.caption.appendChild(card);
    // a tap that opens the caption is followed by the browser's own click on
    // whatever is now under the finger (this overlay) — don't let it close it
    this.caption.addEventListener('click', () => { if (performance.now() - this.captionAt > 450) this.onCloseCaption(); });
    document.body.appendChild(this.caption);

    document.body.appendChild(this.root);
  }

  /** no Web Audio here: no Sound toggle */
  hideSound() { this.soundEl?.remove(); }

  setColourway(id: ColourwayId) {
    this.swatches.forEach((b, k) => {
      b.classList.toggle('is-active', k === id);
      b.setAttribute('aria-pressed', String(k === id));
    });
  }

  setCue(text: string) {
    if (this.cueText.textContent === text) return;
    this.cueText.style.opacity = '0';
    window.setTimeout(() => { this.cueText.textContent = text; this.cueText.style.opacity = '1'; }, 220);
  }

  private tagRoom = new Map<IssueId, number>();
  placeTags(list: TagPos[]) {
    list.forEach((p) => {
      const t = this.tags.get(p.id);
      if (!t) return;
      // a label never runs into its neighbour: wrap to the gap between them
      let room = 9999;
      list.forEach((q) => { if (q !== p && Math.abs(q.y - p.y) < 80) room = Math.min(room, Math.abs(q.x - p.x)); });
      room = Math.round(Math.max(90, room - 16));
      if (Math.abs((this.tagRoom.get(p.id) ?? 0) - room) > 3) { this.tagRoom.set(p.id, room); t.style.maxWidth = `${room}px`; }
      t.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, 0)`;
      t.classList.toggle('is-ready', p.visible);
      t.classList.toggle('is-hover', p.hover);
      t.tabIndex = p.visible ? 0 : -1;
    });
  }

  hideTags() {
    this.tags.forEach((t) => { t.classList.remove('is-ready', 'is-hover'); t.tabIndex = -1; });
  }

  showCaption(id: PropId) {
    const c = PROP_COPY[id];
    this.captionEx.textContent = c.ex;
    this.captionLine.textContent = c.line;
    this.caption.classList.add('is-open');
    this.caption.setAttribute('aria-hidden', 'false');
    this.captionAt = performance.now();
  }

  hideCaption() { this.caption.classList.remove('is-open'); this.caption.setAttribute('aria-hidden', 'true'); }
}
