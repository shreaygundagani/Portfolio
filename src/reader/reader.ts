import './reader.css';
import { ISSUES, IssueId, IDENTITY } from '../config';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** was the last interaction a key press? (focus is only moved for keyboard users) */
let keyboardMode = false;
window.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') keyboardMode = true; }, true);
window.addEventListener('pointerdown', () => { keyboardMode = false; }, true);

/**
 * Reader chrome + input. The magazine itself is a 3D object (see Book); this
 * owns the reading position (a springy float you can drag, scroll or step),
 * the overlay controls, and maps the position onto the book:
 *   wide screens  — one stop per spread (0 = cover … n = back cover)
 *   narrow screens — the book pans page by page inside each spread
 */
export class Reader {
  private root = document.createElement('div');
  private titleEl!: HTMLElement;
  private countEl!: HTMLElement;
  private barEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private nextEl!: HTMLButtonElement;
  private hintEl!: HTMLElement;
  pos = 0;              // smoothed reading position (in stops)
  private target = 0;
  private vel = 0;
  stops = 1;
  private leaves = 1;
  single = false;
  private issue: IssueId | null = null;
  private drag = { on: false, x: 0, from: 0, moved: false, id: -1 };
  private mounted = false;
  private touched = false;
  private autoTimer = 0;
  private lastShownStop = -1;

  // zoom: pinch, the zoom button or ctrl/trackpad-pinch; while zoomed a drag pans
  zoom = 1;
  panX = 0;            // viewport fractions, like NDC (-1 … 1)
  panY = 0;
  private zoomT = 1;
  private panTX = 0;
  private panTY = 0;
  private pts = new Map<number, { x: number; y: number; type: string }>();
  private zone!: HTMLElement;
  private pinch: { d0: number; z0: number } | null = null;
  private pan: { x: number; y: number; px: number; py: number; id: number } | null = null;
  private zoomBtn!: HTMLButtonElement;

  onClose: () => void = () => {};
  onNextIssue: (id: IssueId) => void = () => {};
  onTurn: () => void = () => {};

