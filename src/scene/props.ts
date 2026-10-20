import * as THREE from 'three';
import { makeCanvas, toTexture, font, SERIF, SANS, MONO, TEXT, grain, barcode } from '../art/canvas';

/* Small still-life objects: they live in the bag and star on the covers. */

const gold = () => new THREE.MeshStandardMaterial({ color: '#c9a35a', metalness: 1, roughness: 0.26, envMapIntensity: 1.4 });
const lacquer = (c: string) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.2 });

function shadowAll(g: THREE.Object3D) {
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/* ------------------------------------------------------------------ lipstick */
/** A luxury lipstick: lacquered case, gold sleeve, a bullet cut on the bias. Base at y=0, ~7.4 cm tall. */
export function lipstick(bullet = '#7a1430', caseColor = '#141012', withCap = false): THREE.Group {
  const g = new THREE.Group();
  const R = 0.0112;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.036, 64), lacquer(caseColor));
  body.position.y = 0.018;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.003, R * 1.003, 0.0035, 64), gold());
  band.position.y = 0.0345;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.96, R, 0.002, 64), gold());
  foot.position.y = 0.001;
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.86, R * 0.86, 0.017, 64), gold());
  sleeve.position.y = 0.036 + 0.0085;

  // bullet: a cylinder sliced on a slant, softly rounded at the tip
  const BR = R * 0.7, BH = 0.026;
  const bg = new THREE.CylinderGeometry(BR, BR, BH, 64, 24, false);
  const p = bg.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const cut = BH / 2 - ((x + BR) / (2 * BR)) * 0.012 - 0.001; // the slant
    if (y > cut) p.setY(i, cut + (y - cut) * 0.02);
    // ease the shoulder so the cut edge isn't razor-sharp
    const r = Math.hypot(x, z);
    if (y > cut - 0.002 && r > BR * 0.9) { const k = 0.985; p.setX(i, x * k); p.setZ(i, z * k); }
  }
  bg.computeVertexNormals();
  const bulletMesh = new THREE.Mesh(bg, new THREE.MeshPhysicalMaterial({
    color: bullet, roughness: 0.38, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: new THREE.Color(bullet).multiplyScalar(1.6), envMapIntensity: 1,
  }));
  bulletMesh.position.y = 0.036 + 0.017 + BH / 2 - 0.004;
  g.add(body, band, foot, sleeve, bulletMesh);

  if (withCap) {
    const cap = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.02, R * 1.02, 0.034, 64, 1, false), lacquer(caseColor));
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.025, R * 1.025, 0.004, 64), gold());
    ring.position.y = -0.015;
    cap.add(shell, ring);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(0.034, R * 1.02, 0.008);
    cap.rotation.y = 0.5;
    g.add(cap);
  }
  return shadowAll(g) as THREE.Group;
}

