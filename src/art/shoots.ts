import * as THREE from 'three';
import type { Colourway } from '../theme';
import { ISSUES } from '../config';
import { Studio } from '../scene/studio';
import { NetBag } from '../scene/netbag';
import { buildMagazine } from '../scene/magazineModel';
import { MAG_IN_BAG, MAG_BEND_IN_BAG, stackCollider } from '../scene/bagLayout';
import { lipstick, lens, envelope, card, businessCardTexture, boardingPassTexture } from '../scene/props';
import type { Shot } from '../scene/studio';
import { COVER_W, COVER_H, drawCover } from './covers';
import { makeCanvas, toTexture, font, SERIF, backdrop } from './canvas';

/* The cover photography: four still lifes, shot in the offscreen studio. */

/**
 * Release a still life's GPU buffers and textures — except anything in `keep`
 * or marked userData.keep. Materials are deliberately NOT disposed: three.js
 * frees a shader program when its last material goes, so disposing them made
 * every shot (and every colourway re-shoot) recompile all its shaders.
 */
function disposeTree(root: THREE.Object3D, keep: Set<THREE.Texture> = new Set()) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mat) => {
      const anyMat = mat as THREE.MeshStandardMaterial;
      [anyMat.map, anyMat.normalMap, anyMat.emissiveMap, anyMat.roughnessMap].forEach((t) => { if (t && !keep.has(t) && !t.userData.keep) t.dispose(); });
    });
  });
}

/** hand the main thread back between heavy steps so animation keeps flowing */
const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

/** a stand-in cover for the magazines that appear inside the bag on cover 01 */
function miniCover(bg: string, fg: string) {
  const { c, x } = makeCanvas(400, 530);
  backdrop(x, 400, 530, bg, bg);
  x.fillStyle = fg;
  font(x, `800 104px ${SERIF}`, -2);
  x.textAlign = 'center';
  x.fillText('SHREYA', 200, 120);
  return toTexture(c, 4);
}

export interface CoverPhotos { bag: Shot; work: Shot; cartier: Shot; contact: Shot; }

