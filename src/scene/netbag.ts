import * as THREE from 'three';
import type { Colourway } from '../theme';
import {
  catmull, superellipse, satinMaterial, pouchGeometry, pouchExtent,
} from './satin';

/* ============================================================================
 * The net bag — a knotted string market bag (a filet), held up by its handles.
 *
 * Physically simulated: every knot is a Verlet particle and every cord is a
 * tension-only constraint (cords can go slack, never push). The base of the
 * net is stitched to a rigid "load" — the satin pouch and whatever is inside —
 * which swings as a damped pendulum from the hand point. The net hangs between
 * the handles and the load and wraps whatever it is holding; take things out
 * and it relaxes.
 *
 * Load-local frame: base centre at the origin, +Y up, +Z faces the camera.
 * ========================================================================= */

const N = 32;              // knots around (even: a front half and a back half)
const ROWS = 22;           // knot rows, mouth (0) → base (ROWS-1)
const BASE_A = 0.205;      // base half-width
const BASE_B = 0.088;      // base half-depth
const BASE_N = 2.7;        // superellipse exponent at the base (flat bottom, round corners)
const CELL = 0.0268;       // cord length between knots (diamond side)
const SSEG = 9;            // free rope nodes per handle strand
const STRAND_RISE = 0.13;  // mouth → hand (short handles: it's held close)
const CORD_R = 0.0017;
const STRAND_R = 0.0016;
const KNOT_R = 0.003;
const BUNCH_HALF = 0.05;   // half-width of the gathered mouth along each handle

// cross-section scale from just under the mouth (row 1) down to the base
// a near-straight cone, like a filet held by its handles: the base is the
// widest point and the sides run straight up to the gathered mouth
const PROFILE = [0.32, 0.41, 0.5, 0.59, 0.68, 0.77, 0.86, 0.94, 1.0, 0.84];
const PIN_X = 0.016;       // the handles part a little at the top, round a loop

const SUBSTEPS = 2;
const ITER = 12;
const G_NET = 7.5;         // gravity on the net (slightly floaty, more elegant)
const G_PEND = 6.2;        // pendulum gravity → ~1.9 s period: an unhurried sway

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** pick id of the bag itself — distinct from the issue ids (Issue 01 is 'bag') */
export const NET_BAG_ID = '__netbag';

export interface NetCollider {
  /** load-local → collider-local */
  inv: THREE.Matrix4;
  /** collider-local → load-local */
  m: THREE.Matrix4;
  half: THREE.Vector3;
}

/* --------------------------------------------------------- twisted cord map */
function twistNormalMap(): THREE.DataTexture {
  const S = 64;
  const data = new Uint8Array(S * S * 4);
  // two plies twisted around the cord: helical ridges
  const h = (u: number, v: number) => Math.pow(Math.abs(Math.sin((u * 2 + v) * Math.PI)), 0.55);
  const e = 1 / S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const du = (h(u + e, v) - h(u - e, v)) / (2 * e);
      const dv = (h(u, v + e) - h(u, v - e)) / (2 * e);
      const k = 0.09;
      let nx = -du * k, ny = -dv * k, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * S + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Cord material; instanced variant scales the twist along each segment. */
function cordMaterial(color: string, twist: THREE.Texture, instanced: boolean) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.66,
    metalness: 0,
    normalMap: twist,
    normalScale: new THREE.Vector2(1, 1),
    envMapIntensity: 0.9,
  });
  if (instanced) {
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float aLen;\n' + sh.vertexShader;
      sh.vertexShader = sh.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n#ifdef USE_NORMALMAP\n  vNormalMapUv.y *= aLen * 150.0;\n#endif'
      );
    };
    m.customProgramCacheKey = () => 'cord-instanced';
  }
  return m;
}

/* ========================================================================== */
export class NetBag {
  root = new THREE.Group();
  /** rigid frame of the pouch + contents (world matrix written every frame) */
  load = new THREE.Group();
  colliders: NetCollider[] = [];
  reduceMotion = false;
  /** 0 … 1 — how open/emptied the bag is (relaxes the sway) */
  openAmt = 0;

  readonly handLocal = new THREE.Vector3();
  readonly loadMatrix = new THREE.Matrix4();
  private loadInv = new THREE.Matrix4();

