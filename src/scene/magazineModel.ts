import * as THREE from 'three';

/**
 * A closed, perfect-bound magazine: a thin block (not a box-y book) with a
 * glossy wrap-around cover, a square printed spine and fine page edges on the
 * three cut sides. A shared `uBend` uniform flexes it along its width the way
 * a real magazine flexes when it's carried, lifted or presented.
 */
export const MAG_W = 0.2;
export const MAG_H = 0.265;
export const MAG_T = 0.0058;

let pageEdgeTex: THREE.Texture | null = null;
let pageEdgeTexV: THREE.Texture | null = null;

/** fine stacked-paper lines (stripes vary along u) */
function edgeCanvas(vertical: boolean) {
  const W = vertical ? 32 : 256, H = vertical ? 256 : 32;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f3efe6';
  x.fillRect(0, 0, W, H);
  const n = vertical ? H : W;
  for (let i = 0; i < n; i += 1) {
    const a = 0.03 + Math.random() * 0.09;
    x.fillStyle = `rgba(95,80,60,${a})`;
    if (vertical) x.fillRect(0, i, W, Math.random() < 0.25 ? 1 : 0.5);
    else x.fillRect(i, 0, Math.random() < 0.25 ? 1 : 0.5, H);
  }
  // a whisper of shadow toward the covers (the outer sheets)
  const g = vertical ? x.createLinearGradient(0, 0, 0, H) : x.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(40,30,20,0.18)');
  g.addColorStop(0.12, 'rgba(40,30,20,0)');
  g.addColorStop(0.88, 'rgba(40,30,20,0)');
  g.addColorStop(1, 'rgba(40,30,20,0.18)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function edgeTextures() {
  if (!pageEdgeTex) pageEdgeTex = edgeCanvas(false);
  if (!pageEdgeTexV) pageEdgeTexV = edgeCanvas(true);
  return { u: pageEdgeTex, v: pageEdgeTexV };
}

/** Cylindrical bend around the spine (x = -W/2), applied in the vertex shader. */
function addBend(mat: THREE.Material, uBend: { value: number }) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBend = uBend;
    sh.vertexShader = 'uniform float uBend;\n' + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', /* glsl */ `
      #include <beginnormal_vertex>
      {
        float s_ = position.x + ${(MAG_W / 2).toFixed(5)};
        float a_ = s_ * uBend;
        float c_ = cos(a_), sn_ = sin(a_);
        objectNormal = vec3(c_ * objectNormal.x - sn_ * objectNormal.z, objectNormal.y, sn_ * objectNormal.x + c_ * objectNormal.z);
      }
    `);
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', /* glsl */ `
      #include <begin_vertex>
      {
        float s_ = position.x + ${(MAG_W / 2).toFixed(5)};
        float a_ = s_ * uBend;
        float c_ = cos(a_), sn_ = sin(a_);
        float mx_ = abs(uBend) < 1e-4 ? s_ : sn_ / uBend;
        float mz_ = abs(uBend) < 1e-4 ? 0.0 : (1.0 - c_) / uBend;
        transformed = vec3(-${(MAG_W / 2).toFixed(5)} + mx_ - position.z * sn_, position.y, mz_ + position.z * c_);
      }
    `);
  };
  mat.customProgramCacheKey = () => 'mag-bend-' + mat.type;
}

export interface MagazineMesh {
  group: THREE.Group;
  mesh: THREE.Mesh;
  bend: { value: number };
  cover: THREE.MeshPhysicalMaterial;
  back: THREE.MeshPhysicalMaterial;
  spine: THREE.MeshPhysicalMaterial;
  setTextures(cover: THREE.Texture, back: THREE.Texture, spine: THREE.Texture): void;
  dispose(): void;
}

let sharedGeo: THREE.BoxGeometry | null = null;

export function buildMagazine(): MagazineMesh {
  if (!sharedGeo) sharedGeo = new THREE.BoxGeometry(MAG_W, MAG_H, MAG_T, 24, 1, 1);
  const bend = { value: 0 };
  const edges = edgeTextures();

  const gloss = (map: THREE.Texture | null) => new THREE.MeshPhysicalMaterial({
    map,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.65,
    clearcoatRoughness: 0.16,
    envMapIntensity: 0.85,
  });
  const cover = gloss(null);
  const back = gloss(null);
  const spine = gloss(null);
  const pagesU = new THREE.MeshStandardMaterial({ map: edges.u, roughness: 0.92, metalness: 0, envMapIntensity: 0.5 });
  const pagesV = new THREE.MeshStandardMaterial({ map: edges.v, roughness: 0.92, metalness: 0, envMapIntensity: 0.5 });
  [cover, back, spine, pagesU, pagesV].forEach((m) => addBend(m, bend));

  // Box face order: +x (fore-edge), -x (spine), +y (head), -y (foot), +z (front), -z (back)
  const mesh = new THREE.Mesh(sharedGeo, [pagesU, spine, pagesV, pagesV, cover, back]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);

  return {
    group, mesh, bend, cover, back, spine,
    setTextures(c, b, s) {
      cover.map = c; back.map = b; spine.map = s;
      cover.needsUpdate = back.needsUpdate = spine.needsUpdate = true;
    },
    dispose() {
      [cover, back, spine, pagesU, pagesV].forEach((m) => m.dispose());
    },
  };
}
