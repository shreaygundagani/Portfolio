import * as THREE from 'three';
import { ISSUES, IssueId, PropId, PROP_COPY } from './config';
import { COLOURWAYS, Colourway, ColourwayId, applyColourwayCSS, initialColourway, rememberColourway } from './theme';
import { buildEnvironment, StudioRig } from './scene/environment';
import { NetBag, NET_BAG_ID } from './scene/netbag';
import { Contents, layoutMode } from './scene/contents';
import { Book } from './scene/magazine';
import { Studio, Shot } from './scene/studio';
import { shootCoverPhotos, shootFlatLay, shootFlatLayAsync, CoverPhotos } from './art/shoots';
import { drawCover, drawBack, drawSpine } from './art/covers';
import { interiorPages, setPageScale, pageTexture } from './art/pages';
import { loadFonts, toTexture } from './art/canvas';
import { HUD, ACT } from './ui/hud';
import { Cursor } from './ui/cursor';
import { Reader } from './reader/reader';
import { Sound } from './ui/sound';

type Phase = 'closed' | 'open' | 'reading';
const PROPS: PropId[] = ['lipstick', 'pass', 'card'];
const isProp = (id: string | null): id is PropId => !!id && (PROPS as string[]).includes(id);
const isIssue = (id: string | null): id is IssueId => !!id && ISSUES.some((i) => i.id === id);

interface CoverSet { cover: THREE.Texture; back: THREE.Texture; spine: THREE.Texture; }

export class App {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
  private rig: StudioRig;
  private cw: Colourway;
  private bag: NetBag;
  private contents: Contents;
  private book = new Book();
  private studio: Studio;
  private hud: HUD;
  private cursor = new Cursor();
  private reader = new Reader();
  private sound = new Sound();
  private ray = new THREE.Raycaster();
  private wall: THREE.Mesh;

  private phase: Phase = 'closed';
  private hoverId: string | null = null;
  private selectedId: IssueId | null = null;
  private captionId: PropId | null = null;
  private ready = false;
  private reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  private covers: CoverSet[] = [];
  private photos: CoverPhotos | null = null;
  private flatlay: Shot | null = null;
  /** studio photography is cached per colourway, so switching back is instant */
  private photoCache: Partial<Record<ColourwayId, CoverPhotos>> = {};
  private photoJobs: Partial<Record<ColourwayId, Promise<CoverPhotos>>> = {};
  private flatCache: Partial<Record<ColourwayId, Shot>> = {};
  private restyleToken = 0;
  /** which edition the current cover textures were printed for */
  private coversFor: ColourwayId | null = null;
  private bookIssue: IssueId | null = null;

  // camera
  private camPos = new THREE.Vector3(0, 0.34, 1.6);
  private camLook = new THREE.Vector3(0, 0.34, 0);
  private lookAt = new THREE.Vector3(0, 0.34, 0);
  private parallax = new THREE.Vector2();
  private parallaxT = new THREE.Vector2();
  private pointer = new THREE.Vector2(-9, -9);
  private pointerPx = { x: 0, y: 0 };
  private drag = { on: false, x: 0, y: 0, moved: false, onBag: false, id: -1 };
  private aspect = 1;
  private wide = true;
  private entrance = 0;
  private hoverLift = 0;
  private landed = false;

