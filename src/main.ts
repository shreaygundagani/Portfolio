import './style.css';
import { App } from './app';

// ---- loader: a real progress readout while fonts load and the covers are shot
const loader = document.getElementById('loader')!;
const bar = loader.querySelector('.loader__bar i') as HTMLElement;
const pct = document.getElementById('loaderPct')!;
const msg = document.getElementById('loaderMsg')!;
let shown = 0;
let target = 0;
const tick = () => {
  shown += (target - shown) * 0.12;
  if (target - shown < 0.002) shown = target;
  bar.style.transform = `scaleX(${shown})`;
  pct.textContent = String(Math.round(shown * 100)).padStart(2, '0');
  if (shown < 1) requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
const progress = (p: number, m: string) => {
  target = Math.max(target, p);
  msg.textContent = m;
  requestAnimationFrame(tick);
};
const done = () => {
  target = 1;
  requestAnimationFrame(tick);
  window.setTimeout(() => loader.classList.add('is-done'), 420);
};

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

if (!webglOK()) {
  loader.classList.add('is-done');
  document.getElementById('content')!.classList.remove('sr-only');
  document.getElementById('content')!.classList.add('fallback');
} else {
  const app = new App(document.getElementById('stage') as HTMLCanvasElement);
  // inspection hook: always in dev; in production only with ?e2e (automated tests)
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) (window as any).app = app;
  app.init(progress).then(done).catch((e) => {
    console.error(e);
    done();
  });
}
