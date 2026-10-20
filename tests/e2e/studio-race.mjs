// Regression: a synchronous studio shot fired while an async read-back is still
// waiting on its GPU fence used to come back blank (three r171 leaves the
// pixel-pack buffer bound). Runs against vite preview on 127.0.0.1:4173.
import { chromium } from 'playwright';
for (const [name, opts] of [['gpu', { channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] }], ['swiftshader', { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }]]) {
  const b = await chromium.launch(opts);
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const warns = [];
  p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text()); });
  await p.goto('http://127.0.0.1:4173/?e2e');
  await p.waitForFunction(() => window.app && window.app.inspect().ready, null, { timeout: 90000 });
  await p.waitForTimeout(1000);
  const r = await p.evaluate(async () => {
    const a = window.app, S = a.studio;
    const Mesh = a.wall.constructor, Std = a.bag.cordMat.constructor, V3 = a.camera.position.constructor;
    const make = (color) => new Mesh(a.wall.geometry.clone(), new Std({ color }));
    const opts = (subject) => ({ subject, width: 640, height: 480, fov: 30, camPos: new V3(0, 0.4, 3), target: new V3(0, 0.4, 0) });
    const inked = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; };
    const pending = S.shootAsync(opts(make('#aa3355')));   // async read queued, waiting on its fence
    const now = S.shoot(opts(make('#3355aa')));             // a sync shot in the meantime
    const later = await pending;
    return { syncInk: inked(now), asyncInk: inked(later) };
  });
  console.log(name, JSON.stringify(r), 'warnings:', warns.length ? warns : 'none');
  await b.close();
}
