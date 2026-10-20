import * as THREE from 'three';
import type { Colourway } from '../theme';

/**
 * A photographic studio: an environment map of soft light panels (PMREM) that
 * gives satin, gloss and cord their reflections, plus a directional rig that
 * carves form and throws the net's shadow. The env walls are tinted by the
 * colourway so reflections carry the colour of the backdrop, like a real set.
 *
 * The backdrop itself is CSS — the canvas is transparent.
 */
export interface StudioRig {
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  envTexture: THREE.Texture;
  setColourway(c: Colourway): void;
  /** soft, even light for reading printed pages */
  setReading(on: boolean): void;
}

function buildEnvScene(top: THREE.Color, bottom: THREE.Color) {
  const envScene = new THREE.Scene();
  const domeGeo = new THREE.SphereGeometry(12, 48, 24);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: top }, bottom: { value: bottom } },
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vP;
      uniform vec3 top; uniform vec3 bottom;
      void main() {
        float h = clamp(normalize(vP).y * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(mix(bottom, top, smoothstep(0.1, 0.95, h)), 1.0);
      }
    `,
  });
  envScene.add(new THREE.Mesh(domeGeo, domeMat));

  const disposables: { dispose(): void }[] = [domeGeo, domeMat];
  const panel = (w: number, h: number, color: THREE.ColorRepresentation, intensity: number, pos: [number, number, number]) => {
    const g = new THREE.PlaneGeometry(w, h);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(...pos);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
    disposables.push(g, m);
  };

  // big soft key, upper-left front
  panel(7, 6, '#fff8ee', 3.2, [-5, 4.2, 4.5]);
  // cool-ish fill, right
  panel(5, 7, '#f2f4f6', 1.1, [6, 1.2, 2.5]);
  // overhead diffusion
  panel(9, 4, '#ffffff', 1.6, [0, 7.5, 0.5]);
  // rim / kicker from behind
  panel(4, 7, '#fff3e6', 2.4, [2.5, 2.5, -6]);
  panel(4, 7, '#fff3e6', 1.6, [-3.5, 1.5, -6]);
  // strip lights — the long crisp streaks on satin and gloss
  panel(0.45, 7.5, '#ffffff', 7.0, [-3.4, 1.2, 3.6]);
  panel(0.35, 6, '#fff5ea', 4.5, [3.6, 0.8, 3.0]);
  panel(3.2, 0.3, '#ffffff', 5.0, [0.2, 4.2, 2.6]);

  return { envScene, dispose: () => disposables.forEach((d) => d.dispose()) };
}

export function buildEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cw: Colourway): StudioRig {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  let envRT: THREE.WebGLRenderTarget | null = null;

  const makeEnv = (c: Colourway) => {
    const top = new THREE.Color(c.envTop);
    const bottom = new THREE.Color(c.envBottom);
    const { envScene, dispose } = buildEnvScene(top, bottom);
    const rt = pmrem.fromScene(envScene, 0.02);
    dispose();
    if (envRT) envRT.dispose();
    envRT = rt;
    scene.environment = rt.texture;
    rig.envTexture = rt.texture;
  };

  // --- directional rig ---
  const key = new THREE.DirectionalLight('#fff6e9', 2.4);
  key.position.set(-1.6, 2.6, 2.2);
  key.target.position.set(0, 0.2, 0);
  key.castShadow = true;
  // phones get a lighter shadow map; the net's shadow still reads
  const small = matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600;
  key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  key.shadow.camera.near = 1.0;
  key.shadow.camera.far = 6;
  key.shadow.camera.left = -1.0;
  key.shadow.camera.right = 1.0;
  key.shadow.camera.top = 1.05;
  key.shadow.camera.bottom = -0.85;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.0035;
  key.shadow.radius = 3;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight('#f1f3f6', 0.55);
  fill.position.set(2.4, 0.9, 1.6);
  scene.add(fill);

  const rim = new THREE.DirectionalLight('#fff1e0', 1.6);
  rim.position.set(1.2, 1.8, -2.4);
  scene.add(rim);

  const hemi = new THREE.HemisphereLight('#fff8ec', '#6b5a3c', 0.35);
  scene.add(hemi);

  const rig: StudioRig = {
    key, fill, rim, hemi,
    envTexture: null as unknown as THREE.Texture,
    setColourway(c: Colourway) {
      makeEnv(c);
      hemi.groundColor.set(c.envBottom).multiplyScalar(0.6);
    },
    setReading(on: boolean) {
      // printed pages: soft, even light — the page shader carries most of the
      // brightness itself so colours read true and blacks stay black
      key.intensity = on ? 1.05 : 2.4;
      fill.intensity = on ? 0.45 : 0.55;
      rim.intensity = on ? 0.25 : 1.6;
      hemi.intensity = on ? 0.3 : 0.35;
    },
  };
  makeEnv(cw);
  hemi.groundColor.set(cw.envBottom).multiplyScalar(0.6);
  return rig;
}