  // ---- simulation state
  private count = 0;
  private pos!: Float32Array;
  private prev!: Float32Array;
  private invMass!: Float32Array;
  private restLocal!: Float32Array;
  private collide!: Uint8Array;
  private cA!: Int32Array;
  private cB!: Int32Array;
  private cL!: Float32Array;
  private pinLocal: THREE.Vector3[] = [];
  private pinIdx: number[] = [];
  private baseIdx: number[] = [];

  // ---- rendering
  private cords!: THREE.InstancedMesh;
  private knots!: THREE.InstancedMesh;
  private segA: number[] = [];       // render point indices
  private segB: number[] = [];
  private segR: number[] = [];
  private rpNode: number[] = [];     // render point → node
  private rpCord: number[] = [];     // -1 = on the node, else bundle cord index
  private rpStrand: number[] = [];   // strand id for bundle offsets (or -1)
  private rpOrder: number[] = [];    // index along the strand (for the twist)
  private rpPos!: Float32Array;
  private knotNodes: number[] = [];
  private strands: number[][] = [];  // node indices, from bunch → hand
  private cordMat: THREE.MeshStandardMaterial;
  private rimMat: THREE.MeshStandardMaterial;
  private pouchMat: THREE.MeshPhysicalMaterial;
  private baseMat: THREE.MeshStandardMaterial;
  private hit: THREE.Mesh;

  // ---- pendulum / hand
  private hand = new THREE.Vector3();
  private handRest = new THREE.Vector3();
  private handTarget = new THREE.Vector3();
  private handVel = new THREE.Vector3();
  private handPrevVel = new THREE.Vector3();
  private dragging = false;
  private dragOffset = new THREE.Vector3();
  private th1 = 0; private w1 = 0;   // swing about Z (sideways)
  private th2 = 0; private w2 = 0;   // swing about X (toward / away)
  private yaw = 0; private wy = 0;
  private pendL = 0.5;
  private parX = 0; private parY = 0;

  // scratch (no per-frame allocation in the hot paths)
  private sv = {
    up: new THREE.Vector3(0, 1, 0), a: new THREE.Vector3(), b: new THREE.Vector3(), mid: new THREE.Vector3(), d: new THREE.Vector3(),
  };
  private hPrev = 1 / 120;   // last Verlet step (time-corrected integration)
  private dtS = 1 / 60;      // smoothed frame step
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private ext: [number, number] = [0, 0];
  private q = new THREE.Quaternion();
  private m4 = new THREE.Matrix4();
  private s3 = new THREE.Vector3();

