// Render the bag alone (dev server, /dev/bagtest.html) on a reference photo's backdrop,
// full view + knot close-up, in a black knot (shape comparison) and the Bordeaux one.
//   npm run dev   (terminal 1)
//   node bag-render.mjs ../../bag   ->  ../../bag_black.png, bag_bordeaux.png, bag_knot.png, bag_knot_bx.png
import { webkit } from 'playwright';
const out = process.argv[2] || '../bag_now';
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 600, height: 900 } });
await p.goto('http://localhost:5173/dev/bagtest.html');
await p.waitForFunction(() => window.T && window.T.bag);
await p.addStyleTag({ content: 'body{background:#d9dad4 !important}' });
const shots = [
  ['black', ['#0b0a0b', '#4b4a50'], [0, 0.3, 1.62, 0, 0.3, 0]],
  ['bordeaux', null, [0, 0.3, 1.62, 0, 0.3, 0]],
  ['knot', ['#0b0a0b', '#4b4a50'], [-0.06, 0.5, 0.62, -0.07, 0.5, 0]],
  ['knot_bx', null, [-0.06, 0.5, 0.62, -0.07, 0.5, 0]],
];
for (const [name, knot, view] of shots) {
  await p.evaluate(([knot, view]) => {
    const { T } = window;
    T.colour('bordeaux');
    if (knot) T.bag.setColourway({ cord: '#0d0c0c', pouch: '#0b0a0b', pouchSheen: '#4b4a50', rose: knot[0], roseSheen: knot[1] });
    T.view(...view);
    T.bag.reset();
    T.step(420);
  }, [knot, view]);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}_${name}.png` });
}
await b.close();
console.log('ok');
