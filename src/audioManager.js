/**
 * audioManager.js
 * ----------------
 * All sound is generated procedurally with the Web Audio API — no external
 * files. Provides an ambient drone, a per-step "movement stinger" for when an
 * Angel takes a step, and win/lose stingers.
 *
 * The AudioContext must be created/resumed after a user gesture (browser
 * autoplay policy), so init() is called on the first click.
 */
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.droneNodes = null;
    this.enabled = false;
  }

  /** Lazily create the context (call from a user-gesture handler). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      console.warn('Web Audio API not available; running silent.');
      return;
    }
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.6;
    this.masterGain.connect(this.ctx.destination);
    this.enabled = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  /** Low, uneasy two-oscillator drone with a slow beating effect. */
  startDrone() {
    if (!this.enabled || this.droneNodes) return;
    const t = this.ctx.currentTime;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 2.5); // fade in
    gain.connect(this.masterGain);

    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 55; // A1

    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 55.7; // slight detune => slow beats

    // A slow LFO wobble on a lowpass filter for "breathing" dread.
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.1;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(filter.frequency);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);

    osc1.start(t);
    osc2.start(t);
    lfo.start(t);

    this.droneNodes = { osc1, osc2, lfo, gain, filter };
  }

  stopDrone() {
    if (!this.droneNodes) return;
    const { osc1, osc2, lfo, gain } = this.droneNodes;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.4);
    [osc1, osc2, lfo].forEach((o) => o.stop(t + 0.5));
    this.droneNodes = null;
  }

  /**
   * Short dissonant blip when an unseen Angel steps. Pitch scales subtly with
   * how close the stepping Angel is (closer = higher/sharper) for tension.
   * @param {number} [proximity=0] 0..1 where 1 is very close
   */
  movementStinger(proximity = 0) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = 180 + proximity * 320;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 0.6, t + 0.12);

    const gain = this.ctx.createGain();
    const vol = 0.05 + proximity * 0.1;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** Descending minor figure for the loss. */
  loseStinger() {
    if (!this.enabled) return;
    const notes = [330, 277, 220, 165];
    notes.forEach((f, i) => this._note(f, i * 0.18, 0.4, 'triangle', 0.18));
  }

  /** Rising bright figure for the escape. */
  winStinger() {
    if (!this.enabled) return;
    const notes = [262, 330, 392, 523];
    notes.forEach((f, i) => this._note(f, i * 0.14, 0.5, 'sine', 0.16));
  }

  _note(freq, delay, dur, type, vol) {
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  dispose() {
    this.stopDrone();
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.enabled = false;
  }
}