  constructor(cw: Colourway) {
    this.root.add(this.load);
    this.load.matrixAutoUpdate = false;

    const twist = twistNormalMap();
    this.cordMat = cordMaterial(cw.cord, twist, true);
    const twistRim = twist.clone();
    twistRim.repeat.set(10, 1);
    twistRim.needsUpdate = true;
    this.rimMat = cordMaterial(cw.cord, twistRim, false);
    this.pouchMat = satinMaterial(cw.pouch, cw.pouchSheen);

    this.buildTopology();
    this.buildMeshes();

    // satin pouch lining the bottom of the net
    this.baseMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(cw.pouch), roughness: 0.85, metalness: 0, envMapIntensity: 0.5 });
    const pouch = new THREE.Mesh(pouchGeometry(), [this.pouchMat, this.baseMat]);
    pouch.castShadow = true;
    pouch.receiveShadow = true;
    this.load.add(pouch);

    // the two handles meet over the top in a soft doubled loop, as if the bag
    // hangs from a finger or a hook
    for (const z of [0.0035, -0.0035]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = Math.PI * (i / 24);
        pts.push(new THREE.Vector3(Math.cos(a) * PIN_X, this.handLocal.y + Math.sin(a) * PIN_X * 1.2, z + Math.sin(a) * z * 0.6));
      }
      const loop = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.0022, 6, false), this.rimMat);
      loop.castShadow = true;
      this.load.add(loop);
    }


    // generous invisible pick volume (bag + handles)
    this.hit = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, this.handLocal.y + 0.04, 0.24),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.hit.position.y = this.handLocal.y / 2;
    this.hit.userData.id = NET_BAG_ID;
    this.load.add(this.hit);

    // positions only: every owner places the bag with setHandRest(), which settles it
    this.reset(false);
  }

  /* ------------------------------------------------------------- topology */
  private buildTopology() {
    const netCount = N * ROWS;
    const strandCount = 4 * SSEG;
    this.count = netCount + strandCount + 4;
    const rest = new Float32Array(this.count * 3);
    const set = (i: number, x: number, y: number, z: number) => { rest[i * 3] = x; rest[i * 3 + 1] = y; rest[i * 3 + 2] = z; };
    const get = (i: number) => new THREE.Vector3(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
    const net = (r: number, i: number) => r * N + (((i % N) + N) % N);

    // rows 1 … ROWS-1: cross-sections from the profile
    const xs: number[][] = [], zs: number[][] = [];
    for (let r = 1; r < ROWS; r++) {
      const v = (r - 1) / (ROWS - 2);
      const s = catmull(PROFILE, v);
      const n = 2.0 + (BASE_N - 2.0) * v * v;
      xs[r] = []; zs[r] = [];
      for (let i = 0; i < N; i++) {
        const th = (2 * Math.PI * (i + 0.5 * (r % 2))) / N;
        const [x, z] = superellipse(th, BASE_A * s, BASE_B * s, n);
        xs[r][i] = x; zs[r][i] = z;
      }
    }
    // heights, bottom-up: each diamond is fully extended (side = CELL), so
    // narrow rows stack tall and wide rows stack short — the real net look
    const ys: number[] = [];
    ys[ROWS - 1] = -0.008; // the base ring sits just under the pouch
    for (let r = ROWS - 2; r >= 1; r--) {
      let dh = 0;
      for (let i = 0; i < N; i++) {
        const j = r % 2 === 0 ? i - 1 : i + 1;
        const jj = ((j % N) + N) % N;
        dh += Math.hypot(xs[r][i] - xs[r + 1][jj], zs[r][i] - zs[r + 1][jj]);
      }
      dh /= N;
      ys[r] = ys[r + 1] + Math.sqrt(Math.max(CELL * CELL - dh * dh, (0.4 * CELL) ** 2));
    }
    for (let r = 1; r < ROWS; r++) for (let i = 0; i < N; i++) set(net(r, i), xs[r][i], ys[r], zs[r][i]);

    // mouth (row 0): front half gathered on the front handle, back half on the back
    const yM = ys[1] + CELL * 0.82;
    const H = N / 2;
    for (let i = 1; i < H; i++) {
      const t = (i - 1) / (H - 2);
      const s = Math.sin(Math.PI * t);
      set(net(0, i), BUNCH_HALF - 2 * BUNCH_HALF * t, yM - 0.006 * s, 0.017 + 0.007 * s);
    }
    for (let i = H + 1; i < N; i++) {
      const t = (i - H - 1) / (H - 2);
      const s = Math.sin(Math.PI * t);
      set(net(0, i), -BUNCH_HALF + 2 * BUNCH_HALF * t, yM - 0.006 * s, -0.017 - 0.007 * s);
    }
    set(net(0, 0), BUNCH_HALF + 0.022, yM - 0.02, 0);
    set(net(0, H), -BUNCH_HALF - 0.022, yM - 0.02, 0);

    // hand point + four strands (FR, FL, BL, BR)
    this.handLocal.set(0, yM + STRAND_RISE, 0);
    const pinOff = [
      new THREE.Vector3(PIN_X, 0, 0.0035), new THREE.Vector3(-PIN_X, 0, 0.0035),
      new THREE.Vector3(-PIN_X, 0, -0.0035), new THREE.Vector3(PIN_X, 0, -0.0035),
    ];
    const bunchEnd = [net(0, 1), net(0, H - 1), net(0, H + 1), net(0, N - 1)];
    const strandBase = netCount;
    const pinBase = netCount + strandCount;
    for (let k = 0; k < 4; k++) {
      const pin = pinBase + k;
      this.pinIdx.push(pin);
      const pl = this.handLocal.clone().add(pinOff[k]);
      this.pinLocal.push(pl);
      set(pin, pl.x, pl.y, pl.z);
      const a = get(bunchEnd[k]);
      const side = Math.sign(a.x) || 1;
      const list = [bunchEnd[k]];
      for (let j = 0; j < SSEG; j++) {
        const t = (j + 1) / (SSEG + 1);
        const p = a.clone().lerp(pl, t);
        p.x += side * 0.014 * Math.sin(Math.PI * t); // a gentle outward bow
        set(strandBase + k * SSEG + j, p.x, p.y, p.z);
        list.push(strandBase + k * SSEG + j);
      }
      list.push(pin);
      this.strands.push(list);
    }

    // ---- constraints
    const cA: number[] = [], cB: number[] = [], cL: number[] = [];
    const link = (a: number, b: number, slack = 0.992) => {
      cA.push(a); cB.push(b);
      cL.push(get(a).distanceTo(get(b)) * slack);
    };
    // diamond lattice
    for (let r = 0; r < ROWS - 1; r++) {
      for (let i = 0; i < N; i++) {
        link(net(r, i), net(r + 1, i));
        link(net(r, i), net(r + 1, r % 2 === 0 ? i - 1 : i + 1));
      }
    }
    // the mouth edge: loops threaded along each handle + the open sides
    for (let i = 1; i < H - 1; i++) link(net(0, i), net(0, i + 1), 0.98);
    for (let i = H + 1; i < N - 1; i++) link(net(0, i), net(0, i + 1), 0.98);
    link(net(0, 0), net(0, 1)); link(net(0, 0), net(0, N - 1));
    link(net(0, H), net(0, H - 1)); link(net(0, H), net(0, H + 1));
    // strands
    this.strands.forEach((list) => { for (let j = 0; j < list.length - 1; j++) link(list[j], list[j + 1], 0.995); });

    this.cA = Int32Array.from(cA);
    this.cB = Int32Array.from(cB);
    this.cL = Float32Array.from(cL);
    this.restLocal = rest;

    // ---- masses, collision flags
    this.invMass = new Float32Array(this.count).fill(1);
    this.collide = new Uint8Array(this.count);
    for (let r = 0; r < ROWS - 1; r++) for (let i = 0; i < N; i++) this.collide[net(r, i)] = 1;
    for (let i = 0; i < N; i++) { this.invMass[net(ROWS - 1, i)] = 0; this.baseIdx.push(net(ROWS - 1, i)); }
    this.pinIdx.forEach((p) => (this.invMass[p] = 0));
    // the gathered mouth loops are a touch heavier — they hang with weight
    for (let i = 0; i < N; i++) this.invMass[net(0, i)] = 0.75;

    this.pos = new Float32Array(this.count * 3);
    this.prev = new Float32Array(this.count * 3);

    // long-range attachments: every free knot may never be further from its
    // anchors than the cord path allows. Kills the rubbery stretch a
    // position-based solver otherwise shows under the net's own weight.
    this.buildTethers();

    // pendulum: pivot → centre of mass of the full bag
    this.pendL = this.handLocal.y - 0.12;

    // ---- render description
    // net links + mouth edge: plain cords between knots
    const rp = (node: number, cord = -1, strand = -1, order = 0) => {
      this.rpNode.push(node); this.rpCord.push(cord); this.rpStrand.push(strand); this.rpOrder.push(order);
      return this.rpNode.length - 1;
    };
    const nodeRP: number[] = [];
    for (let i = 0; i < netCount; i++) nodeRP[i] = rp(i);
    const netLinkCount = 2 * N * (ROWS - 1) + (H - 2) * 2 + 4;
    for (let c = 0; c < netLinkCount; c++) {
      this.segA.push(nodeRP[cA[c]]); this.segB.push(nodeRP[cB[c]]); this.segR.push(CORD_R);
    }
    // strands: two twisted cords each
    this.strands.forEach((list, k) => {
      for (let cord = 0; cord < 2; cord++) {
        let prevRP = -1;
        list.forEach((node, j) => {
          // the first node is the bunch knot itself — cords fan out from it
          const id = j === 0 ? nodeRP[node] : rp(node, cord, k, j);
          if (prevRP >= 0) { this.segA.push(prevRP); this.segB.push(id); this.segR.push(STRAND_R); }
          prevRP = id;
        });
      }
    });
    this.rpPos = new Float32Array(this.rpNode.length * 3);

    // knots: every net node above the base
    for (let r = 0; r < ROWS - 1; r++) for (let i = 0; i < N; i++) this.knotNodes.push(net(r, i));
  }

  private tTop!: Int32Array;     // node → anchor node (a hand pin)
  private tTopD!: Float32Array;  // geodesic rest distance to it
  private tBase!: Int32Array;    // node → nearest base knot
  private tBaseD!: Float32Array;

  /** Dijkstra over the cord graph from a set of source nodes. */
  private geodesic(sources: number[]): { dist: Float32Array; src: Int32Array } {
    const n = this.count;
    const adj: [number, number][][] = Array.from({ length: n }, () => []);
    for (let c = 0; c < this.cA.length; c++) {
      adj[this.cA[c]].push([this.cB[c], this.cL[c]]);
      adj[this.cB[c]].push([this.cA[c], this.cL[c]]);
    }
    const dist = new Float32Array(n).fill(Infinity);
    const src = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    // binary min-heap of (distance, node); stale entries are skipped
    const hd: number[] = [], hn: number[] = [];
    const push = (d: number, v: number) => {
      let i = hd.length;
      hd.push(d); hn.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hd[p] <= hd[i]) break;
        [hd[p], hd[i]] = [hd[i], hd[p]]; [hn[p], hn[i]] = [hn[i], hn[p]];
        i = p;
      }
    };
    const pop = () => {
      const v = hn[0];
      const ld = hd.pop()!, ln = hn.pop()!;
      if (hd.length) {
        hd[0] = ld; hn[0] = ln;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < hd.length && hd[l] < hd[m]) m = l;
          if (r < hd.length && hd[r] < hd[m]) m = r;
          if (m === i) break;
          [hd[m], hd[i]] = [hd[i], hd[m]]; [hn[m], hn[i]] = [hn[i], hn[m]];
          i = m;
        }
      }
      return v;
    };
    sources.forEach((s) => { dist[s] = 0; src[s] = s; push(0, s); });
    while (hd.length) {
      const u = pop();
      if (done[u]) continue;
      done[u] = 1;
      for (const [v, w] of adj[u]) {
        if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; src[v] = src[u]; push(dist[v], v); }
      }
    }
    return { dist, src };
  }

  private buildTethers() {
    const top = this.geodesic(this.pinIdx);
    const base = this.geodesic(this.baseIdx);
    this.tTop = top.src; this.tTopD = top.dist;
    this.tBase = base.src; this.tBaseD = base.dist;
  }

  private applyTethers() {
    const P = this.pos, IM = this.invMass;
    for (let i = 0; i < this.count; i++) {
      if (IM[i] === 0) continue;
      const k = i * 3;
      for (let pass = 0; pass < 2; pass++) {
        const a = (pass === 0 ? this.tTop[i] : this.tBase[i]) * 3;
        const D = pass === 0 ? this.tTopD[i] : this.tBaseD[i];
        if (a < 0 || !isFinite(D)) continue;
        const dx = P[k] - P[a], dy = P[k + 1] - P[a + 1], dz = P[k + 2] - P[a + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= D * D) continue;
        const s = D / Math.sqrt(d2);
        P[k] = P[a] + dx * s; P[k + 1] = P[a + 1] + dy * s; P[k + 2] = P[a + 2] + dz * s;
      }
    }
  }

  private buildMeshes() {
    const segCount = this.segA.length;
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const lens = new Float32Array(segCount);
    for (let s = 0; s < segCount; s++) {
      const a = this.rpNode[this.segA[s]], b = this.rpNode[this.segB[s]];
      const r = this.restLocal;
      lens[s] = Math.hypot(r[a * 3] - r[b * 3], r[a * 3 + 1] - r[b * 3 + 1], r[a * 3 + 2] - r[b * 3 + 2]);
    }
    cyl.setAttribute('aLen', new THREE.InstancedBufferAttribute(lens, 1));
    this.cords = new THREE.InstancedMesh(cyl, this.cordMat, segCount);
    this.cords.frustumCulled = false;
    this.cords.castShadow = true;
    this.cords.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.cords);

    const knotGeo = new THREE.IcosahedronGeometry(1, 1);
    this.knots = new THREE.InstancedMesh(knotGeo, this.cordMat, this.knotNodes.length);
    this.knots.frustumCulled = false;
    this.knots.castShadow = true;
    this.knots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // knots don't need the per-segment twist scale; give them a constant one
    knotGeo.setAttribute('aLen', new THREE.InstancedBufferAttribute(new Float32Array(this.knotNodes.length).fill(0.01), 1));
    this.root.add(this.knots);
  }

  /* -------------------------------------------------------------- public */
  hitTargets(): THREE.Object3D[] { return [this.hit]; }

  /** keepMaterials: a studio stand-in keeps its materials so their compiled
   *  shaders stay warm for the next shot */
  dispose(keepMaterials = false) {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    if (!keepMaterials) [this.cordMat, this.rimMat, this.pouchMat, this.baseMat].forEach((m) => m.dispose());
    this.cordMat.normalMap?.dispose();
    this.rimMat.normalMap?.dispose();
  }

  setColourway(cw: Colourway) {
    this.cordMat.color.set(cw.cord);
    this.rimMat.color.set(cw.cord);
    this.pouchMat.color.set(cw.pouch);
    this.baseMat.color.set(cw.pouch);
    this.pouchMat.sheenColor.set(cw.pouchSheen);
  }

  /** Place the hand point (world) and settle the net there. */
  setHandRest(p: THREE.Vector3, resettle = true) {
    this.handRest.copy(p);
    if (resettle) this.reset();
  }

  reset(settle = true) {
    this.th1 = this.th2 = this.w1 = this.w2 = this.yaw = this.wy = 0;
    this.hand.copy(this.handRest);
    this.handTarget.copy(this.handRest);
    this.handVel.set(0, 0, 0);
    this.handPrevVel.set(0, 0, 0);
    this.computeLoadMatrix();
    for (let i = 0; i < this.count; i++) {
      this.v.fromArray(this.restLocal, i * 3).applyMatrix4(this.loadMatrix);
      this.v.toArray(this.pos, i * 3);
      this.v.toArray(this.prev, i * 3);
    }
    // let the net find its drape before anyone sees it
    this.hPrev = 1 / 120;
    if (settle) for (let i = 0; i < 160; i++) this.simulate(1 / 120);
    this.syncVisuals();
  }

  /** pick the bag up at a world point */
  grab(p: THREE.Vector3) {
    this.dragging = true;
    this.dragOffset.copy(this.hand).sub(p);
  }
  drag(p: THREE.Vector3) {
    if (!this.dragging) return;
    this.handTarget.copy(p).add(this.dragOffset);
    // keep it on a leash around its rest point
    this.v.copy(this.handTarget).sub(this.handRest);
    this.v.z = clamp(this.v.z, -0.1, 0.12);
    const l = this.v.length();
    if (l > 0.32) this.v.multiplyScalar(0.32 / l);
    this.handTarget.copy(this.handRest).add(this.v);
  }
  release() { this.dragging = false; }
  /** how far above its resting point the hand currently is (entrance drop) */
  lift() { return this.hand.y - this.handRest.y; }
  isDragging() { return this.dragging; }

  /** an impulse — sideways swing (x), toward/away (z), spin (yaw) */
  nudge(x: number, z: number, spin = 0) { this.w1 += x; this.w2 += z; this.wy += spin; }

  parallax(px: number, py: number) { this.parX = px; this.parY = py; }

  /* ------------------------------------------------------------- physics */
  private computeLoadMatrix() {
    // M = T(hand) · Rz(th1) · Rx(th2) · Ry(yaw) · T(-handLocal)
    const m = this.loadMatrix;
    m.makeTranslation(this.hand.x, this.hand.y, this.hand.z);
    m.multiply(this.m4.makeRotationZ(this.th1));
    m.multiply(this.m4.makeRotationX(this.th2));
    m.multiply(this.m4.makeRotationY(this.yaw));
    m.multiply(this.m4.makeTranslation(-this.handLocal.x, -this.handLocal.y, -this.handLocal.z));
    this.loadInv.copy(m).invert();
    this.load.matrix.copy(m);
    this.load.matrixWorldNeedsUpdate = true;
  }

  update(dt: number, t: number) {
    // a steadied step: frame times jitter, the cloth shouldn't
    this.dtS += (Math.min(dt, 1 / 30) - this.dtS) * 0.2;
    dt = this.dtS;
    const calm = this.reduceMotion ? 0.15 : 1;

    // --- the hand: rest + a breath of idle drift, or wherever it's dragged
    if (!this.dragging) {
      this.handTarget.copy(this.handRest);
      this.handTarget.x += calm * (Math.sin(t * 0.61) * 0.006 + Math.sin(t * 1.37 + 1.2) * 0.002);
      this.handTarget.y += calm * Math.sin(t * 0.83 + 0.4) * 0.004;
      this.handTarget.z += calm * Math.sin(t * 0.47 + 2.1) * 0.004;
    }
    const prevHand = this.v2.copy(this.hand);
    const follow = 1 - Math.exp(-dt * (this.dragging ? 16 : 5));
    this.hand.lerp(this.handTarget, follow);
    this.handPrevVel.copy(this.handVel);
    this.handVel.copy(this.hand).sub(prevHand).divideScalar(Math.max(dt, 1e-4));
    const ax = clamp((this.handVel.x - this.handPrevVel.x) / Math.max(dt, 1e-4), -40, 40);
    const az = clamp((this.handVel.z - this.handPrevVel.z) / Math.max(dt, 1e-4), -40, 40);

    // --- pendulum (two swing axes) + yaw
    const L = this.pendL;
    const damp = 1.05 + this.openAmt * 0.6;
    const yawRest = calm * (Math.sin(t * 0.19) * 0.22 + Math.sin(t * 0.07 + 2) * 0.1) - this.parX * 0.35;
    const steps = 3, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a1 = -(G_PEND / L) * Math.sin(this.th1) - damp * this.w1 - (ax / L) * Math.cos(this.th1);
      const a2 = -(G_PEND / L) * Math.sin(this.th2) - damp * this.w2 + (az / L) * Math.cos(this.th2) + this.parY * 0.4;
      this.w1 += a1 * h; this.w2 += a2 * h;
      this.th1 = clamp(this.th1 + this.w1 * h, -0.7, 0.7);
      this.th2 = clamp(this.th2 + this.w2 * h, -0.5, 0.5);
      this.wy += (-5.5 * (this.yaw - yawRest) - 2.2 * this.wy) * h;
      this.wy = clamp(this.wy, -5, 5);
      this.yaw += this.wy * h;
    }
    this.computeLoadMatrix();

    // --- the net
    const sub = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.simulate(sub);
    this.syncVisuals();
  }

  private simulate(h: number) {
    const P = this.pos, Q = this.prev, IM = this.invMass;
    // time-corrected Verlet: the carried velocity is rescaled by h / h_prev.
    // Plain Verlet assumes a constant step; with real frame times (which wobble
    // by milliseconds) it injected a jerk every frame and the net shimmered.
    const ratio = h / this.hPrev;
    const damping = 0.988 * ratio;
    const gy = -G_NET * h * (h + this.hPrev) * 0.5;
    this.hPrev = h;

    // integrate free nodes
    for (let i = 0; i < this.count; i++) {
      if (IM[i] === 0) continue;
      const k = i * 3;
      const x = P[k], y = P[k + 1], z = P[k + 2];
      P[k] += (x - Q[k]) * damping;
      P[k + 1] += (y - Q[k + 1]) * damping + gy;
      P[k + 2] += (z - Q[k + 2]) * damping;
      Q[k] = x; Q[k + 1] = y; Q[k + 2] = z;
    }
    // kinematic nodes: the base rides the load; the strands meet the hand
    const M = this.loadMatrix;
    for (const i of this.baseIdx) {
      this.v.fromArray(this.restLocal, i * 3).applyMatrix4(M);
      this.v.toArray(P, i * 3); this.v.toArray(Q, i * 3);
    }
    for (let k = 0; k < 4; k++) {
      this.v.copy(this.pinLocal[k]).applyMatrix4(M);
      this.v.toArray(P, this.pinIdx[k] * 3); this.v.toArray(Q, this.pinIdx[k] * 3);
    }

    // relax cords (tension only) with collisions interleaved
    const A = this.cA, B = this.cB, L = this.cL, nC = A.length;
    for (let it = 0; it < ITER; it++) {
      for (let c = 0; c < nC; c++) {
        const a = A[c] * 3, b = B[c] * 3;
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const r = L[c];
        if (d2 <= r * r) continue;
        const wa = IM[A[c]], wb = IM[B[c]];
        const w = wa + wb;
        if (w === 0) continue;
        const d = Math.sqrt(d2);
        const f = (d - r) / (d * w);
        P[a] += dx * f * wa; P[a + 1] += dy * f * wa; P[a + 2] += dz * f * wa;
        P[b] -= dx * f * wb; P[b + 1] -= dy * f * wb; P[b + 2] -= dz * f * wb;
      }
      if (it % 4 === 3) { this.applyTethers(); this.collideAll(); }
    }
  }

  private collideAll() {
    const P = this.pos;
    const Mi = this.loadInv, M = this.loadMatrix;
    const p = this.v, c = this.s3;
    const cols = this.colliders;
    const ext = this.ext;
    const margin = CORD_R + 0.0016;
    for (let i = 0; i < this.count; i++) {
      if (!this.collide[i] || this.invMass[i] === 0) continue;
      const k = i * 3;
      p.set(P[k], P[k + 1], P[k + 2]).applyMatrix4(Mi);
      let moved = false;
      // satin pouch: push radially out of its (superellipse) cross-section
      if (pouchExtent(p.y, ext)) {
        const a = ext[0] + margin, b = ext[1] + margin;
        const q = Math.pow(Math.pow(Math.abs(p.x) / a, 2.4) + Math.pow(Math.abs(p.z) / b, 2.4), 1 / 2.4);
        if (q < 1 && q > 1e-5) { p.x /= q; p.z /= q; moved = true; }
      }
      // contents (magazines, props): oriented boxes, push out the shallow way
      for (let j = 0; j < cols.length; j++) {
        const col = cols[j];
        c.copy(p).applyMatrix4(col.inv);
        // magazines are soft-cornered: taper the top of the stack, so the net
        // drapes over it instead of tenting on two sharp corners
        const top = clamp((c.y - (col.half.y - 0.05)) / 0.05, 0, 1);
        const hx = col.half.x + margin - 0.016 * top * top, hy = col.half.y + margin, hz = col.half.z + margin;
        const ox = hx - Math.abs(c.x), oy = hy - Math.abs(c.y), oz = hz - Math.abs(c.z);
        if (ox <= 0 || oy <= 0 || oz <= 0) continue;
        if (oz <= ox && oz <= oy) c.z = Math.sign(c.z || 1) * hz;
        else if (ox <= oy) c.x = Math.sign(c.x || 1) * hx;
        else c.y = Math.sign(c.y || 1) * hy;
        p.copy(c).applyMatrix4(col.m);
        moved = true;
      }
      if (moved) {
        p.applyMatrix4(M);
        P[k] = p.x; P[k + 1] = p.y; P[k + 2] = p.z;
      }
    }
  }

  /* ------------------------------------------------------------- visuals */
  private syncVisuals() {
    const P = this.pos, RP = this.rpPos;
    // render points: knots sit on their node; strand cords twist round it
    const dir = this.v, p1 = this.v2, p2 = this.s3;
    for (let r = 0; r < this.rpNode.length; r++) {
      const n = this.rpNode[r];
      let x = P[n * 3], y = P[n * 3 + 1], z = P[n * 3 + 2];
      const cord = this.rpCord[r];
      if (cord >= 0) {
        const list = this.strands[this.rpStrand[r]];
        const j = this.rpOrder[r];
        const a = list[Math.max(0, j - 1)], b = list[Math.min(list.length - 1, j + 1)];
        dir.set(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]).normalize();
        p1.set(0, 0, 1).cross(dir);
        if (p1.lengthSq() < 1e-6) p1.set(1, 0, 0);
        p1.normalize();
        p2.copy(dir).cross(p1);
        // fan in from the knot, twist along the strand, gather at the hand
        const fan = Math.min(1, j / 2) * (j >= list.length - 1 ? 0.35 : 1);
        const ang = cord * Math.PI + j * 0.95;
        const rr = 0.0019 * fan;
        x += (Math.cos(ang) * p1.x + Math.sin(ang) * p2.x) * rr;
        y += (Math.cos(ang) * p1.y + Math.sin(ang) * p2.y) * rr;
        z += (Math.cos(ang) * p1.z + Math.sin(ang) * p2.z) * rr;
      }
      RP[r * 3] = x; RP[r * 3 + 1] = y; RP[r * 3 + 2] = z;
    }

    const { up, a, b, mid, d } = this.sv;
    for (let s = 0; s < this.segA.length; s++) {
      a.fromArray(RP, this.segA[s] * 3);
      b.fromArray(RP, this.segB[s] * 3);
      d.subVectors(b, a);
      const len = d.length();
      mid.addVectors(a, b).multiplyScalar(0.5);
      if (len > 1e-6) this.q.setFromUnitVectors(up, d.divideScalar(len));
      const r = this.segR[s];
      this.m4.compose(mid, this.q, this.s3.set(r, len + r * 0.6, r));
      this.cords.setMatrixAt(s, this.m4);
    }
    this.cords.instanceMatrix.needsUpdate = true;

    this.q.identity();
    for (let k = 0; k < this.knotNodes.length; k++) {
      const n = this.knotNodes[k];
      mid.fromArray(P, n * 3);
      this.m4.compose(mid, this.q, this.s3.set(KNOT_R, KNOT_R * 0.92, KNOT_R));
      this.knots.setMatrixAt(k, this.m4);
    }
    this.knots.instanceMatrix.needsUpdate = true;
  }
}
