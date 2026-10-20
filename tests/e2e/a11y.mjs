// Accessibility audit (axe-core, WCAG 2.1 A/AA) of each state of the site.
import { chromium, devices } from 'playwright';
import path from 'node:path';

const AXE = path.resolve('node_modules/axe-core/axe.min.js');
const targets = [
  ['desktop', { viewport: { width: 1440, height: 860 } }],
  ['phone', (() => { const o = { ...devices['Pixel 7'] }; delete o.defaultBrowserType; return o; })()],
];
const b = await chromium.launch({ channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
for (const [name, opts] of targets) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:4173/?e2e');
  await p.waitForFunction(() => window.app && window.app.inspect().ready, null, { timeout: 90000 });
  await p.waitForTimeout(2500);
  const audit = async (label) => {
    await p.addScriptTag({ path: AXE });
    const res = await p.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + (n.any?.[0]?.message ? ' — ' + n.any[0].message : '')) }));
    });
    console.log(`\n[${name}] ${label}: ${res.length ? res.length + ' violation types' : 'no violations'}`);
    res.forEach((v) => { console.log(`  ${v.impact?.toUpperCase()} ${v.id} (${v.n}): ${v.help}`); v.nodes.forEach((n) => console.log('     · ' + n.slice(0, 220))); });
  };
  await audit('hero');
  const s = await p.evaluate(() => window.app.inspect());
  if (opts.hasTouch) await p.touchscreen.tap(s.bag.x, s.bag.y); else await p.mouse.click(s.bag.x, s.bag.y);
  await p.waitForFunction(() => window.app.inspect().out, null, { timeout: 30000 });
  await p.waitForTimeout(2500);
  await audit('open');
  const s2 = await p.evaluate(() => window.app.inspect());
  if (opts.hasTouch) await p.touchscreen.tap(s2.items.lipstick.x, s2.items.lipstick.y); else await p.mouse.click(s2.items.lipstick.x, s2.items.lipstick.y);
  await p.waitForTimeout(1200);
  await audit('caption');
  if (opts.hasTouch) await p.touchscreen.tap(20, 300); else await p.mouse.click(20, 300);
  await p.waitForTimeout(1200);
  const s3 = await p.evaluate(() => window.app.inspect());
  if (opts.hasTouch) await p.touchscreen.tap(s3.items.contact.x, s3.items.contact.y); else await p.mouse.click(s3.items.contact.x, s3.items.contact.y);
  await p.waitForFunction(() => window.app.inspect().phase === 'reading', null, { timeout: 30000 });
  await p.waitForTimeout(2500);
  await audit('reader (contact issue)');
  await ctx.close();
}
await b.close();
