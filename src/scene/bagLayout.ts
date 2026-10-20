import * as THREE from 'three';
import { MAG_W, MAG_H, MAG_T } from './magazineModel';
import type { NetCollider } from './netbag';

/* Where everything sits inside the bag (load-local: base centre at origin,
 * +Z toward the viewer). Magazines stand in the satin pouch, fanned a little;
 * the props are tucked in around them. */

const m4 = (p: [number, number, number], e: [number, number, number]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...e)), new THREE.Vector3(1, 1, 1));

/** issue order 01 … 04 (01 is the one at the front) */
export const MAG_IN_BAG: THREE.Matrix4[] = [
  m4([-0.01, 0.006 + MAG_H / 2, 0.031], [-0.075, 0.06, -0.025]),
  m4([0.02, 0.014 + MAG_H / 2, 0.011], [-0.03, -0.14, 0.042]),
  m4([-0.022, 0.009 + MAG_H / 2, -0.009], [0.02, 0.16, -0.048]),
  m4([0.012, 0.018 + MAG_H / 2, -0.03], [0.05, -0.06, 0.03]),
];

/** natural bend of each magazine while it's in the bag */
export const MAG_BEND_IN_BAG = [0.75, -0.55, 0.9, -0.45];

/** props: lipstick (base at y=0), boarding pass, business card */
export const PROP_IN_BAG: Record<'lipstick' | 'pass' | 'card', THREE.Matrix4> = {
  lipstick: m4([0.128, 0.03, 0.03], [0.1, 0.3, -0.42]),
  pass: m4([0.058, 0.168, -0.016], [0.06, -0.3, 0.32]),
  card: m4([-0.088, 0.158, 0.02], [-0.05, 0.25, -0.26]),
};

/** Axis-aligned (load-local) collider around the magazines still in the bag. */
export function stackCollider(mats: THREE.Matrix4[], grow = 1): NetCollider | null {
  if (!mats.length) return null;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const m of mats) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      box.expandByPoint(v.set((sx * MAG_W) / 2, (sy * MAG_H) / 2, (sz * MAG_T) / 2).applyMatrix4(m));
    }
  }
  const c = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5 * grow);
  // grow from the bottom: when shrinking, the top of the stack comes down
  c.y = box.min.y + half.y;
  return {
    m: new THREE.Matrix4().makeTranslation(c.x, c.y, c.z),
    inv: new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z),
    half,
  };
}
