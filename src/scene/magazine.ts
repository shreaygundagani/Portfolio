import * as THREE from 'three';
import { MAG_W, MAG_H } from './magazineModel';

/**
 * The open magazine you read. Every leaf is a subdivided sheet hinged at the
 * spine; a vertex shader rolls it round a cylinder as it turns, so pages curl
 * the way paper does. Leaves stack in two piles (read / unread) with a little
 * thickness, a soft gutter shadow and slight curvature into the spine.
 *
 * Coordinates (book-local): spine on the Y axis, unread pages to +X, the
 * reader looks down -Z. Size is the magazine's own (MAG_W × MAG_H); the root
 * is scaled to fit the viewport.
 */
const PW = MAG_W;
const PH = MAG_H;
const SEG_X = 40;
const SEG_Y = 6;
const LEAF_DZ = 0.00055;

interface Leaf {
  mesh: THREE.Mesh;
  uniforms: { uTurn: { value: number }; uCurl: { value: number }; uDim: { value: number } };
  mat: THREE.ShaderMaterial;
}

function shadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 4;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.36, 'rgba(15,8,4,0.10)');
  g.addColorStop(0.47, 'rgba(15,8,4,0.32)');
  g.addColorStop(0.5, 'rgba(15,8,4,0.45)');
  g.addColorStop(0.53, 'rgba(15,8,4,0.32)');
  g.addColorStop(0.64, 'rgba(15,8,4,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function edgeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f2ede2'; x.fillRect(0, 0, 16, 128);
  for (let i = 0; i < 128; i++) { x.fillStyle = `rgba(90,75,55,${0.04 + Math.random() * 0.12})`; x.fillRect(0, i, 16, 0.6); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Book {
  root = new THREE.Group();
  private inner = new THREE.Group();
  private geo: THREE.PlaneGeometry;
  private leaves: Leaf[] = [];
  private gutter: THREE.Mesh;
  private gutterMat: THREE.MeshBasicMaterial;
  private blockL: THREE.Mesh;
  private blockR: THREE.Mesh;
  private ownTextures: THREE.Texture[] = [];
  leafCount = 0;
  scale = 1;
  dist = 0.8;
  private page = 0;

  constructor() {
    this.root.visible = false;
    this.root.add(this.inner);
    this.geo = new THREE.PlaneGeometry(PW, PH, SEG_X, SEG_Y);
    this.geo.translate(PW / 2, 0, 0);

    this.gutterMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.gutter = new THREE.Mesh(new THREE.PlaneGeometry(PW * 0.42, PH), this.gutterMat);
    this.gutter.renderOrder = 10;
    this.inner.add(this.gutter);

    // page-block thickness under each pile
    const edge = edgeTexture();
    const side = new THREE.MeshStandardMaterial({ map: edge, roughness: 0.9 });
    const face = new THREE.MeshStandardMaterial({ color: '#efe9dd', roughness: 0.9 });
    const box = new THREE.BoxGeometry(PW, PH, 1);
    this.blockL = new THREE.Mesh(box, [side, side, side, side, face, face]);
    this.blockR = new THREE.Mesh(box, [side, side, side, side, face, face]);
    this.blockL.position.x = -PW / 2;
    this.blockR.position.x = PW / 2;
    this.blockL.receiveShadow = this.blockR.receiveShadow = true;
    this.inner.add(this.blockL, this.blockR);
  }

  /**
   * Paper shader: printed colours come through exactly (no studio light baked
   * on top), shaded only by the sheet's own curvature — so a curling page
   * darkens as it rolls away — plus a soft cast shadow from a leaf in flight.
   */
  private makeMaterial(front: THREE.Texture, back: THREE.Texture, stiff: boolean) {
    const uniforms = {
      uTurn: { value: 0 },
      uCurl: { value: stiff ? 0.35 : 1.25 },
      uFront: { value: front as THREE.Texture | null },
      uBack: { value: back as THREE.Texture | null },
      uDim: { value: 0 },
    };
    const W = PW.toFixed(5);
    const mat = new THREE.ShaderMaterial({
      uniforms,
      side: THREE.DoubleSide,
      toneMapped: false,
      vertexShader: /* glsl */ `
        uniform float uTurn;
        uniform float uCurl;
        varying vec2 vUv;
        varying vec3 vN;
        varying float vS;
        void main() {
          float A = uTurn * 3.14159265;
          float phi = uCurl * sin(A);
          float s = position.x;
          float ang = s * phi / ${W};
          float bx, bz;
          if (phi < 0.0005) { bx = s; bz = 0.0; }
          else { float R = ${W} / phi; bx = R * sin(ang); bz = -R * (1.0 - cos(ang)); }
          // the leaf swings up toward the reader and over the spine; its free
          // edge trails behind (the curl), like paper pushing through air
          vec3 p = vec3(cos(A) * bx - sin(A) * bz, position.y, sin(A) * bx + cos(A) * bz);
          // flatten the arc toward the reader so a standing page doesn't loom
          p.z *= 0.58;
          // a lying page dips gently into the gutter (on either pile)
          p.z += -0.0022 * exp(-s / ${(PW * 0.07).toFixed(5)}) * (1.0 - sin(A));
          vec3 n = vec3(sin(ang), 0.0, cos(ang));
          n = vec3(cos(A) * n.x - sin(A) * n.z, 0.0, sin(A) * n.x + cos(A) * n.z);
          n = normalize(vec3(n.x, n.y, n.z / 0.58));
          vN = normalize(normalMatrix * n);
          vUv = uv;
          vS = s;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFront;
        uniform sampler2D uBack;
        uniform float uDim;
        varying vec2 vUv;
        varying vec3 vN;
        varying float vS;
        void main() {
          vec2 uv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);
          vec4 t = gl_FrontFacing ? texture2D(uFront, uv) : texture2D(uBack, uv);
          // paper: a fine fibre grain fixed to the sheet
          float g = fract(sin(dot(floor(uv * vec2(1400.0, 1856.0)), vec2(12.9898, 78.233))) * 43758.5453);
          vec3 col = t.rgb * (0.976 + g * 0.042);
          vec3 n = normalize(gl_FrontFacing ? vN : -vN);
          float k = max(dot(n, normalize(vec3(-0.35, 0.45, 0.82))), 0.0);
          col *= 0.603 + 0.484 * k;                       // flat sheet ≈ 1.0
          col *= 1.0 - uDim * exp(-vS / ${(PW * 0.55).toFixed(5)});
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    return { uniforms, mat };
  }

  /**
   * Load an issue. `pages` runs cover … back cover (even count). `owned`
   * textures are disposed on the next load; shared ones (the cover) are not.
   */
  load(pages: THREE.Texture[], owned: THREE.Texture[]) {
    this.clear();
    this.ownTextures = owned;
    if (pages.length % 2) pages = [...pages.slice(0, -1), pages[pages.length - 2], pages[pages.length - 1]];
    const n = pages.length / 2;
    for (let k = 0; k < n; k++) {
      const stiff = k === 0 || k === n - 1;
      const u = this.makeMaterial(pages[2 * k], pages[2 * k + 1], stiff);
      const mesh = new THREE.Mesh(this.geo, u.mat);
      mesh.frustumCulled = false;
      this.inner.add(mesh);
      this.leaves.push({ mesh, uniforms: u.uniforms, mat: u.mat });
    }
    this.leafCount = n;
    this.root.visible = true;
    this.set(0, 0);
    return n;
  }

  clear() {
    this.leaves.forEach((l) => { this.inner.remove(l.mesh); l.mat.dispose(); });
    this.leaves = [];
    this.ownTextures.forEach((t) => t.dispose());
    this.ownTextures = [];
    this.leafCount = 0;
  }

  hide() { this.root.visible = false; }

  /** page: 0 (closed, cover) … n (closed, back cover); focus: -1 left page, 0 centre, +1 right page */
  set(page: number, focus: number) {
    this.page = page;
    const n = this.leaves.length;
    let lifting = 0;
    for (let i = 0; i < n; i++) {
      const turn = THREE.MathUtils.clamp(page - i, 0, 1);
      const l = this.leaves[i];
      l.uniforms.uTurn.value = turn;
      // two piles, well separated in depth; a leaf switches pile when edge-on
      const z = turn < 0.5 ? (n - i) * LEAF_DZ : (i + 1) * LEAF_DZ;
      l.mesh.position.z = z + Math.sin(turn * Math.PI) * 0.004;
      l.mesh.visible = !(turn >= 1 && i < Math.floor(page) - 2) && !(turn <= 0 && i > Math.ceil(page) + 2);
      if (turn > 0 && turn < 1) lifting = Math.max(lifting, Math.sin(turn * Math.PI));
    }
    // keep every pile's top leaf visible (and the ones mid-turn)
    const read = Math.min(n, Math.max(0, Math.floor(page)));
    if (read > 0) this.leaves[read - 1].mesh.visible = true;
    if (read < n) this.leaves[read].mesh.visible = true;
    // a leaf in flight shades the sheets beneath it
    this.leaves.forEach((l) => (l.uniforms.uDim.value = 0));
    const fly = page - Math.floor(page);
    const fi = Math.floor(page);
    if (fly > 0.001 && fi < n) {
      const lift = Math.sin(fly * Math.PI);
      if (fi + 1 < n) this.leaves[fi + 1].uniforms.uDim.value = 0.34 * lift * (1 - fly);
      if (fi - 1 >= 0) this.leaves[fi - 1].uniforms.uDim.value = 0.34 * lift * fly;
    }

    // block thickness tracks how much of the magazine sits on each side
    const thickR = Math.max(0.0004, (n - page) * LEAF_DZ * 1.2);
    const thickL = Math.max(0.0004, page * LEAF_DZ * 1.2);
    this.blockR.scale.z = thickR; this.blockR.position.z = -0.003 - thickR / 2;
    this.blockL.scale.z = thickL; this.blockL.position.z = -0.003 - thickL / 2;
    this.blockR.visible = page < n - 0.02;
    this.blockL.visible = page > 0.02;

    const open = THREE.MathUtils.clamp(page, 0, 1) * THREE.MathUtils.clamp(n - page, 0, 1);
    this.gutterMat.opacity = open * 0.85 + lifting * 0.1;
    this.gutter.position.z = (n + 2) * LEAF_DZ + 0.0008;

    // centre what's visible: the closed cover, the spread, or the back cover
    const closedFront = 1 - THREE.MathUtils.clamp(page, 0, 1);
    const closedBack = THREE.MathUtils.clamp(page - (n - 1), 0, 1);
    this.inner.position.x = -(PW / 2) * closedFront + (PW / 2) * closedBack - focus * (PW / 2) * open;
  }

  /** scale + distance so the book fills the view (spread on wide screens, one page on narrow) */
  fit(camera: THREE.PerspectiveCamera, singlePage: boolean) {
    const d = 0.8;
    const visH = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visW = visH * camera.aspect;
    const s = singlePage
      ? Math.min((visW * 0.86) / PW, (visH * 0.72) / PH)
      : Math.min((visW * 0.9) / (2 * PW), (visH * 0.8) / PH);
    this.scale = s;
    this.dist = d;
    this.root.scale.setScalar(s);
  }

  /** ride in front of the camera with a whisper of tilt; zoom scales the
   *  book about the screen centre and pan (in NDC) slides it across */
  follow(camera: THREE.PerspectiveCamera, tiltX: number, tiltY: number, zoom = 1, panX = 0, panY = 0) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const visH = 2 * this.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visW = visH * camera.aspect;
    this.root.position.copy(camera.position).addScaledVector(fwd, this.dist)
      .addScaledVector(right, (panX * visW) / 2).addScaledVector(up, (panY * visH) / 2);
    this.root.quaternion.copy(camera.quaternion);
    // a zoomed page sits square to the reader
    const flat = 1 / zoom;
    this.root.rotateY(tiltY * flat);
    this.root.rotateX(tiltX * flat);
    this.root.scale.setScalar(this.scale * zoom);
  }

  /** where the closed book sits — the picked magazine flies exactly here */
  presentPose(camera: THREE.PerspectiveCamera, tilt = { x: 0, y: 0 }) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const q = camera.quaternion.clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tilt.y))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt.x));
    return { p: camera.position.clone().addScaledVector(fwd, this.dist), q, s: this.scale };
  }
}
