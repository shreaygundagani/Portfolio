import * as THREE from 'three';

/**
 * Offscreen product photography. Renders a still life into a transparent image
 * (multisampled, tone-mapped, sRGB, straight alpha) so it can be composited on
 * a 2D canvas between the cover's backdrop and its cover lines — exactly how a
 * magazine cover is built: background → masthead → subject → type.
 */
export interface ShotOptions {
  subject: THREE.Object3D;
  width: number;
  height: number;
  fov?: number;
  camPos: THREE.Vector3;
  target: THREE.Vector3;
  /** key-light direction (from the subject toward the light) */
  key?: THREE.Vector3;
  keyIntensity?: number;
  exposure?: number;
  /** soft shadow catcher: a plane through `shadowAt` facing `shadowNormal` */
  shadowAt?: THREE.Vector3;
  shadowNormal?: THREE.Vector3;
  shadowOpacity?: number;
  /** half-size of the key light's shadow frustum */
  shadowExtent?: number;
  /** called before render with the scene (e.g. to step a simulation) */
  prepare?: (scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void;
  /** world points to project into image pixels (returned in `anchors`) */
  anchors?: THREE.Vector3[];
}

export interface Shot extends HTMLCanvasElement { anchors?: { x: number; y: number }[]; }

const OutputShader = {
  uniforms: { tSrc: { value: null as THREE.Texture | null }, uExposure: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSrc;
    uniform float uExposure;
    varying vec2 vUv;
    vec3 neutral(vec3 color) {
      const float StartCompression = 0.8 - 0.04;
      const float Desaturation = 0.15;
      color *= uExposure;
      float x = min(color.r, min(color.g, color.b));
      float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
      color -= offset;
      float peak = max(color.r, max(color.g, color.b));
      if (peak < StartCompression) return color;
      float d = 1. - StartCompression;
      float newPeak = 1. - d * d / (peak + d - StartCompression);
      color *= newPeak / peak;
      float g = 1. - 1. / (Desaturation * (peak - newPeak) + 1.);
      return mix(color, vec3(newPeak), g);
    }
    vec3 srgb(vec3 v) {
      return mix(pow(v, vec3(0.41666)) * 1.055 - vec3(0.055), v * 12.92, vec3(lessThanEqual(v, vec3(0.0031308))));
    }
    void main() {
      vec4 c = texture2D(tSrc, vUv);
      vec3 rgb = c.a > 0.0001 ? c.rgb / c.a : vec3(0.0);
      rgb = srgb(clamp(neutral(rgb), 0.0, 1.0));
      gl_FragColor = vec4(rgb, c.a);
    }
  `,
};

/** A neutral photo studio for the covers — independent of the site colourway. */
function neutralStudioEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: '#8c8a86', side: THREE.BackSide }));
  env.add(dome);
  const panel = (w: number, h: number, c: string, k: number, p: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...p);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(7, 5, '#fff7ee', 3.4, [-5, 4.5, 4]);    // big soft key
  panel(6, 6, '#f1f4f8', 1.3, [6, 1, 2.5]);     // fill
  panel(9, 4, '#ffffff', 1.8, [0, 7, 0.5]);     // overhead
  panel(4, 6, '#fff3e6', 2.2, [2, 2.5, -6]);    // kicker
  panel(0.45, 7, '#ffffff', 7.5, [-3.3, 1.2, 3.6]); // strips — long crisp streaks
  panel(0.35, 6, '#fff5ea', 4.8, [3.5, 0.8, 3.0]);
  panel(3.2, 0.3, '#ffffff', 5.0, [0.2, 4.2, 2.6]);
  const rt = pmrem.fromScene(env, 0.02);
  pmrem.dispose();
  env.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
  return rt.texture;
}

export class Studio {
  private quadScene = new THREE.Scene();
  private env: THREE.Texture;
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private outMat = new THREE.ShaderMaterial({ ...OutputShader, uniforms: THREE.UniformsUtils.clone(OutputShader.uniforms), depthTest: false, depthWrite: false });

  constructor(private renderer: THREE.WebGLRenderer) {
    this.env = neutralStudioEnv(renderer);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quadScene.add(new THREE.Mesh(tri, this.outMat));
  }

  /** upload a texture ahead of a shot (spreads the cost over separate tasks) */
  upload(t: THREE.Texture) { this.renderer.initTexture(t); }

  private ready: { W: number; H: number; rtA: THREE.WebGLRenderTarget; rtB: THREE.WebGLRenderTarget } | null = null;
  private catcher = Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: 0.35 })), { receiveShadow: true });
  private targets(W: number, H: number) {
    const r = this.renderer;
    // half-float keeps highlights for the tone curve; fall back to 8-bit where
    // float targets can't be rendered to (some mobile GPUs / older Safari)
    const gx = r.extensions;
    const floatOK = gx.has('EXT_color_buffer_float') || gx.has('EXT_color_buffer_half_float');
    const rtA = new THREE.WebGLRenderTarget(W, H, {
      type: floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: r.capabilities.isWebGL2 ? 4 : 0,
      depthBuffer: true,
    });
    const rtB = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false });
    return { rtA, rtB };
  }

  /** allocate the next shot's render targets now (a big multisampled buffer
   *  is costly to create — better in a task of its own) */
  prepare(W: number, H: number) {
    this.ready?.rtA.dispose(); this.ready?.rtB.dispose();
    const { rtA, rtB } = this.targets(W, H);
    this.renderer.initRenderTarget(rtA);
    this.renderer.initRenderTarget(rtB);
    this.ready = { W, H, rtA, rtB };
  }

  /** Shoot now: renders and reads the pixels back synchronously. */
  shoot(o: ShotOptions): Shot {
    const e = this.expose(o);
    const buf = new Uint8Array(e.W * e.H * 4);
    this.unbindPack();
    this.renderer.readRenderTargetPixels(e.rt, 0, 0, e.W, e.H, buf);
    e.rt.dispose();
    return this.develop(buf, e.W, e.H, e.anchors);
  }

  /** three r171's async read-back leaves its pixel-pack buffer bound while it
   *  waits on the fence (it re-binds it before reading), and a plain readPixels
   *  with a buffer bound fails — so never leave one bound */
  private unbindPack() {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }

  /** Shoot without stalling: the read-back waits on a GPU fence instead of
   *  blocking the main thread (and without Chrome's "GPU stall" warning). */
  async shootAsync(o: ShotOptions): Promise<Shot> {
    const e = this.expose(o);
    const buf = new Uint8Array(e.W * e.H * 4);
    try {
      const read = this.renderer.readRenderTargetPixelsAsync(e.rt, 0, 0, e.W, e.H, buf);
      this.unbindPack(); // the read is queued; don't leave its buffer bound meanwhile
      await read;
    } catch {
      this.unbindPack();
      this.renderer.readRenderTargetPixels(e.rt, 0, 0, e.W, e.H, buf);
    }
    e.rt.dispose();
    return this.develop(buf, e.W, e.H, e.anchors);
  }

  /** render the still life, tone-mapped, into an 8-bit target for read-back */
  private expose(o: ShotOptions) {
    const r = this.renderer;
    const { width: W, height: H } = o;
    const scene = new THREE.Scene();
    scene.environment = this.env;

    const cam = new THREE.PerspectiveCamera(o.fov ?? 24, W / H, 0.01, 20);
    cam.position.copy(o.camPos);
    cam.lookAt(o.target);

    // lighting: a big soft key with real shadows, a fill and a rim
    const keyDir = (o.key ?? new THREE.Vector3(-0.8, 1.2, 1.1)).clone().normalize();
    const key = new THREE.DirectionalLight('#fff6ea', o.keyIntensity ?? 2.6);
    key.position.copy(o.target).addScaledVector(keyDir, 3);
    key.target.position.copy(o.target);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const ext = o.shadowExtent ?? 0.45;
    Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 0.5, far: 6 });
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.002;
    key.shadow.radius = 6;
    key.shadow.blurSamples = 16;
    const fill = new THREE.DirectionalLight('#f2f4f8', 0.6);
    fill.position.copy(o.target).add(new THREE.Vector3(2, 0.6, 1.4));
    const rim = new THREE.DirectionalLight('#fff2e2', 1.4);
    rim.position.copy(o.target).add(new THREE.Vector3(0.8, 1.6, -2.2));
    scene.add(key, key.target, fill, rim, new THREE.HemisphereLight('#ffffff', '#8a8070', 0.3));

    scene.add(o.subject);

    let catcher: THREE.Mesh | null = null;
    if (o.shadowAt) {
      // one catcher for every shot: its compiled shader stays warm
      catcher = this.catcher;
      (catcher.material as THREE.ShadowMaterial).opacity = o.shadowOpacity ?? 0.35;
      catcher.position.copy(o.shadowAt);
      catcher.lookAt(o.shadowAt.clone().add(o.shadowNormal ?? new THREE.Vector3(0, 1, 0)));
      catcher.receiveShadow = true;
      scene.add(catcher);
    }

    o.prepare?.(scene, cam);

    const pre = this.ready && this.ready.W === W && this.ready.H === H ? this.ready : null;
    this.ready = null;
    const { rtA, rtB } = pre ?? this.targets(W, H);

    const prevRT = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    const prevShadowAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = true;

    r.setRenderTarget(rtA);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(scene, cam);

    this.outMat.uniforms.tSrc.value = rtA.texture;
    this.outMat.uniforms.uExposure.value = o.exposure ?? 1;
    r.setRenderTarget(rtB);
    r.clear(true, false, false);
    r.render(this.quadScene, this.quadCam);

    r.setRenderTarget(prevRT);
    r.setClearColor(prevClear, prevAlpha);
    r.shadowMap.autoUpdate = prevShadowAuto;

    let anchors: { x: number; y: number }[] | undefined;
    if (o.anchors) {
      cam.updateMatrixWorld();
      anchors = o.anchors.map((a) => {
        const v = a.clone().project(cam);
        return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
      });
    }

    // tidy (the pixels are in rtB now)
    scene.remove(o.subject);
    key.shadow.map?.dispose();
    key.dispose(); fill.dispose(); rim.dispose();
    if (catcher) scene.remove(catcher);
    rtA.dispose();
    return { rt: rtB, W, H, anchors };
  }

  /** flip the rows into a 2D canvas */
  private develop(buf: Uint8Array, W: number, H: number, anchors?: { x: number; y: number }[]): Shot {
    const out = document.createElement('canvas') as Shot;
    if (anchors) out.anchors = anchors;
    out.width = W; out.height = H;
    const ctx = out.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const row = W * 4;
    for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    return out;
  }
}