export async function shootCoverPhotos(studio: Studio, cw: Colourway): Promise<CoverPhotos> {
  const W = Math.round(COVER_W * 0.75), H = Math.round(COVER_H * 0.75);

  // ---------------------------------------------------------------- 01 · the bag
  const bag = new NetBag(cw);
  await yieldTask();
  const mags = MAG_IN_BAG.map((m, i) => {
    const mg = buildMagazine();
    const cs = cw.covers[(i + 1) % 4];
    const t = miniCover(cs.bg, cs.fg);
    mg.setTextures(t, t, t);
    mg.bend.value = MAG_BEND_IN_BAG[i];
    mg.group.matrixAutoUpdate = false;
    bag.load.add(mg.group);
    mg.group.matrix.copy(m);
    return { mg, t };
  });
  const col = stackCollider(MAG_IN_BAG);
  bag.colliders = col ? [col] : [];
  bag.setHandRest(new THREE.Vector3(0, bag.handLocal.y, 0));
  await yieldTask();
  for (let i = 0; i < 30; i++) bag.update(1 / 60, 3 + i / 60);
  await yieldTask();
  const bagShot = await studio.shootAsync({
    subject: bag.root, width: W, height: H, fov: 24,
    camPos: new THREE.Vector3(-0.06, 0.36, 2.04), target: new THREE.Vector3(-0.098, 0.3, 0),
    key: new THREE.Vector3(-0.9, 1.1, 1.2), keyIntensity: 2.4,
    shadowAt: new THREE.Vector3(0, 0, -0.32), shadowNormal: new THREE.Vector3(0, 0, 1), shadowOpacity: 0.22, shadowExtent: 0.75,
  });
  // detach the magazines first — their geometry is shared with the live ones
  // (their materials are kept, see disposeTree; only the stand-in covers go)
  mags.forEach(({ mg, t }) => { bag.load.remove(mg.group); t.dispose(); });
  bag.dispose(true);
  await yieldTask();

  // ------------------------------------------------------------ 02 · the lipstick
  const still2 = new THREE.Group();
  const lip = lipstick(cw.id === 'bordeaux' ? '#8c1834' : '#7a2a2c', '#141012', true);
  lip.scale.setScalar(2.4);
  lip.rotation.y = -0.5;
  still2.add(lip);
  const bc = card(0.085, 0.055, businessCardTexture(cw.css['--accent'], '#151011'), 0.0008);
  bc.rotation.x = -Math.PI / 2;
  bc.rotation.z = 0.5;
  bc.scale.setScalar(1.7);
  bc.position.set(-0.03, 0.001, -0.07);
  still2.add(bc);
  still2.position.x = 0.045;
  const workShot = await studio.shootAsync({
    subject: still2, width: W, height: H, fov: 22,
    camPos: new THREE.Vector3(0.02, 0.17, 0.7), target: new THREE.Vector3(0.0, 0.082, 0),
    key: new THREE.Vector3(-1.0, 1.3, 0.8), keyIntensity: 2.8,
    shadowAt: new THREE.Vector3(0, 0, 0), shadowNormal: new THREE.Vector3(0, 1, 0), shadowOpacity: 0.4,
  });
  disposeTree(still2);
  await yieldTask();

  // ---------------------------------------------------------------- 03 · the lens
  const still3 = new THREE.Group();
  const ln = lens();
  ln.scale.setScalar(2.6);
  ln.rotation.set(-0.62, 0.38, 0);
  ln.position.y = 0.075;
  still3.add(ln);
  const lensShot = await studio.shootAsync({
    subject: still3, width: W, height: H, fov: 22,
    camPos: new THREE.Vector3(0.0, 0.21, 0.9), target: new THREE.Vector3(-0.034, 0.066, 0),
    key: new THREE.Vector3(-0.7, 1.4, 0.9), keyIntensity: 2.6,
    shadowAt: new THREE.Vector3(0, 0, 0), shadowNormal: new THREE.Vector3(0, 1, 0), shadowOpacity: 0.45,
  });
  disposeTree(still3);
  await yieldTask();

  // ------------------------------------------------------------ 04 · the envelope
  const still4 = new THREE.Group();
  const env = envelope(cw.id === 'bordeaux' ? '#6e1a33' : '#2f1516', '#f1e9d8', cw.id === 'bordeaux' ? '#5a1428' : '#301617');
  env.scale.setScalar(1.25);
  env.rotation.set(-Math.PI / 2 + 0.05, 0, 0.22);
  env.position.y = 0.004;
  still4.add(env);
  const envShot = await studio.shootAsync({
    subject: still4, width: W, height: H, fov: 24,
    camPos: new THREE.Vector3(0.02, 0.86, 0.58), target: new THREE.Vector3(-0.01, 0.0, -0.075),
    key: new THREE.Vector3(-0.8, 1.6, 0.5), keyIntensity: 2.6,
    shadowAt: new THREE.Vector3(0, 0, 0), shadowNormal: new THREE.Vector3(0, 1, 0), shadowOpacity: 0.36,
  });
  disposeTree(still4);

  return { bag: bagShot, work: workShot, cartier: lensShot, contact: envShot };
}

export function composeCovers(cw: Colourway, photos: CoverPhotos): HTMLCanvasElement[] {
  return ISSUES.map((meta, i) => drawCover(meta, cw.covers[i], photos[meta.id]));
}

/**
 * The inventory flat-lay: everything from the bag, shot from above, for the
 * spread in Issue 01, with projected anchors (in the order of INVENTORY) for
 * the numbered callouts. Built as a generator so the work can be spread over
 * several tasks (see shootFlatLayAsync) instead of stalling a frame.
 */
interface FlatSet { g: THREE.Group; anchors: THREE.Vector3[]; release(): void; }

