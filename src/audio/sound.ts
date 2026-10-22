/**
 * Minimal procedural audio. Everything is synthesised - no asset loading.
 *
 * The river ambience is a looping noise bed whose brightness and volume track
 * how close the player is to fast water; the waterfall adds a low roar.
 */

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private riverGain: GainNode | null = null;
  private riverFilter: BiquadFilterNode | null = null;
  private fallGain: GainNode | null = null;
  private fallFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private started = false;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.started) return;
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // --- noise source -----------------------------------------------------
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;   // brownish noise
      data[i] = last * 3.2;
    }
    this.noiseBuffer = buf;

    // --- river bed --------------------------------------------------------
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.riverFilter = this.ctx.createBiquadFilter();
    this.riverFilter.type = 'bandpass';
    this.riverFilter.frequency.value = 620;
    this.riverFilter.Q.value = 0.55;
    this.riverGain = this.ctx.createGain();
    this.riverGain.gain.value = 0.0;
    src.connect(this.riverFilter).connect(this.riverGain).connect(this.master);
    src.start();

    // --- waterfall --------------------------------------------------------
    const src2 = this.ctx.createBufferSource();
    src2.buffer = buf;
    src2.loop = true;
    src2.playbackRate.value = 0.72;
    this.fallFilter = this.ctx.createBiquadFilter();
    this.fallFilter.type = 'lowpass';
    this.fallFilter.frequency.value = 320;
    this.fallGain = this.ctx.createGain();
    this.fallGain.gain.value = 0;
    src2.connect(this.fallFilter).connect(this.fallGain).connect(this.master);
    src2.start();

    this.started = true;
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Ambience mix. `flow` 0..1, `fall` 0..1 (proximity to the waterfall). */
  setAmbience(flow: number, fall: number): void {
    if (!this.ctx || !this.riverGain || !this.fallGain || !this.riverFilter) return;
    const t = this.ctx.currentTime;
    this.riverGain.gain.setTargetAtTime(0.05 + flow * 0.3, t, 0.25);
    this.riverFilter.frequency.setTargetAtTime(420 + flow * 900, t, 0.3);
    this.fallGain.gain.setTargetAtTime(fall * 0.5, t, 0.3);
  }

  private burst(
    freq: number,
    dur: number,
    vol: number,
    type: BiquadFilterType = 'bandpass',
    q = 1.2,
    sweepTo?: number,
  ): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (sweepTo !== undefined) {
      filter.frequency.setValueAtTime(freq, t);
      filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    }
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  splash(strength = 1): void {
    this.burst(1400, 0.45 * strength + 0.15, 0.22 * strength, 'bandpass', 0.8, 380);
  }

  jump(): void {
    this.burst(600, 0.16, 0.1, 'bandpass', 1.6, 1500);
  }

  land(strength = 1): void {
    this.burst(320, 0.2, 0.12 * strength, 'lowpass', 1.0, 120);
  }

  grab(): void {
    this.burst(900, 0.12, 0.09, 'bandpass', 2.2, 1800);
  }

  paddle(): void {
    this.burst(1100, 0.3, 0.13, 'bandpass', 0.9, 300);
  }

  thud(strength = 1): void {
    this.burst(180, 0.3, 0.2 * strength, 'lowpass', 0.8, 70);
  }
}
