/**
 * audioManager.js
 * ----------------
 * 100% procedural Web Audio — no external files. Layers:
 *   1. Ambient bed   — 3 detuned low oscillators through an LFO-swept lowpass.
 *   2. Dread layers  — dissonant pad + noise hiss that fade in with the dread meter.
 *   3. Silence cue   — duck the whole atmosphere to near-zero just before a blink
 *                      or a close unseen-angel event, so a stinger lands in silence.
 *   4. Movement sound— bandpass-swept noise "stone grind" + sub-bass thump, fired
 *                      exactly on an angel's snap frame.
 *   5. Spatial       — movement/proximity/false cues run through HRTF PannerNodes
 *                      placed at the angel's world position.
 *   6. Heartbeat     — scheduled against AudioContext.currentTime (not setInterval),
 *                      BPM rising as the nearest unseen angel closes in.
 *   7. False cues    — occasional faint grind from a random direction, no real angel.
 *
 * Routing: ambient bed + dread layers -> atmosBus -> master. Heartbeat, stingers,
 * movement and false cues -> master directly, so ducking the atmosphere (silence
 * cue) never mutes the stinger that follows.
 */
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.atmosBus = null;
    this.enabled = false;

    this.ambient = null; // { oscs, filter, lfo, gain }
    this.dread = null; // { pad, hiss }
    this._noiseBuffer = null;

    // Heartbeat scheduler state.
    this.heartGain = null;
    this._heartNext = 0;
    this._heartRunning = false;
  }

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

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);

    this.atmosBus = this.ctx.createGain();
    this.atmosBus.gain.value = 1;
    this.atmosBus.connect(this.master);

    this.heartGain = this.ctx.createGain();
    this.heartGain.gain.value = 0.0;
    this.heartGain.connect(this.master);

    this._noiseBuffer = this._makeNoise(2);
    this.enabled = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---- (1)(2) ambient bed + dread layers ----

  startAmbient() {
    if (!this.enabled || this.ambient) return;
    const t = this.ctx.currentTime;

    // (1) Ambient bed: 55 / 56.5 / 110 Hz through an LFO-swept lowpass.
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.13, t + 2.5);
    gain.connect(this.atmosBus);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    filter.Q.value = 2;
    filter.connect(gain);

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start(t);

    const freqs = [55, 56.5, 110];
    const oscs = freqs.map((f) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(filter);
      o.start(t);
      return o;
    });

    this.ambient = { oscs, filter, lfo, lfoGain, gain };

    // (2) Dread pad: a dissonant cluster (minor 2nd + tritone) starting silent.
    const padGain = this.ctx.createGain();
    padGain.gain.value = 0.0;
    padGain.connect(this.atmosBus);
    const padFreqs = [110, 116.5, 155.6]; // ~m2 and tritone above 110
    const padOscs = padFreqs.map((f) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = this.ctx.createGain();
      og.gain.value = 0.33;
      o.connect(og).connect(padGain);
      o.start(t);
      return o;
    });

    // Dread hiss: filtered noise, starting silent.
    const hissGain = this.ctx.createGain();
    hissGain.gain.value = 0.0;
    hissGain.connect(this.atmosBus);
    const hiss = this.ctx.createBufferSource();
    hiss.buffer = this._noiseBuffer;
    hiss.loop = true;
    const hissFilter = this.ctx.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 1600;
    hissFilter.Q.value = 0.6;
    hiss.connect(hissFilter).connect(hissGain);
    hiss.start(t);

    this.dread = { padGain, padOscs, hissGain, hiss, hissFilter };
  }

  stopAmbient() {
    const t = this.ctx ? this.ctx.currentTime : 0;
    if (this.ambient) {
      const { oscs, lfo, gain } = this.ambient;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.4);
      [...oscs, lfo].forEach((o) => o.stop(t + 0.5));
      this.ambient = null;
    }
    if (this.dread) {
      const { padOscs, hiss, padGain, hissGain } = this.dread;
      padGain.gain.cancelScheduledValues(t);
      hissGain.gain.cancelScheduledValues(t);
      padGain.gain.linearRampToValueAtTime(0, t + 0.4);
      hissGain.gain.linearRampToValueAtTime(0, t + 0.4);
      padOscs.forEach((o) => o.stop(t + 0.5));
      hiss.stop(t + 0.5);
      this.dread = null;
    }
    this._heartRunning = false;
    if (this.heartGain) this.heartGain.gain.value = 0;
  }

  /** (2) Crossfade the dread layers up/down with the dread meter (0..1). */
  setDread(v) {
    if (!this.enabled || !this.dread) return;
    const t = this.ctx.currentTime;
    const clamp = Math.max(0, Math.min(1, v));
    this.dread.padGain.gain.setTargetAtTime(clamp * 0.07, t, 0.4);
    this.dread.hissGain.gain.setTargetAtTime(clamp * 0.05, t, 0.4);
  }

  // ---- (3) silence as a cue ----

  /**
   * Duck the entire atmosphere to near-zero for `durationSec`, then restore.
   * Call just before a forced blink or a close unseen-angel snap.
   */
  preEventSilence(durationSec = 0.4) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const g = this.atmosBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.0001, t + 0.05); // snap to silence
    g.setValueAtTime(0.0001, t + durationSec);
    g.linearRampToValueAtTime(1, t + durationSec + 0.25); // ease back
  }

  // ---- (4)(5) spatial angel movement sound ----

  _panner(x, y, z) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 3;
    p.maxDistance = 45;
    p.rolloffFactor = 1.1;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z); // older browsers
    }
    return p;
  }

  /**
   * (4) Stone-grind noise burst + sub-bass thump at the angel's world position,
   * spatialized via HRTF (5). Fired exactly on the snap frame.
   * @param {number} x @param {number} y @param {number} z world position
   * @param {number} [proximity=0] 0..1 (closer = louder/sharper)
   */
  angelMovementSound(x, y, z, proximity = 0) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const panner = this._panner(x, y, z);
    panner.connect(this.master);
    const vol = 0.25 + proximity * 0.5;

    // Grind: bandpass-swept noise, ~100ms.
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(1300, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.1);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    noise.connect(bp).connect(ng).connect(panner);
    noise.start(t);
    noise.stop(t + 0.13);

    // Sub-bass thump.
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(58, t);
    sub.frequency.exponentialRampToValueAtTime(36, t + 0.18);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(vol * 0.9, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    sub.connect(sg).connect(panner);
    sub.start(t);
    sub.stop(t + 0.22);
  }

  /**
   * (7) False cue: a faint grind from a random direction around the player, with
   * no real angel behind it. Keeps the player uneasy even when safe.
   * @param {{x:number,y:number,z:number}} playerPos
   */
  falseCue(playerPos) {
    if (!this.enabled) return;
    const ang = Math.random() * Math.PI * 2;
    const dist = 6 + Math.random() * 6;
    const x = playerPos.x + Math.cos(ang) * dist;
    const z = playerPos.z + Math.sin(ang) * dist;
    const t = this.ctx.currentTime;
    const panner = this._panner(x, 1.2, z);
    panner.connect(this.master);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(400, t + 0.09);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.12, t); // faint
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    noise.connect(bp).connect(ng).connect(panner);
    noise.start(t);
    noise.stop(t + 0.12);
  }

  // ---- (5) listener pose for HRTF ----

  /** Update the HRTF listener to the camera each frame. */
  updateListener(position, forward, up = { x: 0, y: 1, z: 0 }) {
    if (!this.enabled) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(position.x, t);
      L.positionY.setValueAtTime(position.y, t);
      L.positionZ.setValueAtTime(position.z, t);
      L.forwardX.setValueAtTime(forward.x, t);
      L.forwardY.setValueAtTime(forward.y, t);
      L.forwardZ.setValueAtTime(forward.z, t);
      L.upX.setValueAtTime(up.x, t);
      L.upY.setValueAtTime(up.y, t);
      L.upZ.setValueAtTime(up.z, t);
    } else {
      L.setPosition(position.x, position.y, position.z);
      L.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  // ---- (6) heartbeat scheduled via currentTime ----

  startHeartbeat() {
    if (!this.enabled) return;
    this._heartNext = this.ctx.currentTime + 0.1;
    this._heartRunning = true;
  }

  /**
   * Drive the heartbeat. Call every frame with the nearest UNSEEN angel distance.
   * BPM and volume rise as that angel closes in. Beats are scheduled ahead
   * against ctx.currentTime (sample-accurate), never via setInterval.
   */
  updateHeartbeat(nearestUnseenDist) {
    if (!this.enabled || !this._heartRunning) return;
    const t = this.ctx.currentTime;

    const range = 16;
    const prox =
      Number.isFinite(nearestUnseenDist) && nearestUnseenDist < range
        ? 1 - nearestUnseenDist / range
        : 0;
    const bpm = 48 + prox * 92; // 48 (calm) .. 140 (panic)
    const vol = 0.04 + prox * 0.5;
    this.heartGain.gain.setTargetAtTime(vol, t, 0.2);

    // If we fell behind (e.g. after a pause), resync.
    if (this._heartNext < t) this._heartNext = t + 0.05;

    const lookahead = 0.3;
    const interval = 60 / bpm;
    while (this._heartNext < t + lookahead) {
      this._scheduleBeat(this._heartNext);
      this._heartNext += interval;
    }
  }

  _scheduleBeat(time) {
    // lub-dub: two quick low thumps.
    this._thump(time, 55, 0.18);
    this._thump(time + 0.14, 44, 0.12);
  }

  _thump(time, freq, peak) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, time + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    osc.connect(g).connect(this.heartGain);
    osc.start(time);
    osc.stop(time + 0.18);
  }

  // ---- stingers ----

  loseStinger() {
    if (!this.enabled) return;
    const notes = [330, 277, 220, 165];
    notes.forEach((f, i) => this._note(f, i * 0.18, 0.4, 'triangle', 0.18));
  }

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
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  dispose() {
    this.stopAmbient();
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.enabled = false;
  }
}