  constructor() {
    this.root.className = 'reader';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Magazine reader');
    this.root.innerHTML = `
      <div class="reader__zone" aria-hidden="true"></div>
      <header class="reader__bar">
        <div class="reader__title"></div>
        <div class="reader__count" aria-live="polite"></div>
        <button class="reader__close" type="button" aria-label="Close the magazine"><span>Back to the bag</span><i aria-hidden="true"></i></button>
      </header>
      <div class="reader__actions"></div>
      <footer class="reader__nav">
        <button class="reader__arrow" data-dir="-1" type="button" aria-label="Previous page">←</button>
        <div class="reader__progress"><i></i></div>
        <button class="reader__arrow" data-dir="1" type="button" aria-label="Next page">→</button>
        <button class="reader__zoom" type="button" aria-label="Zoom in" aria-pressed="false"><i></i></button>
      </footer>
      <div class="reader__hint">${matchMedia('(pointer: coarse)').matches ? 'Swipe to turn · pinch to zoom' : 'Drag or use ← → to turn'}</div>
      <button class="reader__next" type="button"></button>`;
    this.titleEl = this.root.querySelector('.reader__title')!;
    this.countEl = this.root.querySelector('.reader__count')!;
    this.barEl = this.root.querySelector('.reader__progress i')!;
    this.actionsEl = this.root.querySelector('.reader__actions')!;
    this.nextEl = this.root.querySelector('.reader__next')!;
    this.hintEl = this.root.querySelector('.reader__hint')!;
    document.body.appendChild(this.root);

    const zone = this.root.querySelector('.reader__zone') as HTMLElement;
    zone.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.interact();
      // ctrl+wheel / trackpad pinch: ~1.5× per mouse notch, smooth on a trackpad
      if (e.ctrlKey) { this.zoomAt(this.zoomT * Math.exp(-clamp(e.deltaY, -120, 120) * 0.0035), e.clientX, e.clientY); return; }
      if (this.zoomT > 1.01) { this.panBy(-e.deltaX, -e.deltaY); return; }
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      this.target = clamp(this.target + d * 0.0026, 0, this.stops - 1);
      window.clearTimeout(this.snapTimer);
      this.snapTimer = window.setTimeout(() => { this.target = Math.round(this.target); }, 160);
    }, { passive: false });
    zone.addEventListener('pointerdown', (e) => {
      this.interact();
      this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      // capture is best-effort: it throws if the pointer is already gone
      try { zone.setPointerCapture(e.pointerId); } catch { /* keep going */ }
      if (this.pts.size === 2) {
        // a second finger turns the gesture into a pinch
        this.drag.on = false;
        this.pan = null;
        const [a, b] = [...this.pts.values()];
        this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.zoomT };
        this.root.classList.remove('is-turning');
        return;
      }
      if (this.pts.size > 2) return;
      this.root.classList.add('is-turning');
      if (this.zoomT > 1.01) {
        this.pan = { x: e.clientX, y: e.clientY, px: this.panTX, py: this.panTY, id: e.pointerId };
        return;
      }
      if (this.drag.on) return;
      this.drag = { on: true, x: e.clientX, from: this.target, moved: false, id: e.pointerId };
    });
    zone.addEventListener('pointermove', (e) => {
      const known = this.pts.get(e.pointerId);
      if (known) { known.x = e.clientX; known.y = e.clientY; }
      if (this.pinch) {
        if (this.pts.size < 2) return;
        const [a, b] = [...this.pts.values()];
        this.zoomAt(this.pinch.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d0), (a.x + b.x) / 2, (a.y + b.y) / 2);
        return;
      }
      if (this.pan && e.pointerId === this.pan.id) {
        this.panTX = this.pan.px + (e.clientX - this.pan.x) / (window.innerWidth / 2);
        this.panTY = this.pan.py - (e.clientY - this.pan.y) / (window.innerHeight / 2);
        this.clampPan();
        return;
      }
      if (!this.drag.on || e.pointerId !== this.drag.id) return;
      const dx = e.clientX - this.drag.x;
      if (Math.abs(dx) > 6) this.drag.moved = true;
      const perStop = Math.min(window.innerWidth * (this.single ? 0.5 : 0.36), 520);
      this.target = clamp(this.drag.from - dx / perStop, 0, this.stops - 1);
    });
    const end = (e: PointerEvent) => {
      this.pts.delete(e.pointerId);
      if (this.pinch) {
        if (this.pts.size < 2) {
          this.pinch = null;
          if (this.zoomT < 1.08) this.resetZoom();
        }
        return;
      }
      if (this.pan && e.pointerId === this.pan.id) {
        this.pan = null;
        this.root.classList.remove('is-turning');
        return;
      }
      if (!this.drag.on || e.pointerId !== this.drag.id) return;
      this.root.classList.remove('is-turning');
      if (!this.drag.moved) {
        const r = zone.getBoundingClientRect();
        this.step((e.clientX - r.left) / r.width < 0.4 ? -1 : 1);
      } else {
        // flick: commit in the direction of travel
        const dir = Math.sign(this.target - this.drag.from);
        const frac = Math.abs(this.target - this.drag.from) % 1;
        this.target = clamp(dir > 0 ? (frac > 0.18 ? Math.ceil(this.target) : Math.floor(this.target)) : (frac > 0.18 ? Math.floor(this.target) : Math.ceil(this.target)), 0, this.stops - 1);
      }
      this.drag.on = false;
    };
    zone.addEventListener('pointerup', end);
    // a cancelled pointer (the system took the gesture, capture was lost) ends
    // whatever it was doing — it is never a tap, so no page turn
    const cancel = (e: PointerEvent) => this.dropPointer(e.pointerId);
    zone.addEventListener('pointercancel', cancel);
    zone.addEventListener('lostpointercapture', cancel);
    this.zone = zone;
    // a pointer that went down here but never came up (a missed pointerup) must
    // not stay captured — its retargeted clicks would swallow the buttons. Any
    // new press of another kind, or the same pointer pressing again, clears it.
    window.addEventListener('pointerdown', (e) => {
      for (const [id, p] of this.pts) if (id === e.pointerId || p.type !== e.pointerType) this.dropPointer(id);
    }, true);

    this.zoomBtn = this.root.querySelector('.reader__zoom') as HTMLButtonElement;
    this.zoomBtn.addEventListener('click', () => {
      this.interact();
      if (this.zoomT > 1.01) this.resetZoom();
      else this.zoomAt(this.single ? 2 : 1.8, window.innerWidth / 2, window.innerHeight / 2);
    });

    this.root.querySelector('.reader__close')!.addEventListener('click', () => this.close());
    this.root.querySelectorAll('.reader__arrow').forEach((b) =>
      b.addEventListener('click', () => { this.interact(); this.step(Number((b as HTMLElement).dataset.dir)); })
    );
    this.nextEl.addEventListener('click', () => {
      if (!this.mounted) return;
      const i = ISSUES.findIndex((x) => x.id === this.issue);
      const next = ISSUES[(i + 1) % ISSUES.length];
      this.onNextIssue(next.id);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.mounted) return;
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); this.interact(); this.step(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); this.interact(); this.step(-1); }
      else if (e.key === 'Home') { this.interact(); this.target = 0; }
      else if (e.key === 'End') { this.interact(); this.target = this.stops - 1; }
      else if (e.key === '+' || e.key === '=') { this.interact(); this.zoomAt(this.zoomT * 1.4, window.innerWidth / 2, window.innerHeight / 2); }
      else if (e.key === '-' || e.key === '_') { this.interact(); this.zoomAt(this.zoomT / 1.4, window.innerWidth / 2, window.innerHeight / 2); }
      else if (e.key === '0') { this.interact(); this.resetZoom(); }
    });
  }

  private snapTimer = 0;

  private interact() {
    this.touched = true;
    window.clearTimeout(this.autoTimer);
  }

  private step(n: number) {
    this.resetZoom();
    this.target = clamp(Math.round(this.target) + n, 0, this.stops - 1);
  }

  /** zoom to z, keeping the content under (cx, cy) where it is */
  private zoomAt(z: number, cx: number, cy: number) {
    const nz = clamp(z, 1, 3.2);
    const u = (cx / window.innerWidth) * 2 - 1;
    const v = -(cy / window.innerHeight) * 2 + 1;
    this.panTX = u - (u - this.panTX) * (nz / this.zoomT);
    this.panTY = v - (v - this.panTY) * (nz / this.zoomT);
    this.zoomT = nz;
    if (nz <= 1.001) { this.panTX = this.panTY = 0; }
    this.clampPan();
    this.syncZoomUI();
  }

  private panBy(dx: number, dy: number) {
    this.panTX += dx / (window.innerWidth / 2);
    this.panTY -= dy / (window.innerHeight / 2);
    this.clampPan();
  }

  private clampPan() {
    const lim = Math.max(0, this.zoomT - 1);
    this.panTX = clamp(this.panTX, -lim, lim);
    this.panTY = clamp(this.panTY, -lim, lim);
  }

  /** end one pointer's part in any gesture, without it counting as a tap */
  private dropPointer(id: number) {
    if (!this.pts.has(id)) return;
    this.pts.delete(id);
    try { if (this.zone.hasPointerCapture(id)) this.zone.releasePointerCapture(id); } catch { /* gone */ }
    if (this.pinch && this.pts.size < 2) { this.pinch = null; if (this.zoomT < 1.08) this.resetZoom(); }
    if (this.pan && this.pan.id === id) this.pan = null;
    if (this.drag.on && this.drag.id === id) {
      this.drag.on = false;
      this.target = clamp(Math.round(this.target), 0, this.stops - 1);
    }
    if (!this.pts.size) this.root.classList.remove('is-turning');
  }

  /** forget every pointer and gesture in progress (and let go of captures) —
   *  a gesture interrupted by the reader closing must not haunt the next one */
  private resetGestures() {
    for (const id of this.pts.keys()) {
      try { if (this.zone.hasPointerCapture(id)) this.zone.releasePointerCapture(id); } catch { /* gone */ }
    }
    this.pts.clear();
    this.drag.on = false;
    this.pan = null;
    this.pinch = null;
    this.root.classList.remove('is-turning');
  }

  private resetZoom() {
    this.zoomT = 1;
    this.panTX = this.panTY = 0;
    this.pan = null;
    this.syncZoomUI();
  }

  private syncZoomUI() {
    const on = this.zoomT > 1.01;
    this.root.classList.toggle('is-zoomed', on);
    if (this.zoomBtn) {
      this.zoomBtn.setAttribute('aria-pressed', String(on));
      this.zoomBtn.setAttribute('aria-label', on ? 'Zoom out' : 'Zoom in');
    }
  }

  /** leaves = number of sheets in the book; single = page-at-a-time mode */
  open(id: IssueId, leaves: number, single: boolean) {
    const meta = ISSUES.find((x) => x.id === id)!;
    this.issue = id;
    this.leaves = leaves;
    this.single = single;
    this.stops = single ? 2 * leaves : leaves + 1;
    this.pos = 0;
    this.target = 0;
    this.vel = 0;
    this.touched = false;
    this.lastShownStop = -1;
    this.resetGestures();
    this.resetZoom();
    this.zoom = 1;
    this.panX = this.panY = 0;
    this.titleEl.innerHTML = `<b>No. ${meta.no}</b> ${meta.navLabel}`;
    const next = ISSUES[(ISSUES.findIndex((x) => x.id === id) + 1) % ISSUES.length];
    this.nextEl.innerHTML = `Next: <i>No. ${next.no} — ${next.navLabel}</i> →`;
    const wasMounted = this.mounted;
    this.mounted = true;
    this.root.classList.add('is-mounted');
    requestAnimationFrame(() => requestAnimationFrame(() => { if (this.mounted) this.root.classList.add('is-open'); }));
    // keyboard users land inside the reader (mouse and touch users don't need the ring)
    if (!wasMounted && keyboardMode) window.setTimeout(() => (this.root.querySelector('.reader__close') as HTMLElement)?.focus({ preventScroll: true }), 60);
    // the magazine opens itself, unless you get there first
    this.autoTimer = window.setTimeout(() => { if (!this.touched && this.mounted) this.target = 1; }, 650);
    this.refresh(true);
  }

  /** change single/double mode while open (rotation / resize) */
  setSingle(single: boolean) {
    if (!this.mounted || single === this.single) return;
    const st = this.state(this.target);
    this.single = single;
    this.stops = single ? 2 * this.leaves : this.leaves + 1;
    // land on the equivalent stop
    let t: number;
    if (single) t = st.page <= 0 ? 0 : st.page >= this.leaves ? this.stops - 1 : 1 + (Math.round(st.page) - 1) * 2;
    else t = Math.round(st.page);
    this.target = this.pos = clamp(t, 0, this.stops - 1);
    this.vel = 0;
  }

  close() {
    if (!this.mounted) return;
    this.mounted = false;
    window.clearTimeout(this.autoTimer);
    this.resetGestures();
    this.resetZoom();
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.root.classList.remove('is-open');
    window.setTimeout(() => { if (!this.mounted) this.root.classList.remove('is-mounted'); }, 600);
    this.onClose();
  }

  isOpen() { return this.mounted; }
  /** where the reader is heading (in stops) — for tests */
  targetStop() { return this.target; }

  /** reading position → book state */
  state(p = this.pos): { page: number; focus: number } {
    const n = this.leaves;
    if (!this.single) return { page: clamp(p, 0, n), focus: 0 };
    const last = this.stops - 1;
    if (p <= 1) return { page: clamp(p, 0, 1), focus: -clamp(p, 0, 1) };
    if (p >= last - 1) { const t = p - (last - 1); return { page: n - 1 + t, focus: 1 - t }; }
    const q = p - 1;            // 0 = spread 1 left
    const k = Math.floor(q / 2);
    const f = q - k * 2;        // 0 … 2
    if (f <= 1) return { page: 1 + k, focus: -1 + 2 * f };
    const t = f - 1;            // turning to the next spread
    return { page: 1 + k + t, focus: 1 - 2 * t };
  }

  update(dt: number) {
    const h = Math.min(dt, 1 / 30);
    const kz = Math.min(1, h * 12);
    this.zoom += (this.zoomT - this.zoom) * kz;
    this.panX += (this.panTX - this.panX) * kz;
    this.panY += (this.panTY - this.panY) * kz;
    if (!this.mounted && Math.abs(this.pos - this.target) < 1e-3) return;
    if (this.drag.on) {
      this.pos += (this.target - this.pos) * Math.min(1, h * 18);
      this.vel = 0;
    } else {
      const k = 120, c = 22;
      this.vel += ((this.target - this.pos) * k - this.vel * c) * h;
      this.pos += this.vel * h;
      if (Math.abs(this.target - this.pos) < 0.0006 && Math.abs(this.vel) < 0.01) { this.pos = this.target; this.vel = 0; }
    }
    this.pos = clamp(this.pos, 0, this.stops - 1);
    this.refresh(false);
  }

  private refresh(force: boolean) {
    const stop = Math.round(this.pos);
    this.barEl.style.transform = `scaleX(${this.stops > 1 ? this.pos / (this.stops - 1) : 0})`;
    if (!force && stop === this.lastShownStop) return;
    if (this.lastShownStop >= 0 && stop !== this.lastShownStop) this.onTurn();
    this.lastShownStop = stop;
    const st = this.state(stop);
    const page = Math.round(st.page);
    const n = this.leaves;
    let label: string;
    if (page <= 0) label = 'Cover';
    else if (page >= n) label = 'Back cover';
    else if (this.single) label = `Page ${(page - 1) * 2 + (st.focus > 0 ? 2 : 1)} / ${(n - 1) * 2}`;
    else label = `Spread ${page} / ${n - 1}`;
    this.countEl.textContent = label;
    const atEnd = stop >= this.stops - 1 || page >= n - 1;
    this.root.classList.toggle('is-end', atEnd && page > 0);
    this.root.classList.toggle('is-start', stop === 0);
    this.hintEl.style.opacity = stop <= 1 && !this.touched ? '' : '0';
    this.renderActions(page);
  }

  private renderActions(page: number) {
    let html = '';
    if (this.issue === 'contact' && page >= 1 && page <= 2) {
      const links: [string, string][] = [
        ['LinkedIn', IDENTITY.linkedin],
        ['Instagram', IDENTITY.instagram],
      ];
      if (IDENTITY.email) links.push(['Email', `mailto:${IDENTITY.email}`]);
      html = links.map(([l, h]) => `<a class="reader__link" href="${h}" target="${h.startsWith('mailto') ? '_self' : '_blank'}" rel="noopener">${l} <span aria-hidden="true">↗</span></a>`).join('');
    }
    if (this.actionsEl.dataset.html !== html) {
      this.actionsEl.dataset.html = html;
      this.actionsEl.innerHTML = html;
    }
  }
}
