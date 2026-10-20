/**
 * Procedural sound — no audio files. Subtle, off by default; the cover's
 * Sound toggle turns it on. Paper rustle on page-turns, a whoosh when the bag
 * opens, soft ticks on selection.
 */
const AudioCtor: (new () => AudioContext) | undefined =
  typeof window !== 'undefined' ? window.AudioContext || (window as any).webkitAudioContext : undefined;

export class Sound {
  /** Web Audio can be missing or switched off; then there is no Sound toggle */
  readonly supported = !!AudioCtor;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = false;

  private ensure(): boolean {
    if (!this.ctx) {
      if (!AudioCtor) return false;
      try {
        this.ctx = new AudioCtor();
      } catch {
        return false; // e.g. the browser refused another audio context
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { /* not allowed yet */ });
    return true;
  }

  /** call on any user gesture so the context is unlocked ahead of time */
  prime() { if (this.enabled) this.ensure(); }

  toggle(): boolean {
    if (!this.ensure()) return false;
    this.enabled = !this.enabled;
    const now = this.ctx!.currentTime;
    this.master!.gain.cancelScheduledValues(now);
    this.master!.gain.linearRampToValueAtTime(this.enabled ? 0.5 : 0, now + 0.15);
    if (this.enabled) this.tick(640, 0.05);
    return this.enabled;
  }

  private noise(dur: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  page() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    for (let k = 0; k < 2; k++) {
      const t = now + k * 0.055;
      const src = ctx.createBufferSource();
      src.buffer = this.noise(0.16);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 3000 + k * 1600; bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.42 - k * 0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      src.connect(bp); bp.connect(g); g.connect(this.master!);
      src.start(t); src.stop(t + 0.18);
    }
  }

  open() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 1;
    lp.frequency.setValueAtTime(300, now);
    lp.frequency.exponentialRampToValueAtTime(2400, now + 0.34);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.36, now + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    src.connect(lp); lp.connect(g); g.connect(this.master!);
    src.start(now); src.stop(now + 0.52);
  }

  tick(freq = 520, dur = 0.04) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.15, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    o.connect(g); g.connect(this.master!);
    o.start(now); o.stop(now + dur + 0.02);
  }
}
