// Randomised abuse testing: seeded random taps, drags, swipes, keys, wheel,
// buttons, colourway switches and resizes, with state invariants checked after
// every action, then a normal visit that must still work. On failure it prints
// the app's internal state and the last input events.
//   node monkey.mjs <chromium-gpu|webkit-iphone|webkit-desktop|firefox> <seed> <actions>
import { chromium, webkit, firefox, devices } from 'playwright';

const [targetName = 'chromium-gpu', seedArg = '1', nArg = '160'] = process.argv.slice(2);
const TARGETS = {
  'chromium-gpu': { type: chromium, launch: { channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] }, ctx: { viewport: { width: 1440, height: 860 } } },
  'webkit-iphone': { type: webkit, ctx: { ...devices['iPhone 13'] } },
  'webkit-desktop': { type: webkit, ctx: { viewport: { width: 1280, height: 800 } } },
  'firefox': { type: firefox, ctx: { viewport: { width: 1366, height: 768 } } },
};
const T = TARGETS[targetName];
let seed = Number(seedArg) >>> 0;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const browser = await T.type.launch(T.launch ?? {});
const o = { ...T.ctx }; delete o.defaultBrowserType;
const ctx = await browser.newContext(o);
const page = await ctx.newPage();
const touch = !!o.hasTouch;
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' STACK ' + String(e.stack || '').split(String.fromCharCode(10)).slice(0, 10).join(' <- ')));
// never leave the site: only the app itself and its web fonts may load
await ctx.route((url) => !/^http:\/\/127\.0\.0\.1:4173\//.test(url.href) && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url.href), (route) => route.abort());
// only failures of the blocked off-site requests are noise; our own must not fail
const isOffsiteNoise = (m) => /Failed to load resource|ERR_FAILED|net::/.test(m.text()) && !/^http:\/\/127\.0\.0\.1:4173\//.test(m.location()?.url || '');
page.on('popup', async (p) => { await p.close().catch(() => {}); }); // a link opening is fine (and blocked above)
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !isOffsiteNoise(m)) errors.push(`console.${m.type()}: ${m.text()}`); });

await page.addInitScript(() => {
  window.__ev = [];
  const rec = (e) => { window.__ev.push(`${Math.round(performance.now())} ${e.type}:${(e.target && (e.target.className || e.target.tagName)) || ''}:pid${e.pointerId ?? ''}:${e.pointerType || ''}`); if (window.__ev.length > 60) window.__ev.shift(); };
  for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'click', 'keydown']) window.addEventListener(t, rec, true);
  window.__ctx = [];
  document.addEventListener('webglcontextlost', (e) => window.__ctx.push('lost ' + Math.round(performance.now())), true);
  document.addEventListener('webglcontextrestored', (e) => window.__ctx.push('restored ' + Math.round(performance.now())), true);
});
await page.goto('http://127.0.0.1:4173/?e2e');
await page.waitForFunction(() => window.app && window.app.inspect().ready, null, { timeout: 90000 });
await page.waitForTimeout(1500);
const st = () => page.evaluate(() => window.app.inspect());
const vp = () => page.viewportSize();

async function invariants(label) {
  const r = await page.evaluate(() => {
    const s = window.app.inspect();
    const b = document.body.classList;
    const bad = [];
    if (!['closed', 'open', 'reading'].includes(s.phase)) bad.push('phase ' + s.phase);
    if (s.reader.open && s.phase !== 'reading') bad.push('reader open outside reading');
    if (s.caption && s.phase !== 'open') bad.push('caption outside open');
    if (s.selected && s.phase === 'closed') bad.push('selection while closed');
    if (b.contains('is-reading') !== (s.phase === 'reading')) bad.push('is-reading class mismatch');
    if (s.phase === 'closed' && b.contains('is-open')) bad.push('is-open while closed');
    if (s.reader.pos < -0.01 || s.reader.pos > s.reader.stops - 1 + 0.01) bad.push('reader pos ' + s.reader.pos);
    if (s.reader.zoom < 0.99 || s.reader.zoom > 3.21) bad.push('zoom ' + s.reader.zoom);
    if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) bad.push('page scrolls');
    if (window.scrollX || window.scrollY) bad.push('page scrolled');
    return { bad, s: { phase: s.phase, sel: s.selected, cap: s.caption, reader: s.reader.open, pos: s.reader.pos, cw: s.colourway } };
  });
  if (r.bad.length) throw new Error(`${label}: ${r.bad.join('; ')} ${JSON.stringify(r.s)}`);
  return r.s;
}