/* --------------------------------------------------------------------- lens */
function lensRingTexture(): THREE.Texture {
  const { c, x } = makeCanvas(2048, 96);
  x.fillStyle = '#0d0d0e'; x.fillRect(0, 0, 2048, 96);
  x.fillStyle = '#f2ece2';
  font(x, `500 40px ${SANS}`, 8);
  x.textAlign = 'left';
  x.fillText('SHREYA  OPTIC  1:1.4   f = 50 mm   ·   THROUGH THE LENS OF INDIA   ·   No 0326', 40, 64);
  x.fillStyle = '#b5342a';
  x.beginPath(); x.arc(1900, 48, 12, 0, Math.PI * 2); x.fill();
  const t = toTexture(c, 8);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** A vintage 50 mm lens, optical axis along +Z (front element toward the camera). */
export function lens(): THREE.Group {
  const g = new THREE.Group();
  // lathe profile (radius, z) from the mount (back) to the front
  const pts: [number, number][] = [
    [0.0, -0.028], [0.021, -0.028], [0.0215, -0.024], [0.0245, -0.024], [0.0245, -0.019],
    [0.0262, -0.018], [0.0262, -0.006], [0.0275, -0.005], [0.029, -0.004], [0.029, 0.014],
    [0.0278, 0.015], [0.0278, 0.021], [0.0284, 0.022], [0.0284, 0.027], [0.026, 0.0285], [0.022, 0.0285],
  ];
  const lathe = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), 96);
  lathe.rotateX(Math.PI / 2); // lathe axis Y → Z
  const barrel = new THREE.Mesh(lathe, new THREE.MeshStandardMaterial({ color: '#111113', metalness: 0.55, roughness: 0.38, envMapIntensity: 1.1 }));
  g.add(barrel);

  // knurled focus grip — fine ridges
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0296, 0.0296, 0.016, 180, 1, true), new THREE.MeshStandardMaterial({ color: '#0c0c0d', metalness: 0.3, roughness: 0.55 }));
  const gp = grip.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + (Math.round(a / (Math.PI * 2) * 90 * 2) % 2 === 0 ? 0.02 : 0);
    gp.setX(i, x * k); gp.setZ(i, z * k);
  }
  grip.geometry.computeVertexNormals();
  grip.rotation.x = Math.PI / 2;
  grip.position.z = 0.005;
  g.add(grip);

  // engraved name ring
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0285, 0.0285, 0.005, 128, 1, true), new THREE.MeshStandardMaterial({ map: lensRingTexture(), metalness: 0.4, roughness: 0.4 }));
  ring.rotation.x = Math.PI / 2;
  ring.rotation.y = Math.PI * 0.62;
  ring.position.z = 0.0245;
  g.add(ring);

  // gold accent ring
  const accent = new THREE.Mesh(new THREE.TorusGeometry(0.0287, 0.0007, 8, 128), gold());
  accent.position.z = 0.0212;
  g.add(accent);

  // front element: coated glass — iridescent violet/green reflections over black
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.0222, 64), new THREE.MeshBasicMaterial({ color: '#030304' }));
  inner.position.z = 0.0262;
  const glassGeo = new THREE.SphereGeometry(0.05, 64, 16, 0, Math.PI * 2, 0, 0.47);
  glassGeo.rotateX(Math.PI / 2);
  glassGeo.translate(0, 0, 0.0262 - 0.05 * Math.cos(0.47) + 0.0005);
  const glass = new THREE.Mesh(glassGeo, new THREE.MeshPhysicalMaterial({
    color: '#0a0a12', metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02,
    iridescence: 1, iridescenceIOR: 1.9, iridescenceThicknessRange: [180, 520], envMapIntensity: 2.2,
    transparent: true, opacity: 0.9,
  }));
  g.add(inner, glass);
  return shadowAll(g) as THREE.Group;
}

/* ----------------------------------------------------------------- envelope */
function envelopeTexture(paper: string, ink: string): THREE.Texture {
  const W = 1400, H = 945;
  const { c, x } = makeCanvas(W, H);
  x.fillStyle = paper; x.fillRect(0, 0, W, H);
  // laid-paper texture
  x.strokeStyle = 'rgba(80,60,40,0.05)'; x.lineWidth = 1;
  for (let y = 0; y < H; y += 7) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
  // the flap (a V) with a soft shadow under its edge
  x.save();
  x.beginPath(); x.moveTo(0, 0); x.lineTo(W, 0); x.lineTo(W / 2, H * 0.58); x.closePath();
  x.shadowColor = 'rgba(40,25,10,0.28)'; x.shadowBlur = 22; x.shadowOffsetY = 6;
  x.fillStyle = paper; x.fill();
  x.restore();
  x.strokeStyle = 'rgba(60,40,20,0.22)'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(0, 0); x.lineTo(W / 2, H * 0.58); x.lineTo(W, 0); x.stroke();
  // side seams
  x.strokeStyle = 'rgba(60,40,20,0.1)';
  x.beginPath(); x.moveTo(0, H); x.lineTo(W * 0.42, H * 0.5); x.moveTo(W, H); x.lineTo(W * 0.58, H * 0.5); x.stroke();
  // a postmark-ish stamp mark, lower right
  x.save();
  x.translate(W * 0.8, H * 0.8); x.rotate(-0.18);
  x.strokeStyle = ink; x.globalAlpha = 0.35; x.lineWidth = 3;
  x.beginPath(); x.arc(0, 0, 70, 0, Math.PI * 2); x.stroke();
  font(x, `500 22px ${MONO}`, 4); x.fillStyle = ink; x.textAlign = 'center';
  x.fillText('BY HAND', 0, -8); x.fillText('MMXXVI', 0, 24);
  x.restore();
  grain(x, W, H, 0.03);
  return toTexture(c, 8);
}

