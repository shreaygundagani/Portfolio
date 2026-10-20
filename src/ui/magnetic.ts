/**
 * Magnetic hover — the element eases toward the cursor while hovered and springs
 * back on leave. Dependency-free (a small critically-ish-damped lerp). Disabled
 * on coarse pointers.
 */
export function magnetic(el: HTMLElement, strength = 0.35, ease = 0.16) {
  if (matchMedia('(pointer: coarse)').matches) return;
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, active = false;

  const loop = () => {
    cx += (tx - cx) * ease;
    cy += (ty - cy) * ease;
    el.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`;
    const settled = Math.abs(tx - cx) < 0.08 && Math.abs(ty - cy) < 0.08;
    if (active || !settled) {
      raf = requestAnimationFrame(loop);
    } else {
      raf = 0;
      el.style.transform = '';
    }
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  el.addEventListener('pointerenter', () => { active = true; kick(); });
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    tx = (e.clientX - (r.left + r.width / 2)) * strength;
    ty = (e.clientY - (r.top + r.height / 2)) * strength;
    kick();
  });
  el.addEventListener('pointerleave', () => { active = false; tx = 0; ty = 0; kick(); });
}