async function tap(x, y) {
  if (touch) await page.touchscreen.tap(x, y);
  else { await page.mouse.move(x, y, { steps: 2 }); await page.mouse.click(x, y); }
}
async function drag(x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6); await page.waitForTimeout(12); }
  await page.mouse.up();
}
async function clickVisible(selector) {
  const els = await page.$$(selector);
  const vis = [];
  for (const e of els) { if (await e.isVisible().catch(() => false)) vis.push(e); }
  if (!vis.length) return 'none';
  const el = pick(vis);
  const box = await el.boundingBox().catch(() => null);
  if (!box || box.width < 2) return 'nobox';
  await tap(box.x + box.width / 2, box.y + box.height / 2);
  return 'ok';
}

const ACTIONS = [
  ['tap-random', 6, async () => { const { width: w, height: h } = vp(); await tap(10 + rnd() * (w - 20), 10 + rnd() * (h - 20)); }],
  ['tap-bag', 4, async () => { const s = await st(); await tap(s.bag.x, Math.min(Math.max(s.bag.y, 5), vp().height - 5)); }],
  ['tap-item', 5, async () => { const s = await st(); const it = s.items[pick(Object.keys(s.items))]; await tap(Math.min(Math.max(it.x, 5), vp().width - 5), Math.min(Math.max(it.y, 5), vp().height - 5)); }],
  ['drag', 4, async () => { const { width: w, height: h } = vp(); await drag(rnd() * w, rnd() * h, rnd() * w, rnd() * h); }],
  ['key', touch ? 0 : 6, async () => { await page.keyboard.press(pick(['Escape', 'Enter', 'ArrowRight', 'ArrowLeft', 'Tab', 'Space', '+', '-', '0', 'Home', 'End', 'PageDown'])); }],
  ['wheel', touch ? 0 : 3, async () => { const { width: w, height: h } = vp(); await page.mouse.move(rnd() * w, rnd() * h); if (rnd() < 0.3) await page.keyboard.down('Control'); await page.mouse.wheel((rnd() - 0.5) * 300, (rnd() - 0.5) * 700); await page.keyboard.up('Control'); }],
  ['button', 6, async () => { await clickVisible(pick(['.reader__arrow', '.reader__zoom', '.reader__close', '.reader__next', '.cline', '.mobile-index button', '.itag', '.caption', '.sound-toggle'])); }],
  ['swatch', 2, async () => { await clickVisible('.swatch'); }],
  ['resize', touch ? 0 : 1, async () => { await page.setViewportSize(pick([{ width: 1440, height: 860 }, { width: 900, height: 1100 }, { width: 1280, height: 720 }, { width: 760, height: 380 }])); }],
  ['rotate', touch ? 1 : 0, async () => { const { width: w, height: h } = vp(); await page.setViewportSize({ width: h, height: w }); }],
  ['wait', 4, async () => { await page.waitForTimeout(300 + rnd() * 1200); }],
];
const bag = []; ACTIONS.forEach(([name, wgt, fn]) => { for (let i = 0; i < wgt; i++) bag.push([name, fn]); });

