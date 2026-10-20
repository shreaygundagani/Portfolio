import * as THREE from 'three';

/* ---------------------------------------------------------------- helpers */
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 1-D Catmull-Rom through evenly spaced control values, u in [0,1]. */
export function catmull(vals: number[], u: number) {
  const n = vals.length - 1;
  const f = clamp(u, 0, 1) * n;
  const i = Math.min(Math.floor(f), n - 1);
  const t = f - i;
  const p0 = vals[Math.max(0, i - 1)], p1 = vals[i], p2 = vals[i + 1], p3 = vals[Math.min(n, i + 2)];
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Seeded PRNG so the fabric folds are identical on every load. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** superellipse point for angle th, half-axes a/b, exponent n */
export function superellipse(th: number, a: number, b: number, n: number): [number, number] {
  const c = Math.cos(th), s = Math.sin(th);
  const p = 2 / n;
  return [Math.sign(c) * Math.pow(Math.abs(c), p) * a, Math.sign(s) * Math.pow(Math.abs(s), p) * b];
}

/* --------------------------------------------------------------- material */
/**
 * Satin: a low-roughness dielectric with a strong anisotropic lobe (the long
 * streak highlights that make satin read as satin) and a cloth sheen at
 * grazing angles.
 */
export function satinMaterial(color: string, sheen: string, rotation = Math.PI / 2, matte = 0) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: 0.26 + matte * 0.22,
    metalness: 0,
    anisotropy: 0.8 - matte * 0.3,
    anisotropyRotation: rotation,
    sheen: 1,
    sheenRoughness: 0.3 + matte * 0.14,
    sheenColor: new THREE.Color(sheen),
    specularIntensity: 1 - matte * 0.4,
    envMapIntensity: 1.45 - matte * 0.5,
    side: THREE.DoubleSide,
  });
}

/* ------------------------------------------------------------------ pouch */
/**
 * The satin drawstring pouch that lines the bottom of the net (load-local,
 * base centre at the origin). Profile keys run bottom → top; the drawstring
 * gathers the satin into pleats, then a short frill flares above it.
 */
// evenly spaced keys (v = 0 … 1), interpolated with Catmull-Rom so the
// profile is C1-smooth — no flat steps, no banding in the highlights
const PY = [0.0, 0.026, 0.07, 0.114, 0.154, 0.186, 0.206, 0.222];
const PA = [0.172, 0.2, 0.193, 0.174, 0.148, 0.124, 0.112, 0.122];
const PB = [0.072, 0.086, 0.083, 0.077, 0.066, 0.057, 0.052, 0.058];
const keyAt = (keys: number[], v: number) => catmull(keys, v);

export const POUCH_TOP = PY[PY.length - 1];

// half-axes of the pouch by height, tabulated once: the net asks for them
// thousands of times a frame (it used to bisect the profile every time)
const EXT_N = 512, EXT_Y0 = -0.01, EXT_Y1 = POUCH_TOP + 0.004;
const extA = new Float32Array(EXT_N + 1), extB = new Float32Array(EXT_N + 1);
for (let k = 0; k <= EXT_N; k++) {
  const y = EXT_Y0 + ((EXT_Y1 - EXT_Y0) * k) / EXT_N;
  // invert y → v by bisection (the height profile is monotonic)
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (keyAt(PY, mid) < y) lo = mid; else hi = mid;
  }
  const v = (lo + hi) / 2;
  extA[k] = keyAt(PA, v) + 0.006;
  extB[k] = keyAt(PB, v) + 0.006;
}

/** Half-axes of the pouch at height y (for the net's collision), written into
 *  `out`; false above or below the pouch. */
export function pouchExtent(y: number, out: [number, number]): boolean {
  if (y < EXT_Y0 || y > EXT_Y1) return false;
  const f = ((y - EXT_Y0) / (EXT_Y1 - EXT_Y0)) * EXT_N;
  const i = Math.min(EXT_N - 1, Math.floor(f)), t = f - i;
  out[0] = extA[i] + (extA[i + 1] - extA[i]) * t;
  out[1] = extB[i] + (extB[i + 1] - extB[i]) * t;
  return true;
}

export function pouchGeometry(): THREE.BufferGeometry {
  const NT = 128, NV = 56;
  const r = rng(7);
  // per-pleat random phase so the gathers are irregular
  const pleatJit = Array.from({ length: 64 }, () => r());
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];

  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    const y = keyAt(PY, v);
    const a = keyAt(PA, v), b = keyAt(PB, v);
    const n = 2.0 + 0.9 * (1 - smooth(0.0, 0.7, v));
    // fold amplitudes
    const broad = 0.0068 * Math.sin(Math.PI * clamp(v / 0.75, 0, 1));
    const gather = 0.0085 * smooth(0.6, 0.86, v) * (1 - 0.35 * smooth(0.9, 1, v));
    const frill = 0.0042 * smooth(0.88, 1.0, v);
    for (let i = 0; i <= NT; i++) {
      const u = i / NT;
      const th = u * Math.PI * 2;
      let [x, z] = superellipse(th, a, b, n);
      // outward direction (approx normal in xz)
      const nx = x / (a * a), nz = z / (b * b);
      const nl = Math.hypot(nx, nz) || 1;
      const ox = nx / nl, oz = nz / nl;
      const k = Math.floor(u * 22) % 22;
      const jit = pleatJit[k] * 0.9;
      // soft vertical folds (irregular), fading toward the base seam
      let d = broad * (Math.sin(th * 5 + 0.7 + Math.sin(th * 2) * 0.8) * 0.65 + Math.sin(th * 9 + 2.1 + v * 3) * 0.35)
        + gather * Math.sin(th * 22 + jit * 2.6) * (0.75 + 0.5 * pleatJit[(k + 7) % 22])
        + frill * Math.sin(th * 31 + 1.3 + jit);
      // the bottom edge is a soft rounded seam — no folds there
      d *= smooth(0.0, 0.12, v);
      x += ox * d; z += oz * d;
      const yy = y + gather * 0.35 * Math.sin(th * 22 + jit * 2.6 + 1.2);
      pos.push(x, yy, z);
      uv.push(u * 6, v);
    }
  }
  const row = NT + 1;
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NT; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d); // outward-facing
    }
  }
  // base cap (faces down) — its own material group: the underside is matte
  const sides = idx.length;
  const center = pos.length / 3;
  pos.push(0, -0.002, 0); uv.push(0.5, 0);
  for (let i = 0; i < NT; i++) idx.push(center, i, i + 1);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.addGroup(0, sides, 0);
  g.addGroup(sides, idx.length - sides, 1);
  return g;
}