const sealMaps = new Map<string, THREE.Texture>();
/** the seal's relief never changes: built once per letter, kept (userData.keep) */
function sealNormalMap(letter: string): THREE.Texture {
  const hit = sealMaps.get(letter);
  if (hit) return hit;
  const S = 256;
  const { c, x } = makeCanvas(S, S);
  // height map: raised rim + raised monogram on a slightly domed field
  x.fillStyle = '#808080'; x.fillRect(0, 0, S, S);
  const h = makeCanvas(S, S);
  const hx = h.x;
  hx.fillStyle = '#000'; hx.fillRect(0, 0, S, S);
  hx.strokeStyle = '#fff'; hx.lineWidth = 9;
  hx.beginPath(); hx.arc(S / 2, S / 2, S * 0.38, 0, Math.PI * 2); hx.stroke();
  hx.lineWidth = 3;
  hx.beginPath(); hx.arc(S / 2, S / 2, S * 0.33, 0, Math.PI * 2); hx.stroke();
  hx.fillStyle = '#fff';
  font(hx, `italic 600 ${S * 0.42}px ${SERIF}`);
  hx.textAlign = 'center';
  hx.fillText(letter, S / 2, S / 2 + S * 0.14);
  // blur a touch for soft wax edges
  hx.filter = 'blur(2px)';
  hx.drawImage(h.c, 0, 0);
  const src = hx.getImageData(0, 0, S, S).data;
  const out = x.getImageData(0, 0, S, S);
  const d = out.data;
  const H = (i: number, j: number) => src[((Math.min(S - 1, Math.max(0, j)) * S) + Math.min(S - 1, Math.max(0, i))) * 4] / 255;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const dx = (H(i + 1, j) - H(i - 1, j)) * 2.2;
      const dy = (H(i, j + 1) - H(i, j - 1)) * 2.2;
      const l = Math.hypot(dx, dy, 1);
      const k = (j * S + i) * 4;
      d[k] = (-dx / l * 0.5 + 0.5) * 255;
      d[k + 1] = (dy / l * 0.5 + 0.5) * 255;
      d[k + 2] = (1 / l * 0.5 + 0.5) * 255;
      d[k + 3] = 255;
    }
  }
  x.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.userData.keep = true;
  sealMaps.set(letter, t);
  return t;
}

/** A cream envelope, flap side up, closed with a wax seal. Lies in the XY plane facing +Z. */
export function envelope(wax = '#6e1a33', paper = '#efe6d4', ink = '#5a1428'): THREE.Group {
  const g = new THREE.Group();
  const W = 0.2, H = 0.135;
  const tex = envelopeTexture(paper, ink);
  const paperMat = new THREE.MeshStandardMaterial({ color: paper, roughness: 0.9 });
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.86 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.003), [paperMat, paperMat, paperMat, paperMat, face, paperMat]);
  g.add(body);

  // wax seal: an irregular, slightly domed puddle with a pressed monogram
  const seal = new THREE.CylinderGeometry(0.019, 0.02, 0.0045, 72, 3);
  const sp = seal.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const wob = 1 + 0.06 * Math.sin(a * 5 + 1) + 0.035 * Math.sin(a * 11 + 2) + 0.02 * Math.sin(a * 17);
    if (r > 0.001) { sp.setX(i, x * wob); sp.setZ(i, z * wob); }
    if (y > 0) sp.setY(i, y + (1 - Math.min(1, r / 0.02)) * 0.0012);
  }
  seal.computeVertexNormals();
  seal.rotateX(Math.PI / 2);
  const sealMesh = new THREE.Mesh(seal, new THREE.MeshPhysicalMaterial({
    color: wax, roughness: 0.32, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25,
    normalMap: sealNormalMap('S'), normalScale: new THREE.Vector2(1.1, 1.1), envMapIntensity: 1.1,
  }));
  sealMesh.position.set(0, H / 2 - H * 0.58 + 0.004, 0.0035);
  g.add(sealMesh);
  return shadowAll(g) as THREE.Group;
}