const N = Number(nArg);
const log = [];
let failure = null;
try {
  for (let i = 0; i < N; i++) {
    const [name, fn] = pick(bag);
    const errsBefore = errors.length;
    await fn();
    await page.waitForTimeout(40 + rnd() * 260);
    const s = await invariants(`#${i} ${name}`);
    log.push(`${i} ${name} → ${s.phase}${s.sel ? ' sel=' + s.sel : ''}${s.cap ? ' cap=' + s.cap : ''}${s.reader ? ' reading p' + s.pos : ''} ${s.cw}`);
    if (errors.length > errsBefore) throw new Error(`#${i} ${name}: ${errors.slice(errsBefore).join(' | ')}`);
  }
  // recovery: whatever state it ended in, a normal visit must still work
  if (!touch) await page.setViewportSize(T.ctx.viewport);
  await page.waitForTimeout(800);
  for (let k = 0; k < 4; k++) {
    const s = await st();
    if (s.phase === 'reading' && s.reader.open) await clickVisible('.reader__close');
    else if (s.caption) await tap(vp().width / 2, 30);
    await page.waitForTimeout(900);
  }
  await page.waitForFunction(() => window.app.inspect().phase !== 'reading', null, { timeout: 20000 });
  let s = await st();
  if (s.phase === 'closed') { await tap(s.bag.x, s.bag.y); await page.waitForFunction(() => window.app.inspect().out, null, { timeout: 30000 }); }
  await page.waitForTimeout(1500);
  s = await st();
  const it = s.items.work;
  await tap(it.x, it.y);
  await page.waitForFunction(() => window.app.inspect().phase === 'reading' && window.app.inspect().reader.open, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  if (touch) await tap(vp().width * 0.86, vp().height * 0.5); else await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.app.inspect().reader.pos >= 1.99, null, { timeout: 20000 });
  await clickVisible('.reader__close');
  await page.waitForFunction(() => window.app.inspect().phase === 'open' && !window.app.inspect().reader.open, null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  s = await st();
  await tap(s.bag.x, s.bag.y);
  await page.waitForFunction(() => window.app.inspect().phase === 'closed', null, { timeout: 30000 });
  await invariants('recovery');
  if (errors.length) throw new Error('errors: ' + errors.join(' | '));
} catch (e) {
  failure = String(e.message || e);
  const dump = await page.evaluate(() => {
    const a = window.app, r = a.reader, zone = document.querySelector('.reader__zone'), close = document.querySelector('.reader__close');
    const box = close.getBoundingClientRect();
    const under = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const caps = [0, 1, 2, 3].filter((id) => { try { return zone.hasPointerCapture(id); } catch { return false; } });
    const ccaps = [0, 1, 2, 3].filter((id) => { try { return document.getElementById('stage').hasPointerCapture(id); } catch { return false; } });
    return { phase: a.phase, sel: a.selectedId, closing: a.closing, bookIssue: a.bookIssue, mounted: r.mounted, pos: r.pos, target: r.targetStop(), stops: r.stops, pts: [...r.pts.keys()], drag: r.drag, pan: r.pan, pinch: r.pinch, zoomT: r.zoomT,
      zoneCaptures: caps, stageCaptures: ccaps, ctx: window.__ctx, frames: a.time, readerCls: document.querySelector('.reader').className, bodyCls: document.body.className, underClose: under && (under.className || under.tagName), active: document.activeElement && document.activeElement.className, ev: window.__ev.slice(-25) };
  }).catch((err) => ({ dumpFailed: String(err) }));
  console.log('STATE ' + JSON.stringify(dump, null, 1));
  await page.screenshot({ path: `monkey-fail-${targetName}-${seedArg}.png` }).catch(() => {});
}
const mem = await st().then((s) => s.memory).catch(() => null);
console.log(`${targetName} seed ${seedArg}: ${failure ? 'FAIL' : 'PASS'} (${log.length}/${N} actions)${mem ? ` mem g${mem.geometries}/t${mem.textures}/p${mem.programs}` : ''}`);
if (failure) { console.log('  ' + failure); if (errors.length) console.log('  page errors: ' + errors.join(' | ')); console.log('  last actions:\n   ' + log.slice(-8).join('\n   ')); }
await browser.close();
process.exit(failure ? 1 : 0);
