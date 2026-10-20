import * as THREE from 'three';
import { ISSUES, IssueId, PropId, PROP_COPY } from '../config';
import type { Colourway } from '../theme';
import { buildMagazine, MagazineMesh, MAG_W, MAG_H } from './magazineModel';
import { MAG_IN_BAG, MAG_BEND_IN_BAG, PROP_IN_BAG, stackCollider } from './bagLayout';
import { lipstick, card, boardingPassTexture, businessCardTexture } from './props';
import type { NetBag } from './netbag';

export type ItemId = IssueId | PropId;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export type LayoutMode = 'wide' | 'tall' | 'narrow';
/** wide: bag left, magazines in a row · tall: bag above a row · narrow: bag above a 2×2 grid */
export function layoutMode(aspect: number): LayoutMode {
  return aspect >= 1.1 ? 'wide' : aspect >= 0.62 ? 'tall' : 'narrow';
}
const easeIO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

interface Pose { p: THREE.Vector3; q: THREE.Quaternion; s: number; }

export interface Item {
  id: ItemId;
  kind: 'mag' | 'prop';
  index: number;
  label: string;
  group: THREE.Group;
  local: THREE.Matrix4;
  open: Pose;
  delay: number;
  lin: number;      // linear progress 0 … 1
  u: number;        // eased
  hover: number;
  sel: number;
  dim: number;
  hit: THREE.Mesh;
  mag?: MagazineMesh;
  inBagScale: number;
  spin: number;
  spinT: number;
}

/**
 * Everything that's in the bag: four magazines (the issues) and three props.
 * In the bag they ride the swinging load; on open they lift out in a staggered
 * arc and fan out in front; a picked magazine flies up to the camera.
 */
export class Contents {
  root = new THREE.Group();
  items: Item[] = [];
  private picks: THREE.Object3D[] = [];
  /** a prop being shown off (its caption is open) */
  focusId: string | null = null;
  /** pointer offset from centre (-0.5 … 0.5), eased by the app */
  lean = new THREE.Vector2();
  private lastPresent: Pose | null = null;
  private clock = 0;          // 0 (all in bag) … 1 (all out)
  private clockTarget = 0;
  private propTex: THREE.Texture[] = [];
  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();

  constructor(private cw: Colourway) {
    // ---- magazines
    ISSUES.forEach((it, i) => {
      const mag = buildMagazine();
      const g = new THREE.Group();
      g.add(mag.group);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(MAG_W * 1.06, MAG_H * 1.04, 0.03), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.id = it.id;
      g.add(hit);
      this.root.add(g);
      this.picks.push(hit);
      mag.bend.value = MAG_BEND_IN_BAG[i];
      this.items.push({
        id: it.id, kind: 'mag', index: i, label: `No. ${it.no}<br>${it.navLabel}`,
        group: g, local: MAG_IN_BAG[i],
        open: { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: 1 },
        delay: i * 0.085, lin: 0, u: 0, hover: 0, sel: 0, dim: 0, hit, mag, inBagScale: 1,
        spin: (i % 2 ? -1 : 1) * (0.35 + i * 0.08), spinT: 0,
      });
    });

    // ---- props
    const accent = cw.css['--accent'];
    const lip = lipstick(cw.id === 'bordeaux' ? '#8c1834' : '#7a2a2c');
    this.addProp('lipstick', lip, new THREE.CylinderGeometry(0.02, 0.02, 0.085, 10), [0, 0.04, 0], 4, 0.34);
    const passTex = boardingPassTexture(accent, '#151011');
    const pass = card(0.15, 0.06, passTex);
    this.propTex.push(passTex);
    this.addProp('pass', pass, new THREE.BoxGeometry(0.16, 0.07, 0.02), [0, 0, 0], 5, 0.42);
    const cardTex = businessCardTexture(accent, '#151011');
    const bc = card(0.085, 0.055, cardTex);
    this.propTex.push(cardTex);
    this.addProp('card', bc, new THREE.BoxGeometry(0.095, 0.065, 0.02), [0, 0, 0], 6, 0.5);
  }