/* ------------------------------------------------------------- flat papers */
export function boardingPassTexture(accent: string, ink: string) {
  const W = 1300, H = 520;
  const { c, x } = makeCanvas(W, H);
  x.fillStyle = '#f2ece0'; x.fillRect(0, 0, W, H);
  x.fillStyle = accent; x.fillRect(0, 0, W, 104);
  x.fillStyle = '#f7efe2';
  font(x, `600 34px ${SANS}`, 10); x.textAlign = 'left';
  x.fillText('BOARDING PASS', 48, 66);
  font(x, `500 26px ${MONO}`, 4); x.textAlign = 'right';
  x.fillText('FIRST CLASS · ONE WAY', 960, 64);
  x.fillStyle = ink;
  font(x, `500 24px ${MONO}`, 4); x.textAlign = 'left';
  x.fillText('PASSENGER', 48, 160);
  font(x, `600 38px ${SANS}`, 3);
  x.fillText('GUNDAGANI / SHREYA', 48, 204);
  font(x, `500 150px ${SERIF}`, 0);
  x.fillText('HYD', 44, 372);
  x.fillText('PAR', 560, 372);
  font(x, `italic 400 44px ${SERIF}`);
  x.fillText('to', 410, 352);
  font(x, `500 22px ${MONO}`, 4);
  x.fillText('FROM ENGINEERING', 48, 418);
  x.fillText('TO LUXURY', 560, 418);
  x.fillText('SEAT 01A   GATE —   BOARDING NOW', 48, 470);
  // perforation + stub
  x.strokeStyle = ink; x.globalAlpha = 0.35; x.setLineDash([10, 10]); x.lineWidth = 3;
  x.beginPath(); x.moveTo(1000, 104); x.lineTo(1000, H); x.stroke();
  x.setLineDash([]); x.globalAlpha = 1;
  font(x, `500 22px ${MONO}`, 4); x.textAlign = 'left';
  x.fillText('SEAT', 1040, 170);
  font(x, `500 84px ${SERIF}`);
  x.fillText('01A', 1036, 260);
  barcode(x, 1040, 320, 210, 110, ink, '#f2ece0', '0326 0001');
  grain(x, W, H, 0.03);
  return toTexture(c, 8);
}

export function businessCardTexture(accent: string, ink: string) {
  const W = 1050, H = 600;
  const { c, x } = makeCanvas(W, H);
  x.fillStyle = '#f4eee3'; x.fillRect(0, 0, W, H);
  x.fillStyle = accent; x.fillRect(0, H - 26, W, 26);
  x.fillStyle = ink;
  font(x, `500 96px ${SERIF}`); x.textAlign = 'left';
  x.fillText('Shreya', 70, 210);
  font(x, `italic 400 96px ${SERIF}`);
  x.fillText('Gundagani', 70, 310);
  font(x, `500 26px ${SANS}`, 7);
  x.fillText('BRAND STRATEGY', 72, 420);
  x.fillText('FASHION MARKETING', 72, 462);
  font(x, `italic 400 30px ${TEXT}`);
  x.textAlign = 'right';
  x.fillText('(formerly: engineer)', W - 70, 462);
  grain(x, W, H, 0.025);
  return toTexture(c, 8);
}

/** A thin printed card (boarding pass / business card). */
export function card(w: number, h: number, tex: THREE.Texture, thickness = 0.0006): THREE.Mesh {
  const edge = new THREE.MeshStandardMaterial({ color: '#efe8da', roughness: 0.9 });
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, envMapIntensity: 0.8 });
  const back = new THREE.MeshStandardMaterial({ color: '#efe8da', roughness: 0.85 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, thickness), [edge, edge, edge, edge, face, back]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
