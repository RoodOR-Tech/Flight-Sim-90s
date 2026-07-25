// All sound is synthesized at runtime with the Web Audio API - no external audio files.
export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private afterburnerNoise: AudioBufferSourceNode | null = null;
  private afterburnerGain: GainNode | null = null;
  public muted = false;

  private ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.55;
    this.masterGain.connect(this.ctx.destination);
  }

  /** Must be called from a user gesture (e.g. clicking Start Mission) to satisfy autoplay policies. */
  resume() {
    this.ensureContext();
    this.ctx?.resume().catch(() => undefined);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.masterGain) this.masterGain.gain.value = m ? 0 : 0.55;
  }

  private noiseBuffer(duration: number): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  startEngine() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain || this.engineOsc) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.05;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    this.engineOsc = osc;
    this.engineGain = gain;

    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = this.noiseBuffer(2);
    noiseSrc.loop = true;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0;
    noiseSrc.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noiseSrc.start();
    this.afterburnerNoise = noiseSrc;
    this.afterburnerGain = noiseGain;
  }

  updateEngine(throttle01: number, afterburner: boolean) {
    if (!this.engineOsc || !this.engineGain || !this.ctx) return;
    const t = this.ctx.currentTime;
    const freq = 55 + throttle01 * 180 + (afterburner ? 60 : 0);
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.035 + throttle01 * 0.09, t, 0.1);
    if (this.afterburnerGain) {
      this.afterburnerGain.gain.setTargetAtTime(afterburner ? 0.09 : 0, t, 0.15);
    }
  }

  stopEngine() {
    this.engineOsc?.stop();
    this.engineOsc = null;
    this.afterburnerNoise?.stop();
    this.afterburnerNoise = null;
  }

  private playTone(freq: number, duration: number, type: OscillatorType = 'square', gainValue = 0.15, freqEnd?: number) {
    this.ensureContext();
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + duration);
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  cannonFire() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.09);
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(t);
  }

  missileLaunch() {
    this.playTone(220, 0.6, 'sawtooth', 0.18, 90);
  }

  radarLockTone() {
    this.playTone(1400, 0.12, 'square', 0.08);
  }

  lockAcquiredTone() {
    this.playTone(1800, 0.35, 'square', 0.1, 1800);
  }

  warningBeep() {
    this.playTone(880, 0.18, 'square', 0.14);
  }

  explosion() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(1.1);
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + 1.0);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(t);
  }

  touchdown() {
    this.playTone(140, 0.25, 'square', 0.25, 60);
  }

  arrestingWire() {
    this.ensureContext();
    if (!this.ctx || !this.masterGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.9);
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 400;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(t);
  }

  menuConfirm() {
    this.playTone(660, 0.09, 'square', 0.12, 990);
  }
}