  // hand-off timing
  private presentTimer = 0;
  private closing = -1;  // book page while it closes before handing back
  private time = 0;
  private emaMs = 16;
  private prTimer = 0;
  private maxPR = Math.min(window.devicePixelRatio || 1, 2);
  private curPR = this.maxPR;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.curPR);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);

    this.cw = COLOURWAYS[initialColourway()];
    applyColourwayCSS(this.cw);
    this.rig = buildEnvironment(this.renderer, this.scene, this.cw);
    this.studio = new Studio(this.renderer);

    this.bag = new NetBag(this.cw);
    this.bag.reduceMotion = this.reduce;
    this.scene.add(this.bag.root);

    // the studio wall: catches only the key light's shadow, so the net throws
    // its diamond pattern onto the backdrop like a hard-lit fashion still
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.ShadowMaterial({ opacity: 0.16, depthWrite: false }));
    this.wall.position.set(0, 0.6, -0.42);
    this.wall.receiveShadow = true;
    this.wall.renderOrder = -1;
    this.scene.add(this.wall);
    this.contents = new Contents(this.cw);
    this.scene.add(this.contents.root);
    this.scene.add(this.book.root);

    this.hud = new HUD(this.cw.id);
    this.hud.onIssue = (id) => this.openIssue(id);
    this.hud.onSound = () => this.sound.toggle();
    if (!this.sound.supported) this.hud.hideSound();
    this.hud.onColourway = (id) => this.setColourway(id);
    this.hud.onColourwayIntent = () => this.preshoot();
    this.hud.onCloseCaption = () => this.closeCaption();

    this.reader.onClose = () => this.exitReading();
    this.reader.onNextIssue = (id) => this.switchIssue(id);
    this.reader.onTurn = () => this.sound.page();

    this.resize();
    // start the camera on its mark — no fly-in from the origin
    this.camera.position.copy(this.camPos);
    this.lookAt.copy(this.camLook);
    this.camera.lookAt(this.lookAt);
    this.bag.setHandRest(this.handRest('closed').add(new THREE.Vector3(0, this.reduce ? 0 : 0.85, 0)));
    this.bindEvents();
    window.addEventListener('resize', () => this.resize());
    // printed canvases are released after upload, so a lost GPU context is
    // rebuilt from scratch rather than limping on with blank textures
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => window.location.reload());
    this.loop();
  }

  /* ------------------------------------------------------------- assets */
  async init(progress: (p: number, msg: string) => void) {
    progress(0.08, 'Setting type');
    await loadFonts();
    // styles and type are in: frame the hero on the real layout
    const mast = document.querySelector('.masthead') as HTMLElement | null;
    for (let i = 0; i < 120 && mast && getComputedStyle(mast).position !== 'fixed'; i++) await this.nextFrame();
    this.resize();
    progress(0.24, 'Lighting the studio');
    await this.nextFrame();
    progress(0.32, 'Shooting the covers');
    this.photos = await this.getPhotos(this.cw.id);
    progress(0.72, 'Printing the issues');
    await this.nextFrame();
    this.applyCovers();
    progress(0.84, 'Packing the bag');
    await this.warmUp();
    progress(1, 'Ready');
    this.ready = true;
    // the bag drops into frame
    this.bag.setHandRest(this.handRest('closed'), false);
    document.body.classList.add('is-ready');
    // once it has landed, shoot Issue 01's inventory flat-lay in the background
    window.setTimeout(() => this.idle(() => this.prepareFlatlay()), 1600);
  }

  /** cover photography for a colourway — cached, and shared while in flight */
  private getPhotos(id: ColourwayId): Promise<CoverPhotos> {
    const done = this.photoCache[id];
    if (done) return Promise.resolve(done);
    let job = this.photoJobs[id];
    if (!job) {
      job = shootCoverPhotos(this.studio, COLOURWAYS[id]).then((p) => {
        this.photoCache[id] = p;
        delete this.photoJobs[id];
        return p;
      }, (err) => {
        // never leave a failed shoot cached; covers fall back to type-only
        console.warn('cover shoot failed', err);
        delete this.photoJobs[id];
        const blank = document.createElement('canvas');
        blank.width = blank.height = 4;
        return { bag: blank, work: blank, cartier: blank, contact: blank } as CoverPhotos;
      });
      this.photoJobs[id] = job;
    }
    return job;
  }

  /** shoot the other edition's covers (on intent — hovering the swatches) */
  private async preshoot() {
    if (!this.ready) return;
    for (const id of Object.keys(COLOURWAYS) as ColourwayId[]) await this.getPhotos(id);
  }

  private nextFrame() { return new Promise<void>((r) => requestAnimationFrame(() => r())); }
  private idle(fn: () => void) {
    const ric = (window as any).requestIdleCallback as ((cb: () => void, o?: object) => number) | undefined;
    if (ric) ric(fn, { timeout: 2500 }); else window.setTimeout(fn, 900);
  }

  private applyCovers() {
    if (!this.photos) return;
    const old = this.covers;
    this.covers = ISSUES.map((meta, i) => ({
      cover: toTexture(drawCover(meta, this.cw.covers[i], this.photos![meta.id]), 16),
      back: toTexture(drawBack(meta, this.cw.covers[i]), 8),
      spine: toTexture(drawSpine(meta, this.cw.covers[i]), 4),
    }));
    this.coversFor = this.cw.id;
    this.contents.setCovers(this.covers);
    // let the GPU copies land before releasing the old ones
    window.setTimeout(() => old.forEach((c) => { c.cover.dispose(); c.back.dispose(); c.spine.dispose(); }), 500);
  }

  /** compile every program up front so the first click never stutters */
  private async warmUp() {
    const r = this.renderer as THREE.WebGLRenderer & { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<void> };
    this.book.root.visible = true;
    try {
      const parallel = this.renderer.extensions.has('KHR_parallel_shader_compile');
      if (r.compileAsync && parallel) await r.compileAsync(this.scene, this.camera);
      else r.compile(this.scene, this.camera);
    } catch { /* fine — programs compile on first use */ }
    this.book.root.visible = false;
  }

  /** the flat-lay, right now (if the background shoot hasn't delivered yet) */
  private ensureFlatlay() {
    if (this.flatlay || !this.covers.length) return;
    const cached = this.flatCache[this.cw.id];
    if (cached) { this.flatlay = cached; return; }
    this.flatlay = shootFlatLay(this.studio, this.cw, this.covers.map((c) => c.cover));
    // mid-switch the covers still belong to the old edition: use, don't keep
    if (this.coversFor === this.cw.id) this.flatCache[this.cw.id] = this.flatlay;
  }

  private flatJob: Promise<void> | null = null;
  /** the flat-lay, shot in the background a step at a time (no stalled frame) */
  private prepareFlatlay() {
    const id = this.cw.id;
    const done = this.flatCache[id];
    if (done) { this.flatlay = done; return; }
    // only with covers printed for this edition (a switch may be mid-way)
    if (this.flatJob || !this.covers.length || this.coversFor !== id) return;
    const covers = this.covers.map((c) => c.cover);
    const alive = () => this.cw.id === id && this.coversFor === id && this.covers[0]?.cover === covers[0];
    let failed = false;
    this.flatJob = shootFlatLayAsync(this.studio, this.cw, covers, alive)
      .then((shot) => {
        if (!shot || this.flatCache[id]) return;
        this.flatCache[id] = shot;
        if (this.cw.id === id) this.flatlay = shot;
      })
      .catch((err) => { failed = true; console.warn('flat-lay shoot failed', err); })
      .finally(() => {
        this.flatJob = null;
        // abandoned because the edition changed: start over for the current one
        if (!failed && !this.flatCache[this.cw.id]) this.idle(() => this.prepareFlatlay());
      });
  }

  /* -------------------------------------------------------------- layout */
  private handRest(phase: Phase) {
    const y = this.bag.handLocal.y;
    if (phase === 'closed') return new THREE.Vector3(0, y, 0);
    const mode = layoutMode(this.aspect);
    if (mode === 'wide') return new THREE.Vector3(-0.5, y + 0.05, -0.14);
    if (mode === 'tall') return new THREE.Vector3(0, y + 0.33, -0.26);
    return new THREE.Vector3(0, y + 0.42, -0.3);
  }

  private frameCamera() {
    const fovT = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const a = this.aspect;
    let visH: number, ty: number;
    const band = this.phase === 'open' ? null : this.heroBand();
    if (band) {
      // upright screens: the bag hangs between the masthead (its handles may
      // overlap the type, like a cover star) and the index strip below
      const h = window.innerHeight, y0 = -0.03, y1 = 0.66;
      const c = (band.top + band.bot) / 2 / h;
      visH = Math.max((y1 - y0) / ((band.bot - band.top) / h), 0.58 / a);
      ty = (y0 + y1) / 2 - visH * (0.5 - c);
    } else if (this.phase === 'closed' || this.phase === 'reading') {
      visH = a < 1 ? Math.max(0.98, 0.58 / a) : Math.max(0.82, 0.56 / a);
      ty = a < 1 ? 0.3 : 0.34;
      // short landscape (a phone on its side): a smaller bag, clear of the bar
      if (a >= 1 && window.innerHeight < 520) { visH = Math.max(0.92, visH); ty = 0.27; }
    } else if (layoutMode(a) === 'wide') {
      // the fan spans about ±0.76 (with margin) at the magazines' depth
      visH = Math.max(0.84, 1.52 / a + 0.027);
      ty = 0.31;
      if (window.innerHeight < 520) { visH = Math.max(0.92, visH); ty = 0.28; }
    } else if (layoutMode(a) === 'tall') {
      visH = Math.max(1.42, 1.04 / a);
      ty = 0.4;
    } else {
      visH = Math.max(1.7, 0.62 / a);
      ty = 0.25;
    }
    const d = visH / (2 * fovT);
    this.camPos.set(0, ty + 0.02, d);
    this.camLook.set(0, ty, 0);
  }

  /** where the hero bag may hang on upright screens (px), from the live layout */
  private heroBand() {
    const idx = document.querySelector('.mobile-index') as HTMLElement | null;
    const mast = document.querySelector('.masthead') as HTMLElement | null;
    const word = mast?.querySelector('.masthead__word') as HTMLElement | null;
    // nothing to measure until the stylesheet is in (init() re-frames then)
    if (!idx || !word || !mast || getComputedStyle(mast).position !== 'fixed') return null;
    if (getComputedStyle(idx).display === 'none') return null;
    // offsets ignore the entrance animation's translate
    const top = mast.offsetTop + word.offsetTop + word.offsetHeight * 0.45;
    const bot = idx.offsetTop - 10;
    return bot - top > 160 ? { top, bot } : null;
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.aspect = w / h;
    this.wide = this.aspect >= 1.1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
    this.contents.layout(this.aspect);
    document.body.dataset.layout = layoutMode(this.aspect);
    document.body.classList.toggle('is-short', h < 520);
    this.frameCamera();
    this.book.fit(this.camera, !this.wide);
    this.reader.setSingle(!this.wide);
    const touch = matchMedia('(pointer: coarse)').matches;
    setPageScale(Math.min(touch ? 1 : 1.25, Math.max(0.75, (h * Math.min(2, window.devicePixelRatio || 1)) / 1500)));
    if (this.phase !== 'reading') this.bag.setHandRest(this.handRest(this.phase === 'open' ? 'open' : 'closed'), false);
  }

  /* --------------------------------------------------------------- input */
  private bindEvents() {
    const c = this.canvas;
    const toNDC = (e: PointerEvent) => {
      this.pointerPx = { x: e.clientX, y: e.clientY };
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.parallaxT.set(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5);
    };
    c.addEventListener('pointermove', (e) => {
      toNDC(e);
      if (this.drag.on && e.pointerId === this.drag.id) {
        if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 6) this.drag.moved = true;
        if (this.drag.onBag) this.bag.drag(this.pointerOnHandPlane());
      }
    });
    c.addEventListener('pointerdown', (e) => {
      if (!this.ready) return;
      // a previous press that never came up must not leave the bag held
      if (this.drag.on && this.drag.onBag) this.bag.release();
      toNDC(e);
      this.sound.prime();
      this.updateHover();
      this.drag = { on: true, x: e.clientX, y: e.clientY, moved: false, onBag: this.hoverId === NET_BAG_ID, id: e.pointerId };
      if (this.drag.onBag) this.bag.grab(this.pointerOnHandPlane());
      try { c.setPointerCapture(e.pointerId); captured.set(e.pointerId, e.pointerType); } catch { /* pointer already gone */ }
    });
    // A press whose release never arrives must not leave the stage holding the
    // pointer: its retargeted clicks would swallow every button on the page.
    // A new press of another kind (or the same pointer pressing again) clears it.
    const captured = new Map<number, string>();
    c.addEventListener('lostpointercapture', (e) => captured.delete(e.pointerId));
    window.addEventListener('pointerdown', (e) => {
      for (const [id, type] of captured) {
        if (id !== e.pointerId && type === e.pointerType) continue;
        try { if (c.hasPointerCapture(id)) c.releasePointerCapture(id); } catch { /* gone */ }
        captured.delete(id);
        if (this.drag.on && this.drag.id === id) {
          this.drag.on = false;
          if (this.drag.onBag) this.bag.release();
        }
      }
    }, true);
    const up = (e: PointerEvent) => {
      if (!this.drag.on || e.pointerId !== this.drag.id) return;
      this.drag.on = false;
      if (this.drag.onBag) this.bag.release();
      // a cancelled pointer (the system took the gesture) is never a click
      if (!this.drag.moved && e.type === 'pointerup') this.click();
      // a finger leaves no hover behind (nothing should stay lifted where it was)
      if (e.pointerType !== 'mouse') { this.pointer.set(-9, -9); this.parallaxT.set(0, 0); }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('lostpointercapture', up);
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') { this.parallaxT.set(0, 0); this.pointer.set(-9, -9); }
    });
    window.addEventListener('keydown', (e) => {
      if (this.phase === 'reading') return;
      if (e.key === 'Escape') {
        if (this.captionId) this.closeCaption();
        else if (this.phase === 'open') this.packUp();
      }
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === document.body && this.phase === 'closed' && this.ready) {
        e.preventDefault();
        this.openBag();
      }
    });
  }

  private pointerOnHandPlane() {
    this.ray.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -this.handRest(this.phase === 'open' ? 'open' : 'closed').z);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(plane, out) ?? out.copy(this.bag.handLocal);
  }

  private click() {
    if (this.captionId) { this.closeCaption(); return; }
    const id = this.hoverId;
    if (this.phase === 'closed') {
      if (id === NET_BAG_ID) this.openBag();
      return;
    }
    if (this.phase === 'open') {
      if (id === NET_BAG_ID) this.packUp();
      else if (isIssue(id)) this.openIssue(id);
      else if (isProp(id)) this.openCaption(id);
    }
  }

  private hoverSince = 0;
  private prefetched: string | null = null;
  /** linger on a magazine and its pages are printed before you click */
  private prefetch(id: string | null) {
    if (!id || !isIssue(id) || this.phase !== 'open' || this.selectedId) { this.hoverSince = 0; return; }
    if (this.prefetched === id || this.bookIssue === id) return;
    if (!this.hoverSince) this.hoverSince = performance.now();
    if (performance.now() - this.hoverSince < 280) return;
    this.prefetched = id;
    this.idle(() => {
      if (this.phase !== 'open' || this.selectedId) return;
      // Issue 01 needs the flat-lay: let the background shoot deliver it rather
      // than shooting it here in one go (try the prefetch again next hover)
      if (id === 'bag' && !this.flatlay && !this.flatCache[this.cw.id]) { this.prefetched = null; this.prepareFlatlay(); return; }
      this.prepareBook(id);
    });
  }

  private updateHover() {
    if (!this.ready || this.phase === 'reading' || this.captionId) {
      this.hoverId = null;
      this.cursor.set(this.phase === 'reading' ? 'grab' : this.captionId ? 'pointer' : 'default');
      return;
    }
    this.ray.setFromCamera(this.pointer, this.camera);
    const targets: THREE.Object3D[] = [...this.bag.hitTargets()];
    if (this.phase === 'open' && this.contents.isOut()) targets.unshift(...this.contents.pickTargets());
    const hits = this.ray.intersectObjects(targets, false);
    let id: string | null = null;
    for (const h of hits) {
      const hid = h.object.userData.id as string;
      if (hid === NET_BAG_ID || this.phase === 'open') { id = hid; break; }
    }
    if (this.selectedId) id = null;
    if (id !== this.hoverId) this.hoverSince = 0;
    this.hoverId = id;
    this.prefetch(id);
    if (this.drag.on && this.drag.onBag) { this.cursor.set('grabbing'); return; }
    if (!id) { this.cursor.set('default'); return; }
    if (id === NET_BAG_ID) this.cursor.set('label', this.phase === 'closed' ? 'Open' : 'Pack up');
    else if (isIssue(id)) this.cursor.set('label', `No. ${ISSUES.find((i) => i.id === id)!.no}<br>Read`);
    else if (isProp(id)) this.cursor.set('label', PROP_COPY[id].label.replace('The ', ''));
  }

  /* -------------------------------------------------------------- states */
  private openBag() {
    if (this.phase !== 'closed') return;
    this.enterOpen();
    this.bag.nudge(0.6, -0.4, 1.2);
    this.sound.open();
  }

  /** closed → open: contents out, bag to its open mark, camera reframed */
  private enterOpen() {
    this.phase = 'open';
    document.body.classList.add('is-open');
    this.contents.setOpen(true);
    this.bag.setHandRest(this.handRest('open'), false);
    this.frameCamera();
    this.hud.setCue(`Pick an issue · ${ACT} the bag to pack up`);
    // make sure the inventory flat-lay is on its way (background, in steps)
    window.setTimeout(() => this.idle(() => this.prepareFlatlay()), 1900);
  }

  private packUp() {
    if (this.phase !== 'open') return;
    // cancel a magazine that's mid-flight to the camera
    window.clearTimeout(this.presentTimer);
    this.selectedId = null;
    this.closeCaption();
    this.phase = 'closed';
    document.body.classList.remove('is-open');
    this.hud.hideTags();
    this.contents.setOpen(false);
    this.bag.setHandRest(this.handRest('closed'), false);
    this.bag.nudge(-0.4, 0.2, -0.8);
    this.frameCamera();
    this.sound.tick(420, 0.05);
    this.hud.setCue(`${ACT} the bag to open it`);
  }

  private openCaption(id: PropId) {
    this.captionId = id;
    this.contents.focusId = id;
    this.hud.showCaption(id);
    this.sound.tick(700, 0.04);
  }

  private closeCaption() {
    if (!this.captionId) return;
    this.captionId = null;
    this.contents.focusId = null;
    this.hud.hideCaption();
  }

  /** pick a magazine: it flies to the camera, then the 3D book takes over */
  openIssue(id: IssueId) {
    if (!this.ready || this.phase === 'reading' || this.selectedId) return;
    this.closeCaption();
    if (this.phase === 'closed') this.enterOpen();
    this.selectedId = id;
    this.sound.tick(560, 0.05);
    this.prepareBook(id);
    window.clearTimeout(this.presentTimer);
    this.presentTimer = window.setTimeout(() => this.enterReading(id), this.reduce ? 60 : 820);
  }

  private prepareBook(id: IssueId) {
    if (this.bookIssue === id) return;
    if (id === 'bag') this.ensureFlatlay();
    const i = ISSUES.findIndex((x) => x.id === id);
    const interior = interiorPages(id, { cw: this.cw, photos: this.photos!, flatlay: this.flatlay ?? undefined });
    const own = interior.map((c) => pageTexture(c));
    const cov = this.covers[i];
    this.book.load([cov.cover, ...own, cov.back], own);
    this.book.hide();
    this.bookIssue = id;
  }

  private enterReading(id: IssueId) {
    if (this.selectedId !== id || this.phase !== 'open') return;
    this.phase = 'reading';
    document.body.classList.add('is-reading');
    this.hud.hideTags();
    this.book.fit(this.camera, !this.wide);
    this.book.root.visible = true;
    this.book.set(0, 0);
    this.contents.setVisible(id, false);
    this.reader.open(id, this.book.leafCount, !this.wide);
    this.rig.setReading(true);
    this.hoverId = null;
  }

  private exitReading() {
    if (this.phase !== 'reading') return;
    // close the magazine first, then hand it back to the fan
    this.closing = this.reader.state().page;
  }

  private finishExit() {
    this.closing = -1;
    this.book.hide();
    if (this.selectedId) this.contents.setVisible(this.selectedId, true);
    this.selectedId = null;
    this.phase = 'open';
    document.body.classList.remove('is-reading');
    this.rig.setReading(false);
    this.frameCamera();
  }

  private switchIssue(id: IssueId) {
    // swap the book's contents in place: close, reload, reopen
    if (this.phase !== 'reading' || !this.selectedId || this.closing >= 0) return;
    this.contents.setVisible(this.selectedId, true);
    this.selectedId = id;
    this.contents.setVisible(id, false);
    this.prepareBook(id);
    this.book.root.visible = true;
    this.book.set(0, 0);
    this.reader.open(id, this.book.leafCount, !this.wide);
    this.sound.open();
  }

  /* ----------------------------------------------------------- colourway */
  async setColourway(id: ColourwayId) {
    if (id === this.cw.id) return;
    const token = ++this.restyleToken;
    this.cw = COLOURWAYS[id];
    rememberColourway(id);
    applyColourwayCSS(this.cw);
    this.hud.setColourway(id);
    this.rig.setColourway(this.cw);
    this.bag.setColourway(this.cw);
    this.contents.setColourway(this.cw);
    this.bag.nudge(0.25, 0, 0.9);
    this.sound.tick(480, 0.05);
    await this.nextFrame();
    const photos = await this.getPhotos(id);
    if (token !== this.restyleToken) return; // a later click won
    this.photos = photos;
    this.applyCovers();
    this.flatlay = this.flatCache[id] ?? null;
    this.bookIssue = null;
    this.prefetched = null;
    // after the new covers have finished uploading (their GPU copies would
    // otherwise all land inside the flat-lay's pixel read-back)
    window.setTimeout(() => this.idle(() => this.prepareFlatlay()), 2500);
  }

  /* ---------------------------------------------------------------- loop */
  private loop = () => {
    requestAnimationFrame(this.loop);
    const t0 = performance.now();
    this.guard(() => this.frame(Math.min(this.clockDelta(), 1 / 20)));
    this.adapt(performance.now() - t0);
  };

  /** One failing part must not freeze the page (or leave the reader unable to
   *  close): run it guarded and report each distinct error once. */
  private frameErrors = new Set<string>();
  private guard(fn: () => void) {
    try { fn(); } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (!this.frameErrors.has(msg)) { this.frameErrors.add(msg); console.error(err); }
    }
  }
  private last = performance.now();
  private clockDelta() {
    const now = performance.now();
    const d = (now - this.last) / 1000;
    this.last = now;
    return d;
  }

  /** drop pixel ratio if frames run long; recover when there's headroom */
  private adapt(ms: number) {
    this.emaMs += (ms - this.emaMs) * 0.05;
    this.prTimer += 1;
    if (this.prTimer < 90) return;
    this.prTimer = 0;
    let pr = this.curPR;
    if (this.emaMs > 22 && pr > 1) pr = Math.max(1, pr - 0.25);
    else if (this.emaMs < 9 && pr < this.maxPR) pr = Math.min(this.maxPR, pr + 0.25);
    if (pr !== this.curPR) {
      this.curPR = pr;
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
  }

  /** the reading tilt — shared by the book and the magazine flying to it */
  private bookTilt(t: number) {
    const sway = this.reduce ? 0 : Math.sin(t * 0.5) * 0.006;
    return { x: -0.05 + this.parallax.y * 0.03, y: sway + this.parallax.x * 0.04 };
  }

  /** Read-only snapshot for automated end-to-end tests (window.app with ?e2e). */
  inspect() {
    const w = window.innerWidth, h = window.innerHeight;
    const box = new THREE.Box3(), c = new THREE.Vector3();
    const screen = (o: THREE.Object3D) => {
      o.updateWorldMatrix(true, false);
      box.setFromObject(o).getCenter(c).project(this.camera);
      return { x: Math.round((c.x * 0.5 + 0.5) * w), y: Math.round((-c.y * 0.5 + 0.5) * h) };
    };
    const items: Record<string, { x: number; y: number; settled: boolean }> = {};
    this.contents.items.forEach((it) => { items[it.id] = { ...screen(it.hit), settled: it.u > 0.985 && it.dim < 0.01 && it.sel < 0.01 }; });
    const r = this.reader;
    return {
      phase: this.phase, ready: this.ready, selected: this.selectedId, caption: this.captionId,
      colourway: this.cw.id, out: this.contents.isOut(), in: this.contents.isIn(),
      reader: { open: r.isOpen(), pos: +r.pos.toFixed(3), target: +r.targetStop().toFixed(3), stops: r.stops, zoom: +r.zoom.toFixed(2), single: r.single, pan: [+r.panX.toFixed(3), +r.panY.toFixed(3)] },
      bag: screen(this.bag.hitTargets()[0]), items, bookIssue: this.bookIssue, hover: this.hoverId,
      coversReady: !!this.photos && this.photos === this.photoCache[this.cw.id],
      memory: { ...this.renderer.info.memory, programs: this.renderer.info.programs?.length ?? 0 }, pixelRatio: this.curPR,
    };
  }

  /** what a click at (x, y) would pick — read-only, for tests */
  pickAt(x: number, y: number) {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [...this.bag.hitTargets()];
    if (this.phase === 'open' && this.contents.isOut()) targets.unshift(...this.contents.pickTargets());
    const hit = this.ray.intersectObjects(targets, false)[0];
    return hit ? (hit.object.userData.id as string) : null;
  }

  /** deterministic stepping for headless checks */
  step(frames = 1, dt = 1 / 60) { for (let i = 0; i < frames; i++) this.frame(dt); }

  private frame(dt: number) {
    const t = (this.time += dt);
    this.parallax.lerp(this.parallaxT, Math.min(1, dt * 2.5));
    const reading = this.phase === 'reading';

    // bag + contents (skipped while the reader fully covers them)
    const backstage = reading && this.closing < 0;
    this.bag.root.visible = this.contents.root.visible = this.wall.visible = !backstage;
    if (!backstage) this.guard(() => {
      if (!this.reduce) this.bag.parallax(this.parallax.x, this.parallax.y);
      this.bag.openAmt = this.contents.progress();
      // the wall shadow belongs to the hero shot; it clears as the bag opens
      // during the entrance drop the shadow fades in as the bag arrives
      if (!this.landed && this.ready && this.bag.lift() < 0.01) this.landed = true;
      const settled = this.landed ? 1 : THREE.MathUtils.clamp(1 - this.bag.lift() / 0.25, 0, 1);
      (this.wall.material as THREE.ShadowMaterial).opacity = 0.16 * (1 - this.bag.openAmt) * settled * (this.ready ? 1 : 0);
      this.contents.lean.copy(this.parallax);
      // hovering the closed bag lifts it a touch — an invitation to pick it up
      const lift = this.phase === 'closed' && this.hoverId === NET_BAG_ID && !this.drag.on ? 0.018 : 0;
      this.hoverLift += (lift - this.hoverLift) * Math.min(1, dt * 4);
      if (this.phase === 'closed' && this.ready) this.bag.setHandRest(this.handRest('closed').add(new THREE.Vector3(0, this.hoverLift, 0)), false);
      this.bag.colliders = this.contents.colliders();
      this.bag.update(dt, t);
      this.updateHover();
      const present = this.selectedId ? this.book.presentPose(this.camera, this.bookTilt(t)) : null;
      this.contents.update(dt, t, this.bag, this.camera, this.hoverId, this.selectedId, present);
      if (this.phase === 'open') {
        this.hud.placeTags(this.contents.tagAnchors(this.camera, window.innerWidth, window.innerHeight, this.hoverId));
      }
    });

    // camera — a slow, weighted follow with a whisper of parallax
    const cp = this.camPos.clone();
    if (!reading) {
      cp.x += this.parallax.x * 0.05;
      cp.y += -this.parallax.y * 0.03;
    }
    const k = Math.min(1, dt * (reading ? 4 : 2.2));
    this.camera.position.lerp(cp, k);
    this.lookAt.lerp(this.camLook, k);
    this.camera.lookAt(this.lookAt);

    // the book rides in front of the camera
    if (reading) {
      this.reader.update(dt);
      let st = this.reader.state();
      if (this.closing >= 0) {
        this.closing = Math.max(0, this.closing - dt * Math.max(2.5, this.closing * 3));
        st = { page: this.closing, focus: 0 };
        if (this.closing <= 0.001) this.finishExit();
      }
      if (this.phase === 'reading') {
        this.book.set(st.page, st.focus);
        const tilt = this.bookTilt(t);
        this.book.follow(this.camera, tilt.x, tilt.y, this.reader.zoom, this.reader.panX, this.reader.panY);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
