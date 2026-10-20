import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { COLOURWAYS, applyColourwayCSS, ColourwayId } from '../theme';
import { buildEnvironment } from '../scene/environment';
import { NetBag } from '../scene/netbag';
import { buildMagazine } from '../scene/magazineModel';
import { MAG_IN_BAG, MAG_BEND_IN_BAG, stackCollider } from '../scene/bagLayout';
import { Studio } from '../scene/studio';
import { shootCoverPhotos, composeCovers } from '../art/shoots';
import { loadFonts } from '../art/canvas';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);

let cw = COLOURWAYS.bordeaux;
applyColourwayCSS(cw);
const scene = new THREE.Scene();
const rig = buildEnvironment(renderer, scene, cw);
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 20);
camera.position.set(0, 0.33, 1.25);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.31, 0);
controls.update();

const bag = new NetBag(cw);
scene.add(bag.root);

// placeholder covers
function quickCover(bg: string, fg: string, label: string) {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 795;
  const x = c.getContext('2d')!;
  x.fillStyle = bg; x.fillRect(0, 0, 600, 795);
  x.fillStyle = fg; x.font = '600 150px "Bodoni Moda", serif'; x.textAlign = 'center';
  x.fillText('SHREYA', 300, 170);
  x.font = 'italic 500 60px "Bodoni Moda", serif'; x.fillText(label, 300, 600);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const mags = cw.covers.map((cs, i) => {
  const m = buildMagazine();
  const tex = quickCover(cs.bg, cs.fg, ['What’s in my bag', 'Brands', 'Cartier', 'Contact'][i]);
  m.setTextures(tex, tex, tex);
  m.bend.value = MAG_BEND_IN_BAG[i];
  scene.add(m.group);
  m.group.matrixAutoUpdate = false;
  return m;
});
// the same in-bag placement and net collider as the site
const LOCAL = MAG_IN_BAG;
bag.colliders = [stackCollider(LOCAL)!];
bag.setHandRest(new THREE.Vector3(0, bag.handLocal.y, 0));

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let t = 0;
const frame = (dt: number) => {
  t += dt;
  bag.update(dt, t);
  mags.forEach((m, i) => { m.group.matrix.multiplyMatrices(bag.loadMatrix, LOCAL[i]); m.group.matrixWorldNeedsUpdate = true; });
  renderer.render(scene, camera);
};
let last = performance.now();
const loop = () => {
  requestAnimationFrame(loop);
  const now = performance.now();
  frame(Math.min((now - last) / 1000, 1 / 30));
  last = now;
};
loop();

(window as any).T = {
  THREE, renderer, scene, camera, controls, bag, rig, mags,
  step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) frame(dt); },
  colour(id: ColourwayId) { cw = COLOURWAYS[id]; applyColourwayCSS(cw); rig.setColourway(cw); bag.setColourway(cw); },
  async covers() {
    await loadFonts();
    const studio = new Studio(renderer);
    const t0 = performance.now();
    const photos = await shootCoverPhotos(studio, cw);
    const t1 = performance.now();
    const cv = composeCovers(cw, photos);
    const t2 = performance.now();
    let wrap = document.getElementById('covers');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'covers'; document.body.appendChild(wrap); }
    wrap.style.cssText = 'position:fixed;inset:0;display:flex;gap:12px;align-items:center;justify-content:center;background:#222;z-index:9;padding:12px';
    wrap.innerHTML = '';
    cv.forEach((c) => { c.style.cssText = 'position:static;height:auto;width:23.5vw;'; wrap!.appendChild(c); });
    return { shoot: Math.round(t1 - t0), compose: Math.round(t2 - t1) };
  },
  hideCovers() { document.getElementById('covers')?.remove(); },
  view(x: number, y: number, z: number, tx = 0, ty = 0.31, tz = 0) { camera.position.set(x, y, z); controls.target.set(tx, ty, tz); controls.update(); },
};
