/**
 * A quiet custom cursor: a ring that eases behind the pointer and a dot that
 * sits exactly on it. The ring swells over things you can pick up and can
 * carry a short label. Hidden on touch / coarse pointers (see CSS).
 */
export type CursorState = 'default' | 'pointer' | 'grab' | 'grabbing' | 'label' | 'hidden';

export class Cursor {
  private ring = document.createElement('div');
  private dot = document.createElement('div');
  private label = document.createElement('span');
  private x = -100;
  private y = -100;
  private rx = -100;
  private ry = -100;
  private state: CursorState = 'default';
  private text = '';

  constructor() {
    this.ring.className = 'cursor';
    this.label.className = 'cursor__label';
    this.ring.appendChild(this.label);
    this.dot.className = 'cursor__dot';
    // purely decorative: assistive tech gets the real controls instead
    this.ring.setAttribute('aria-hidden', 'true');
    this.dot.setAttribute('aria-hidden', 'true');
    document.body.append(this.ring, this.dot);
    this.dot.style.transform = this.ring.style.transform = 'translate3d(-100px, -100px, 0)';

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.x = e.clientX;
      this.y = e.clientY;
      this.dot.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
    }, { passive: true });
    document.addEventListener('pointerleave', () => { this.x = this.y = -100; });

    const tick = () => {
      this.rx += (this.x - this.rx) * 0.2;
      this.ry += (this.y - this.ry) * 0.2;
      this.ring.style.transform = `translate3d(${this.rx.toFixed(1)}px, ${this.ry.toFixed(1)}px, 0)`;
      requestAnimationFrame(tick);
    };
    tick();
  }

  set(state: CursorState, label = '') {
    if (state !== this.state) {
      this.state = state;
      document.body.dataset.cursor = state;
    }
    if (state === 'label' && label !== this.text) {
      this.text = label;
      this.label.innerHTML = label;
    }
  }
}