function* buildFlatLay(cw: Colourway, covers: THREE.Texture[]): Generator<void, FlatSet, void> {
  const g = new THREE.Group();
  const anchors: THREE.Vector3[] = [];
  const flat = (o: THREE.Object3D, x: number, z: number, ry: number, y = 0) => {
    o.position.set(x, y, z);
    o.rotation.y = ry;
    g.add(o);
    return o;
  };
  // 1 · two magazines, one on the other
  const magHolders: THREE.Object3D[] = [];
  [1, 0].forEach((ci, k) => {
    const mg = buildMagazine();
    mg.setTextures(covers[ci], covers[ci], covers[ci]);
    mg.bend.value = 0;
    const holder = new THREE.Group();
    mg.group.rotation.x = -Math.PI / 2;
    holder.add(mg.group);
    flat(holder, -0.235 + k * 0.035, 0.115 - k * 0.018, 0.28 - k * 0.22, 0.003 + k * 0.0065);
    magHolders.push(holder);
  });
  anchors.push(new THREE.Vector3(-0.3, 0, -0.01));
  yield;
  // 2 · lipstick, lying down
  const lip = lipstick(cw.id === 'bordeaux' ? '#8c1834' : '#7a2a2c', '#141012', false);
  const lipH = new THREE.Group();
  lip.rotation.z = Math.PI / 2;
  lip.position.y = 0.0112;
  lipH.add(lip);
  lipH.scale.setScalar(1.25);
  flat(lipH, 0.035, -0.015, 0.7);
  anchors.push(new THREE.Vector3(-0.005, 0, -0.06));
  yield;
  // 3 · boarding pass
  const pass = card(0.2, 0.08, boardingPassTexture(cw.css['--accent'], '#151011'));
  pass.rotation.x = -Math.PI / 2;
  const passH = new THREE.Group(); passH.add(pass);
  flat(passH, 0.25, -0.185, -0.1, 0.0006);
  anchors.push(new THREE.Vector3(0.14, 0, -0.232));
  yield;
  // 4 · business card
  const bc = card(0.085, 0.055, businessCardTexture(cw.css['--accent'], '#151011'));
  bc.rotation.x = -Math.PI / 2;
  const bcH = new THREE.Group(); bcH.add(bc);
  bcH.scale.setScalar(1.15);
  flat(bcH, -0.045, 0.165, 0.3, 0.0006);
  anchors.push(new THREE.Vector3(-0.098, 0, 0.13));
  yield;
  // 5 · lens, standing on its mount
  const ln = lens();
  ln.rotation.x = -Math.PI / 2;
  const lnH = new THREE.Group(); lnH.add(ln);
  lnH.scale.setScalar(1.2);
  flat(lnH, 0.165, 0.045, 0, 0.034);
  anchors.push(new THREE.Vector3(0.16, 0, -0.008));
  yield;
  // 6 · envelope
  const env = envelope(cw.id === 'bordeaux' ? '#6e1a33' : '#2f1516', '#f1e9d8', cw.id === 'bordeaux' ? '#5a1428' : '#301617');
  env.rotation.x = -Math.PI / 2;
  const envH = new THREE.Group(); envH.add(env);
  envH.scale.setScalar(0.9);
  flat(envH, 0.33, -0.03, 0.18, 0.0016);
  anchors.push(new THREE.Vector3(0.4, 0, -0.085));

  return {
    g, anchors,
    release() {
      // the magazines' geometry is shared and their textures are the live
      // covers: just take them out (materials are kept, see disposeTree)
      magHolders.forEach((h) => g.remove(h));
      disposeTree(g, new Set(covers));
    },
  };
}

const flatShot = (set: FlatSet, W: number, H: number) => {
  const h = 1.24;
  return {
    subject: set.g, width: W, height: H, fov: 25,
    camPos: new THREE.Vector3(0.0, h, h * 0.16), target: new THREE.Vector3(0.0, 0, 0.0),
    key: new THREE.Vector3(-0.7, 1.5, -0.4), keyIntensity: 2.5,
    shadowAt: new THREE.Vector3(0, 0, 0), shadowNormal: new THREE.Vector3(0, 1, 0), shadowOpacity: 0.32, shadowExtent: 0.6,
    anchors: set.anchors,
  };
};

function shootFlatSet(studio: Studio, set: FlatSet, W: number, H: number): Shot {
  const shot = studio.shoot(flatShot(set, W, H));
  set.release();
  return shot;
}

/** In one go — for when the spread is needed right now. */
export function shootFlatLay(studio: Studio, cw: Colourway, covers: THREE.Texture[], W = 1650, H = 1094): Shot {
  const it = buildFlatLay(cw, covers);
  let r = it.next();
  while (!r.done) r = it.next();
  return shootFlatSet(studio, r.value, W, H);
}

/** In the background: one prop per task, then the printed textures uploaded a
 *  task apart, so the shot itself only has to draw. `alive()` going false
 *  (the covers changed) abandons the job and resolves null. */
export async function shootFlatLayAsync(studio: Studio, cw: Colourway, covers: THREE.Texture[], alive: () => boolean, W = 1650, H = 1094): Promise<Shot | null> {
  const it = buildFlatLay(cw, covers);
  let r = it.next();
  while (!r.done) {
    await yieldTask();
    r = it.next();
  }
  const set = r.value;
  const textures = new Set<THREE.Texture>();
  set.g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => {
      const a = mat as THREE.MeshStandardMaterial;
      [a.map, a.normalMap, a.roughnessMap].forEach((t) => { if (t && !covers.includes(t)) textures.add(t); });
    });
  });
  for (const t of textures) {
    await yieldTask();
    if (!alive()) { set.release(); return null; }
    studio.upload(t);
  }
  await yieldTask();
  if (!alive()) { set.release(); return null; }
  studio.prepare(W, H);
  await yieldTask();
  if (!alive()) { set.release(); return null; }
  try {
    return await studio.shootAsync(flatShot(set, W, H));
  } finally {
    set.release();
  }
}