  private addProp(id: PropId, obj: THREE.Object3D, hitGeo: THREE.BufferGeometry, hitOff: [number, number, number], index: number, delay: number) {
    const g = new THREE.Group();
    g.add(obj);
    const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(...hitOff);
    hit.userData.id = id;
    g.add(hit);
    this.root.add(g);
    this.picks.push(hit);
    this.items.push({
      id, kind: 'prop', index, label: PROP_COPY[id].label,
      group: g, local: PROP_IN_BAG[id],
      open: { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: 1 },
      delay, lin: 0, u: 0, hover: 0, sel: 0, dim: 0, hit, inBagScale: 1,
      spin: index % 2 ? 0.9 : -0.8, spinT: 0,
    });
  }

  setCovers(covers: { cover: THREE.Texture; back: THREE.Texture; spine: THREE.Texture }[]) {
    this.items.forEach((it) => {
      if (it.mag) {
        const c = covers[it.index];
        it.mag.setTextures(c.cover, c.back, c.spine);
      }
    });
  }

  /** restyle the props for a colourway (printed accents, lipstick shade) */
  setColourway(cw: Colourway) {
    this.cw = cw;
    const accent = cw.css['--accent'];
    const pass = this.item('pass')!, bc = this.item('card')!, lip = this.item('lipstick')!;
    const swap = (it: Item, tex: THREE.Texture) => {
      it.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material[] | undefined;
        if (Array.isArray(m) && m[4] && (m[4] as THREE.MeshStandardMaterial).map) {
          const face = m[4] as THREE.MeshStandardMaterial;
          const old = face.map!;
          face.map = tex;
          face.needsUpdate = true;
          this.propTex = this.propTex.filter((t) => t !== old);
          old.dispose();
        }
      });
      this.propTex.push(tex);
    };
    swap(pass, boardingPassTexture(accent, '#151011'));
    swap(bc, businessCardTexture(accent, '#151011'));
    const bullet = new THREE.Color(cw.id === 'bordeaux' ? '#8c1834' : '#7a2a2c');
    lip.group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
      if (mat && (mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial && mat.sheen > 0) {
        mat.color.copy(bullet);
        mat.sheenColor.copy(bullet).multiplyScalar(1.6);
      }
    });
  }

  pickTargets() { return this.picks; }
  item(id: string) { return this.items.find((i) => i.id === id); }

  /** open (1) / put everything back (0) */
  setOpen(open: boolean) { this.clockTarget = open ? 1 : 0; }
  isOut() { return this.clock > 0.98; }
  isIn() { return this.clock < 0.02; }
  progress() { return this.clock; }

  /** open-state layout around the bag (see layoutMode) */
  layout(aspect: number) {
    const mode = layoutMode(aspect);
    const mags = this.items.filter((i) => i.kind === 'mag');
    mags.forEach((it, i) => {
      if (mode === 'wide') {
        const x = -0.08 + i * 0.232;
        it.open.p.set(x, 0.31 + (i % 2 ? 0.012 : -0.008), 0.07 - Math.abs(i - 1.5) * 0.012);
        it.open.q.setFromEuler(new THREE.Euler(-0.02, -0.05 - (x - 0.25) * 0.14, (i % 2 ? 0.022 : -0.018)));
      } else if (mode === 'tall') {
        const x = (i - 1.5) * 0.235;
        it.open.p.set(x, 0.06 + (i % 2 ? 0.01 : -0.008), 0.1);
        it.open.q.setFromEuler(new THREE.Euler(-0.02, -x * 0.12, (i % 2 ? 0.02 : -0.018)));
      } else {
        const col = i % 2, row = Math.floor(i / 2);
        it.open.p.set((col - 0.5) * 0.235, 0.2 - row * 0.39, 0.14);
        it.open.q.setFromEuler(new THREE.Euler(0, (col - 0.5) * -0.12, (col ? 0.018 : -0.02)));
      }
      it.open.s = 1;
    });
    const P: Record<LayoutMode, Record<PropId, [[number, number, number], [number, number, number], number]>> = {
      wide: {
        lipstick: [[-0.585, 0.025, 0.27], [0.1, 0.4, -0.16], 1.5],
        pass: [[-0.44, 0.04, 0.3], [-0.3, -0.22, 0.09], 1.1],
        card: [[-0.275, 0.055, 0.28], [-0.28, 0.3, -0.13], 1.3],
      },
      tall: {
        lipstick: [[-0.33, 0.36, 0.14], [0.1, 0.4, -0.16], 1.35],
        pass: [[0.31, 0.52, 0.1], [-0.25, -0.3, 0.12], 0.95],
        card: [[0.33, 0.35, 0.13], [-0.25, 0.3, -0.14], 1.1],
      },
      narrow: {
        lipstick: [[-0.25, 0.47, 0.16], [0.1, 0.4, -0.16], 1.15],
        pass: [[0.23, 0.6, 0.12], [-0.25, -0.3, 0.12], 0.78],
        card: [[0.24, 0.44, 0.15], [-0.25, 0.3, -0.14], 0.95],
      },
    };
    (Object.keys(P[mode]) as PropId[]).forEach((id) => {
      const it = this.item(id)!;
      const [p, e, sc] = P[mode][id];
      it.open.p.set(...p);
      it.open.q.setFromEuler(new THREE.Euler(...e));
      it.open.s = sc;
    });
  }

  /** Pose for a magazine presented to the camera (matches the reader's closed book). */
  static presentPose(camera: THREE.PerspectiveCamera, dist: number, pageH: number, out: Pose) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    out.p.copy(camera.position).addScaledVector(fwd, dist);
    out.q.copy(camera.quaternion);
    out.s = pageH / MAG_H;
    return out;
  }

  /** collider for the net: only magazines still (mostly) in the bag */
  colliders() {
    const inside = this.items.filter((i) => i.kind === 'mag' && i.lin < 0.04).map((i) => i.local);
    const c = stackCollider(inside);
    return c ? [c] : [];
  }

  update(
    dt: number, t: number, bag: NetBag, camera: THREE.PerspectiveCamera,
    hoverId: string | null, selectedId: string | null, present: Pose | null,
  ) {
    if (present) {
      if (!this.lastPresent) this.lastPresent = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: 1 };
      this.lastPresent.p.copy(present.p); this.lastPresent.q.copy(present.q); this.lastPresent.s = present.s;
    }
    // advance the shared clock; items stagger off it
    const speed = this.clockTarget > this.clock ? 0.72 : 0.95;
    this.clock += Math.sign(this.clockTarget - this.clock) * Math.min(Math.abs(this.clockTarget - this.clock), dt * speed);
    const L = bag.loadMatrix;
    const span = 0.55;

    const from = new THREE.Vector3(), fromQ = new THREE.Quaternion(), fromS = new THREE.Vector3();
    const ctrl = new THREE.Vector3();
    const mouth = new THREE.Vector3(0, 0.46, 0).applyMatrix4(L);

    this.items.forEach((it) => {
      const lin = clamp01((this.clock * (1 + span) - it.delay) / 1);
      it.lin = lin;
      const u = easeIO(lin);
      it.u = u;

      // in-bag pose (rides the swinging load)
      this.tmpM.multiplyMatrices(L, it.local);
      this.tmpM.decompose(from, fromQ, fromS);

      const g = it.group;
      if (u <= 0.0001) {
        g.position.copy(from); g.quaternion.copy(fromQ); g.scale.setScalar(it.inBagScale);
      } else {
        // up out of the mouth, then across to the open pose
        ctrl.set(
          mouth.x + (it.open.p.x - mouth.x) * 0.25,
          Math.max(mouth.y, it.open.p.y) + 0.22,
          (mouth.z + it.open.p.z) * 0.5 + 0.12,
        );
        const a = 1 - u;
        g.position.set(
          a * a * from.x + 2 * a * u * ctrl.x + u * u * it.open.p.x,
          a * a * from.y + 2 * a * u * ctrl.y + u * u * it.open.p.y,
          a * a * from.z + 2 * a * u * ctrl.z + u * u * it.open.p.z,
        );
        g.quaternion.slerpQuaternions(fromQ, it.open.q, u);
        // a little extra turn in flight — lively, not robotic
        g.rotateY(Math.sin(u * Math.PI) * it.spin);
        g.scale.setScalar(it.inBagScale + (it.open.s - it.inBagScale) * u);
      }

      // idle drift once out
      const isSel = selectedId === it.id;
      const someSel = !!selectedId;
      const focused = this.focusId === it.id;
      const wantHover = (hoverId === it.id && !someSel) || focused ? 1 : 0;
      it.hover += (wantHover - it.hover) * Math.min(1, dt * 10);
      if (u > 0.98) {
        g.position.y += Math.sin(t * 0.8 + it.index * 1.7) * 0.004;
        g.rotateZ(Math.sin(t * 0.6 + it.index * 2.3) * 0.006);
        // the whole fan leans a little toward the cursor
        g.rotateY(this.lean.x * 0.16);
        g.rotateX(this.lean.y * 0.1);
        // hover: lift toward the camera and turn to face it
        this.tmpV.copy(camera.position).sub(g.position).normalize();
        g.position.addScaledVector(this.tmpV, it.hover * 0.06);
        g.position.y += it.hover * 0.012;
        g.rotateX(-it.hover * 0.04);
        // a prop you've picked up turns slowly in the light
        it.spinT = focused ? it.spinT + dt * 0.9 : it.spinT * Math.max(0, 1 - dt * 4);
        if (it.kind === 'prop') { g.position.addScaledVector(this.tmpV, it.hover * 0.05); g.rotateY(Math.sin(it.spinT) * 0.6); }
      }
      if (it.mag) {
        const inBag = MAG_BEND_IN_BAG[it.index];
        const openBend = 0.1 + it.hover * 0.55;
        it.mag.bend.value = inBag + (openBend - inBag) * u + Math.sin(u * Math.PI) * 0.9;
      }

      // selection: fly to the camera; everything else steps back
      it.sel += ((isSel ? 1 : 0) - it.sel) * Math.min(1, dt * (isSel ? 4.2 : 6));
      it.dim += ((someSel && !isSel ? 1 : 0) - it.dim) * Math.min(1, dt * 5);
      // (after the reader closes the pose is gone — fly back from where it was)
      const pose = present ?? this.lastPresent;
      if (it.sel > 0.001 && pose) {
        const s = easeIO(Math.min(1, it.sel));
        g.position.lerp(pose.p, s);
        g.quaternion.slerp(pose.q, s);
        g.scale.setScalar(g.scale.x + (pose.s - g.scale.x) * s);
        if (it.mag) it.mag.bend.value *= 1 - s;
      }
      if (it.dim > 0.001) {
        // the others sink out of frame while one is being read
        const d = easeIO(it.dim);
        g.position.y -= d * 0.95;
        g.position.z -= d * 0.35;
        g.rotateX(d * 0.5);
      }
    });
  }

  /** screen anchors under each fanned magazine, for the DOM issue tags */
  tagAnchors(camera: THREE.PerspectiveCamera, w: number, h: number, hoverId: string | null) {
    return this.items.filter((i) => i.kind === 'mag').map((it) => {
      const v = this.tmpV.set(0, -MAG_H / 2 - 0.018, 0);
      it.group.updateMatrixWorld();
      v.applyMatrix4(it.group.matrixWorld).project(camera);
      return {
        id: it.id as IssueId,
        x: (v.x * 0.5 + 0.5) * w,
        y: (-v.y * 0.5 + 0.5) * h,
        visible: it.u > 0.96 && it.dim < 0.05 && it.sel < 0.05,
        hover: hoverId === it.id,
      };
    });
  }

  /** hide/show a magazine (used when the reader takes over) */
  setVisible(id: string, v: boolean) {
    const it = this.item(id);
    if (it) it.group.visible = v;
  }

  dispose() {
    this.propTex.forEach((t) => t.dispose());
    this.items.forEach((it) => it.mag?.dispose());
  }
}
