// Full end-to-end run against the production build (vite preview) with trusted
// input only: Playwright mouse / keyboard / touchscreen (+ CDP multi-touch on
// Chromium). window.app is exposed by ?e2e and used READ-ONLY (inspect/pickAt).
//
//   node e2e.mjs <target> [<target> …]
//   targets: chromium-desktop webkit-desktop webkit-iphone13 webkit-ipad chromium-pixel7
import { chromium, webkit, firefox, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const ISSUES = ['bag', 'work', 'cartier', 'contact'];
const BAG = '__netbag';

const TARGETS = {
  'chromium-desktop': { type: chromium, ctx: { viewport: { width: 1440, height: 810 } } },
  // the machine's real GPU (new headless + D3D11), like an everyday desktop Chrome
  'chromium-gpu-desktop': { type: chromium, launch: { channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] }, ctx: { viewport: { width: 1920, height: 1080 } } },
  'webkit-desktop': { type: webkit, ctx: { viewport: { width: 1440, height: 810 } } },
  'webkit-iphone13': { type: webkit, ctx: { ...devices['iPhone 13'] } },
  'webkit-ipad': { type: webkit, ctx: { ...devices['iPad (gen 7)'] } },
  'chromium-pixel7': { type: chromium, ctx: { ...devices['Pixel 7'] } },
  'firefox-desktop': { type: firefox, ctx: { viewport: { width: 1440, height: 810 } } },
  'webkit-desktop-reduced-motion': { type: webkit, ctx: { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' } },
};

const brief = (s) => s && { phase: s.phase, ready: s.ready, sel: s.selected, cap: s.caption, cw: s.colourway, out: s.out, in: s.in, reader: s.reader, book: s.bookIssue, hover: s.hover, covers: s.coversReady };

async function runTarget(name) {
  const T = TARGETS[name];
  if (!T) throw new Error('unknown target ' + name);
  const dir = path.resolve('shots', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const browser = await T.type.launch(T.launch ?? { args: T.type === chromium ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [] });
  const ctxOpts = { ...T.ctx };
  delete ctxOpts.defaultBrowserType;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const touch = !!ctxOpts.hasTouch;
  const isChromium = T.type === chromium;
  const cdp = isChromium && touch ? await ctx.newCDPSession(page) : null;

  const errors = [];
  const steps = [];
  const memory = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`); });
  page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('popup', (p) => errors.push(`[unexpected popup] ${p.url()}`));

  const vp = () => page.viewportSize();
  const st = () => page.evaluate(() => window.app.inspect());
  let shotN = 0;
  const shot = async (label) => {
    shotN++;
    await page.screenshot({ path: path.join(dir, `${String(shotN).padStart(3, '0')}-${label}.jpg`), type: 'jpeg', quality: 72 });
  };

  async function waitFor(label, pred, timeout = 60000) {
    const t0 = Date.now();
    let s;
    while (Date.now() - t0 < timeout) {
      s = await st();
      if (pred(s)) return s;
      await page.waitForTimeout(100);
    }
    throw new Error(`timeout: ${label}; last ${JSON.stringify(brief(s))}`);
  }
  async function settle(label) {
    let prev = null;
    return waitFor(label + ' (settle)', (s) => {
      const ok = prev !== null && Math.abs(s.reader.pos - Math.round(s.reader.pos)) < 0.003 && Math.abs(prev - s.reader.pos) < 0.0008
        && Math.abs(s.reader.pos - s.reader.target) < 0.003;
      prev = s.reader.pos;
      return ok;
    });
  }
  async function zoomSettle(label, pred) {
    let prev = null;
    return waitFor(label, (s) => { const ok = prev !== null && Math.abs(prev - s.reader.zoom) < 0.004 && pred(s); prev = s.reader.zoom; return ok; });
  }

  /** a canvas pixel on which a click would pick `id` (and no DOM sits on top) */
  async function pointFor(id) {
    return page.evaluate(({ id }) => {
      const canvas = document.querySelector('canvas');
      const s = window.app.inspect();
      const c = id === '__netbag' ? s.bag : s.items[id];
      if (!c) return null;
      const ok = (x, y) => x > 4 && y > 4 && x < innerWidth - 4 && y < innerHeight - 4 && document.elementFromPoint(x, y) === canvas && window.app.pickAt(x, y) === id;
      if (ok(c.x, c.y)) return { x: c.x, y: c.y };
      for (let r = 6; r <= 160; r += 6)
        for (let a = 0; a < 24; a++) {
          const x = Math.round(c.x + r * Math.cos((a / 24) * Math.PI * 2));
          const y = Math.round(c.y + r * Math.sin((a / 24) * Math.PI * 2));
          if (ok(x, y)) return { x, y };
        }
      return null;
    }, { id });
  }

  /** nothing invisible may catch a click: sample the screen on a grid, twice
   *  (an element that is merely fading in is visible by the second look) */
  async function noGhosts(label) {
    const sample = () => page.evaluate(() => {
      const out = new Set();
      const eff = (el) => {
        let o = 1;
        for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.visibility === 'hidden') return 0;
          o *= parseFloat(cs.opacity);
        }
        return o;
      };
      for (let y = 6; y < innerHeight; y += 18) for (let x = 6; x < innerWidth; x += 18) {
        const el = document.elementFromPoint(x, y);
        if (!el || el.tagName === 'CANVAS' || el === document.body || el === document.documentElement) continue;
        if (eff(el) < 0.05) out.add(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''}`);
      }
      return [...out];
    });
    await page.waitForTimeout(900); // let fades finish
    const first = await sample();
    if (!first.length) return;
    await page.waitForTimeout(800);
    const second = await sample();
    const stuck = first.filter((g) => second.includes(g));
    if (stuck.length) throw new Error(`invisible elements catch clicks (${label}): ${stuck.join(', ')}`);
  }

  async function press(x, y) {
    if (touch) await page.touchscreen.tap(x, y);
    else {
      await page.mouse.move(x, y, { steps: 4 });
      await page.waitForTimeout(60);
      await page.mouse.click(x, y);
    }
  }
  /** wait until the target has stopped travelling (fan settling, sinking back) */
  async function still(id) {
    let prev = null, calm = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const s = await st();
      const c = id === BAG ? s.bag : s.items[id];
      const done = id === BAG || s.phase !== 'open' || c.settled;
      if (done && prev && c && Math.hypot(c.x - prev.x, c.y - prev.y) < 3) { if (++calm >= 2) return; } else calm = 0;
      prev = c;
      await page.waitForTimeout(120);
    }
  }
  async function pressId(id) {
    await still(id);
    let p = null;
    for (let i = 0; i < 20 && !p; i++) { p = await pointFor(id); if (!p) await page.waitForTimeout(150); }
    if (!p) throw new Error(`no clickable point for ${id}`);
    await press(p.x, p.y);
    return p;
  }
  async function pressEl(sel) {
    const loc = page.locator(sel).first();
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    if (touch) await loc.tap(); else await loc.click();
  }

  // ---- multi-touch on Chromium via CDP (real touch events)
  async function cdpTouch(type, pts) {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
  }
  async function cdpSwipe(x0, y0, x1, y1, n = 10) {
    await cdpTouch('touchStart', [[x0, y0]]);
    for (let i = 1; i <= n; i++) { await cdpTouch('touchMove', [[x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]]); await page.waitForTimeout(16); }
    await cdpTouch('touchEnd', []);
  }
  async function cdpPinch(cx, cy, d0, d1, n = 12) {
    await cdpTouch('touchStart', [[cx - d0 / 2, cy], [cx + d0 / 2, cy]]);
    for (let i = 1; i <= n; i++) { const d = d0 + ((d1 - d0) * i) / n; await cdpTouch('touchMove', [[cx - d / 2, cy], [cx + d / 2, cy]]); await page.waitForTimeout(16); }
    await cdpTouch('touchEnd', []);
  }
  async function mouseDrag(x0, y0, x1, y1, n = 10) {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= n; i++) { await page.mouse.move(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n); await page.waitForTimeout(16); }
    await page.mouse.up();
  }
  async function swipe(x0, y0, x1, y1) {
    if (cdp) await cdpSwipe(x0, y0, x1, y1);
    else await mouseDrag(x0, y0, x1, y1);
  }

  async function step(label, fn) {
    const t0 = Date.now();
    const errBefore = errors.length;
    try {
      await fn();
      const newErr = errors.slice(errBefore);
      steps.push({ label, ok: newErr.length === 0, ms: Date.now() - t0, ...(newErr.length ? { errors: newErr } : {}) });
    } catch (e) {
      steps.push({ label, ok: false, ms: Date.now() - t0, fail: String(e.message || e).slice(0, 600) });
      try { await shot('FAIL-' + label.replace(/[^a-z0-9]+/gi, '_')); } catch { /* ignore */ }
      throw e;
    }
  }

  async function load(url = BASE + '?e2e') {
    await page.goto(url);
    await page.waitForFunction(() => window.app && window.app.inspect().ready, null, { timeout: 90000 });
    // let the entrance drop land
    await waitFor('landed', (s) => s.phase === 'closed', 10000);
    await page.waitForTimeout(1600);
  }

  async function openBag() {
    await pressId(BAG);
    await waitFor('bag open', (s) => s.phase === 'open' && s.out, 30000);
    await page.waitForTimeout(400);
  }

  /** turn one page forward with the given method and verify it landed */
  async function turn(method, dir = 1) {
    const s0 = await settle('before turn');
    const from = Math.round(s0.reader.pos);
    const { width: w, height: h } = vp();
    if (method === 'key') await page.keyboard.press(dir > 0 ? 'ArrowRight' : 'ArrowLeft');
    else if (method === 'zone') { const x = dir > 0 ? w * 0.86 : w * 0.12; await press(x, h * 0.5); }
    else if (method === 'drag') { const dx = w * 0.3 * dir; await swipe(w * 0.55 + dx / 2, h * 0.52, w * 0.55 - dx / 2, h * 0.5); }
    else if (method === 'wheel') { await page.mouse.move(w * 0.5, h * 0.5); await page.mouse.wheel(0, 400 * dir); }
    else if (method === 'button') await pressEl(`.reader__arrow[data-dir="${dir}"]`);
    else throw new Error('method ' + method);
    // the input must register (the reader's target moves), then the page lands
    await waitFor(`${method} registered`, (s) => Math.abs(s.reader.target - (from + dir)) < 0.001, 15000);
    const s1 = await waitFor(`${method} landed`, (s) => Math.abs(s.reader.pos - s.reader.target) < 0.003, 30000);
    const to = Math.round(s1.reader.pos);
    if (to !== from + dir) throw new Error(`${method} turn ${dir}: ${from} -> ${to} (stops ${s1.reader.stops})`);
    return s1;
  }

  async function closeReader(how) {
    if (how === 'escape') await page.keyboard.press('Escape');
    else await pressEl('.reader__close');
    await waitFor('reader closed', (s) => s.phase === 'open' && !s.reader.open && !s.selected, 30000);
    await page.waitForTimeout(500);
  }

  async function openIssueByMag(id) {
    await pressId(id);
    await waitFor(`reading ${id}`, (s) => s.phase === 'reading' && s.reader.open && s.bookIssue === id, 30000);
    // the magazine opens itself after a beat
    await page.waitForTimeout(1100);
    return settle('opened');
  }

  const turnMethods = touch ? ['zone', 'drag'] : ['key', 'zone', 'drag', 'wheel', 'button'];

  try {
    /* ---------------------------------------------------------------- A */
    await step('load + hero', async () => {
      await load();
      const s = await st();
      if (s.phase !== 'closed' || !s.ready) throw new Error('not ready/closed');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) throw new Error('horizontal overflow ' + overflow);
      await noGhosts('hero');
      await shot('hero');
    });

    if (!touch) await step('hover bag shows Open label', async () => {
      const p = await pointFor(BAG);
      await page.mouse.move(p.x, p.y, { steps: 5 });
      await waitFor('hover', (s) => s.hover === BAG, 8000);
      const label = (await page.textContent('.cursor__label')) || '';
      if (!/open/i.test(label)) throw new Error('cursor label: ' + label);
      await page.waitForTimeout(500);
      await shot('hero-hover');
    });

    await step('open bag', async () => {
      await openBag();
      await noGhosts('open');
      await shot('open');
    });

    await step('prop captions', async () => {
      let first = true;
      for (const prop of ['lipstick', 'pass', 'card']) {
        await pressId(prop);
        await waitFor('caption ' + prop, (s) => s.caption === prop, 10000);
        const open = await page.evaluate(() => document.querySelector('.caption').classList.contains('is-open'));
        if (!open) throw new Error('caption DOM not open');
        const text = await page.textContent('.caption__line');
        if (!text || text.length < 10) throw new Error('caption text empty');
        await page.waitForTimeout(700);
        if (first) await shot('caption-' + prop);
        first = false;
        const { width: w, height: h } = vp();
        await press(w * 0.5, h * 0.2);
        await waitFor('caption closed', (s) => s.caption === null, 10000);
        await page.waitForTimeout(400);
      }
    });

    await step('pack up (click bag)', async () => {
      await pressId(BAG);
      await waitFor('packed', (s) => s.phase === 'closed' && s.in, 30000);
      await noGhosts('packed');
      await shot('packed');
    });

    /* ---------------------------------------------------------------- B */
    let k = 0;
    await step('open bag again', openBag);
    for (const id of ISSUES) {
      await step(`read ${id} cover to back`, async () => {
        let s = await openIssueByMag(id);
        await shot(`${id}-stop${String(Math.round(s.reader.pos)).padStart(2, '0')}`);
        const stops = s.reader.stops;
        let guard = 0;
        while (Math.round(s.reader.pos) < stops - 1 && guard++ < 60) {
          s = await turn(turnMethods[k++ % turnMethods.length], 1);
          const stop = Math.round(s.reader.pos);
          if (id === 'contact') {
            const links = await page.$$eval('.reader__actions a', (as) => as.map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href'), target: a.target, rel: a.rel })));
            const page2 = (await page.textContent('.reader__count')) || '';
            if (links.length) {
              for (const l of links) {
                if (!/^https:\/\/(www\.)?(linkedin|instagram)\.com\//.test(l.href) && !l.href.startsWith('mailto:')) throw new Error('bad link ' + JSON.stringify(l));
                if (!l.href.startsWith('mailto:') && (l.target !== '_blank' || !/noopener/.test(l.rel))) throw new Error('link target/rel ' + JSON.stringify(l));
              }
              steps.push({ label: `  contact links @${page2}`, ok: true, links: links.map((l) => l.text) });
            }
          }
          await page.waitForTimeout(250);
          await shot(`${id}-stop${String(stop).padStart(2, '0')}`);
        }
        const count = (await page.textContent('.reader__count')) || '';
        if (Math.round(s.reader.pos) !== stops - 1) throw new Error('did not reach the end');
        if (!/back cover/i.test(count)) throw new Error('end label: ' + count);
        // one page back, then close
        s = await turn(touch ? 'zone' : 'key', -1);
        await closeReader(touch ? 'button' : k % 2 ? 'escape' : 'button');
        await noGhosts('after reading ' + id);
      });
      if (id === 'bag') memory.push({ at: 'after first issue', ...(await st()).memory });
    }
    memory.push({ at: 'after four issues', ...(await st()).memory });

    /* ---------------------------------------------------------------- C */
    await step('zoom + pan + reset', async () => {
      await openIssueByMag('work');
      await turn(touch ? 'zone' : 'key', 1);
      const { width: w, height: h } = vp();
      if (cdp) {
        await cdpPinch(w / 2, h / 2, 60, 300);
        await zoomSettle('pinch zoom', (s) => s.reader.zoom > 2.5);
        await shot('zoom-pinch');
        const before = (await st()).reader.pan;
        await cdpSwipe(w * 0.5, h * 0.5, w * 0.5 + 80, h * 0.5 + 60, 8);
        await page.waitForTimeout(500);
        const after = (await st()).reader;
        if (after.pan[0] === before[0] && after.pan[1] === before[1]) throw new Error('pan did not move');
        if (Math.round(after.pos) !== 2) throw new Error('pan turned the page: ' + after.pos);
        await pressEl('.reader__zoom');
        await zoomSettle('zoom reset', (s) => s.reader.zoom < 1.01);
      } else {
        await pressEl('.reader__zoom');
        await zoomSettle('button zoom', (s) => s.reader.zoom > 1.7);
        await shot('zoom-button');
        const before = (await st()).reader;
        await mouseDrag(w * 0.5, h * 0.5, w * 0.5 + 90, h * 0.5 + 70, 8);
        await page.waitForTimeout(500);
        const after = (await st()).reader;
        if (after.pan[0] === before.pan[0] && after.pan[1] === before.pan[1]) throw new Error('pan did not move');
        if (Math.round(after.pos) !== Math.round(before.pos)) throw new Error('pan turned the page');
        await pressEl('.reader__zoom');
        await zoomSettle('zoom reset', (s) => s.reader.zoom < 1.01);
        if (!touch) {
          await page.mouse.move(w * 0.6, h * 0.45);
          await page.keyboard.down('Control');
          await page.mouse.wheel(0, -240);
          await page.keyboard.up('Control');
          await zoomSettle('ctrl-wheel zoom', (s) => s.reader.zoom > 1.2 && s.reader.zoom < 2.2);
          await page.keyboard.press('Equal');
          await zoomSettle('+ zoom', (s) => s.reader.zoom > 1.6);
          await page.keyboard.press('Digit0');
          await zoomSettle('0 reset', (s) => s.reader.zoom < 1.01);
        }
      }
      await closeReader(touch ? 'button' : 'escape');
    });

    await step('next-issue button', async () => {
      await openIssueByMag('contact');
      let s = await st();
      if (!touch) { await page.keyboard.press('End'); s = await settle('end'); }
      else { let g = 0; while (Math.round(s.reader.pos) < s.reader.stops - 1 && g++ < 40) s = await turn('zone', 1); }
      await page.waitForFunction(() => document.querySelector('.reader').classList.contains('is-end'));
      await page.waitForTimeout(500);
      await shot('next-issue-visible');
      await pressEl('.reader__next');
      await waitFor('switched to bag', (s) => s.bookIssue === 'bag' && s.reader.open && s.selected === 'bag', 20000);
      const title = (await page.textContent('.reader__title')) || '';
      if (!/No\. 01/.test(title)) throw new Error('title ' + title);
      await page.waitForTimeout(1200);
      s = await settle('next opened');
      if (Math.round(s.reader.pos) > 1) throw new Error('next issue did not start at the front: ' + s.reader.pos);
      await shot('next-issue-opened');
      await closeReader(touch ? 'button' : 'escape');
    });

    await step('close, then tap "next issue" during the fade-out', async () => {
      await openIssueByMag('work');
      let s = await st();
      if (!touch) { await page.keyboard.press('End'); s = await settle('end'); }
      else { let g = 0; while (Math.round(s.reader.pos) < s.reader.stops - 1 && g++ < 40) s = await turn('zone', 1); }
      await page.waitForFunction(() => document.querySelector('.reader').classList.contains('is-end'));
      await page.waitForTimeout(400);
      const next = await page.locator('.reader__next').boundingBox();
      await pressEl('.reader__close');
      await press(next.x + next.width / 2, next.y + next.height / 2); // straight away, mid-fade
      await waitFor('closed cleanly', (s) => s.phase === 'open' && !s.reader.open && !s.selected, 30000);
      await page.waitForTimeout(1500);
      s = await st();
      if (s.reader.open || s.phase !== 'open') throw new Error('reader came back: ' + JSON.stringify(brief(s)));
    });

    await step('escape / tap-away mid-pick', async () => {
      if (touch) {
        // tap a magazine, then tap the bag while it flies: nothing should break
        await pressId('cartier');
        await page.waitForTimeout(150);
        const { width: w, height: h } = vp();
        await press(w * 0.5, h * 0.06);
        await waitFor('reading anyway', (s) => s.phase === 'reading', 20000);
        await closeReader('button');
      } else {
        await pressId('cartier');
        await page.waitForTimeout(120);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1600);
        const s = await st();
        // with reduced motion the magazine opens in 60 ms — Escape then closes the reader instead
        const okPhase = ctxOpts.reducedMotion === 'reduce' ? (s.phase === 'closed' || s.phase === 'open') : s.phase === 'closed';
        if (!okPhase || s.reader.open || s.selected) throw new Error('mid-pick escape: ' + JSON.stringify(brief(s)));
        if (s.phase === 'closed') await openBag();
      }
    });

    /* ---------------------------------------------------------------- D */
    await step('colourway → teal', async () => {
      await pressEl('.swatch[aria-label="Teal colourway"]');
      await waitFor('teal covers', (s) => s.colourway === 'teal' && s.coversReady, 120000);
      await page.waitForTimeout(1500);
      await shot('teal-open');
      await openIssueByMag('cartier');
      await turn(touch ? 'zone' : 'key', 1);
      await page.waitForTimeout(300);
      await shot('teal-reading');
      await closeReader(touch ? 'button' : 'escape');
    });

    await step('teal persists on reload', async () => {
      await load();
      const s = await st();
      if (s.colourway !== 'teal') throw new Error('colourway after reload ' + s.colourway);
      await shot('teal-hero');
    });

    await step('rapid colourway toggling', async () => {
      await pressEl('.swatch[aria-label="Bordeaux colourway"]');
      await pressEl('.swatch[aria-label="Teal colourway"]');
      await pressEl('.swatch[aria-label="Bordeaux colourway"]');
      await waitFor('bordeaux settled', (s) => s.colourway === 'bordeaux' && s.coversReady, 120000);
      await page.waitForTimeout(800);
      await shot('bordeaux-after-toggle');
    });

    if (!touch) {
      /* -------------------------------------------------------------- E */
      await step('keyboard: Enter opens, Esc packs', async () => {
        await load();
        await page.keyboard.press('Enter');
        await waitFor('open via Enter', (s) => s.phase === 'open', 15000);
        await page.keyboard.press('Escape');
        await waitFor('packed via Esc', (s) => s.phase === 'closed', 15000);
      });
      await step('keyboard: Tab to a cover line, Enter reads', async () => {
        let found = false;
        for (let i = 0; i < 16 && !found; i++) {
          await page.keyboard.press('Tab');
          found = await page.evaluate(() => document.activeElement?.classList.contains('cline'));
        }
        if (!found) throw new Error('no cover line reachable by Tab');
        const label = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
        await page.keyboard.press('Enter');
        await waitFor('reading via keyboard', (s) => s.phase === 'reading' && s.reader.open, 20000);
        // keyboard users land inside the reader (on slow machines it can take a moment)
        const landed = await page.waitForFunction(() => /reader__close/.test(document.activeElement?.className || ''), null, { timeout: 6000 }).then(() => true, () => false);
        if (!landed) throw new Error('focus not in reader: ' + (await page.evaluate(() => document.activeElement?.className)));
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await settle('kbd turns');
        await page.keyboard.press('End');
        let s = await settle('kbd end');
        if (Math.round(s.reader.pos) !== s.reader.stops - 1) throw new Error('End key');
        await page.keyboard.press('Home');
        s = await settle('kbd home');
        if (Math.round(s.reader.pos) !== 0) throw new Error('Home key');
        await page.keyboard.press('Escape');
        await waitFor('closed via Esc', (s) => s.phase === 'open' && !s.reader.open, 20000);
        await page.keyboard.press('Escape');
        await waitFor('packed', (s) => s.phase === 'closed', 15000);
        steps.push({ label: '  focused ' + label, ok: true });
      });

      /* -------------------------------------------------------------- F */
      await step('resize while reading (landscape → portrait → back)', async () => {
        await openBag();
        await openIssueByMag('bag');
        await turn('key', 1);
        await page.setViewportSize({ width: 820, height: 1180 });
        await page.waitForTimeout(1200);
        let s = await settle('portrait');
        if (!s.reader.single) throw new Error('not single in portrait');
        await shot('resize-portrait-reading');
        await turn('key', 1);
        await page.setViewportSize({ width: 1440, height: 810 });
        await page.waitForTimeout(1200);
        s = await settle('landscape');
        if (s.reader.single) throw new Error('still single in landscape');
        await closeReader('escape');
        await page.setViewportSize({ width: 820, height: 1180 });
        await page.waitForTimeout(1500);
        await shot('resize-portrait-open');
        await page.setViewportSize({ width: 1440, height: 810 });
        await page.waitForTimeout(1500);
        await pressId(BAG);
        await waitFor('packed', (s) => s.phase === 'closed', 20000);
      });
    } else {
      await step('rotate to landscape while reading', async () => {
        await openBag();
        await openIssueByMag('bag');
        await turn('zone', 1);
        const { width: w, height: h } = vp();
        await page.setViewportSize({ width: h, height: w });
        await page.waitForTimeout(1500);
        await settle('landscape');
        await shot('rotated-reading');
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(1500);
        await settle('portrait');
        await closeReader('button');
        await pressId(BAG);
        await waitFor('packed', (s) => s.phase === 'closed', 20000);
      });
      await step('mobile index opens an issue', async () => {
        const visible = await page.isVisible('.mobile-index button');
        if (!visible) { steps.push({ label: '  (mobile index hidden on this viewport)', ok: true }); return; }
        await page.locator('.mobile-index button').nth(2).tap();
        await waitFor('reading via index', (s) => s.phase === 'reading' && s.bookIssue === 'cartier', 20000);
        await page.waitForTimeout(1200);
        await shot('index-cartier');
        await closeReader('button');
      });
    }
    memory.push({ at: 'end', ...(await st()).memory });
  } catch (e) {
    /* recorded in steps */
  }

  const result = {
    name,
    ok: steps.every((s) => s.ok) && errors.length === 0,
    steps,
    errors: [...new Set(errors)],
    memory,
  };
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 1));
  await browser.close();
  return result;
}

const names = process.argv.slice(2);
for (const n of names.length ? names : Object.keys(TARGETS)) {
  const t0 = Date.now();
  const r = await runTarget(n);
  console.log(`\n=== ${n}: ${r.ok ? 'PASS' : 'FAIL'} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const s of r.steps) console.log(`${s.ok ? '  ok ' : '  XX '} ${s.label}${s.ms ? ` (${(s.ms / 1000).toFixed(1)} s)` : ''}${s.fail ? '\n       ' + s.fail : ''}${s.errors ? '\n       ' + s.errors.join('\n       ') : ''}${s.links ? ' ' + s.links.join(', ') : ''}`);
  if (r.errors.length) console.log('  errors:\n   ' + r.errors.join('\n   '));
  console.log('  memory: ' + r.memory.map((m) => `${m.at}: g${m.geometries}/t${m.textures}/p${m.programs}`).join(' · '));
}
