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

    // Background music sequencer state.
    this.musicGain = null;
    this._musicRunning = false;
    this._musicNext = 0;
    this._musicStep = 0;
    this._musicStepDur = 0.55; // seconds per arpeggio step

    // Footstep scheduler state.
    this.footGain = null;
    this._footTimer = 0;
    this._footFlip = 0;
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

    // Master bus -> limiter -> destination. The limiter (a compressor tuned as a
    // brickwall-ish limiter) lets us push the mix louder without clipping.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.limiter.connect(this.ctx.destination);

    this.master = this.ctx.createGain();
    this.master.gain.value = 1.0; // louder; limiter catches peaks
    this.master.connect(this.limiter);

    this.atmosBus = this.ctx.createGain();
    this.atmosBus.gain.value = 1;
    this.atmosBus.connect(this.master);

    this.heartGain = this.ctx.createGain();
    this.heartGain.gain.value = 0.0;
    this.heartGain.connect(this.master);

    // Footsteps go straight to master (the player's own steps aren't spatialized).
    this.footGain = this.ctx.createGain();
    this.footGain.gain.value = 1.3;
    this.footGain.connect(this.master);

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
    gain.gain.linearRampToValueAtTime(0.22, t + 2.5); // louder ambient bed
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
    this.stopMusic();
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

  // ---- background music ----

  /**
   * Start a slow, looping, minor-key procedural score: a soft arpeggio over a
   * shifting low bass through a 4-bar progression (Am – F – C – Em). Scheduled
   * against ctx.currentTime so it stays in time and pauses cleanly with the
   * AudioContext. Routed through atmosBus so the silence cue ducks it too.
   */
  startMusic() {
    if (!this.enabled || this._musicRunning) return;
    const t = this.ctx.currentTime;
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.setValueAtTime(0, t);
    this.musicGain.gain.linearRampToValueAtTime(0.42, t + 2.5); // clearly audible
    // Straight to master so the score stays present (not ducked by silence cues).
    this.musicGain.connect(this.master);
    this._musicRunning = true;
    this._musicNext = t + 0.2;
    this._musicStep = 0;
  }

  stopMusic() {
    if (!this.musicGain) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
    this.musicGain.gain.linearRampToValueAtTime(0, t + 0.6);
    this._musicRunning = false;
    const g = this.musicGain;
    this.musicGain = null;
    setTimeout(() => g.disconnect(), 800);
  }

  /** Drive the music sequencer. Call every frame while playing. */
  updateMusic() {
    if (!this.enabled || !this._musicRunning || !this.musicGain) return;
    const t = this.ctx.currentTime;
    if (this._musicNext < t) this._musicNext = t + 0.05; // resync after a pause
    const lookahead = 0.6;
    while (this._musicNext < t + lookahead) {
      this._playMusicStep(this._musicNext, this._musicStep);
      this._musicNext += this._musicStepDur;
      this._musicStep++;
    }
  }

  _playMusicStep(time, step) {
    // 16-step arpeggio: 4 bars of 4 (Am, F, C, Em).
    const arp = [
      220.0, 261.63, 329.63, 261.63, // Am: A3 C4 E4 C4
      174.61, 220.0, 261.63, 220.0, // F:  F3 A3 C4 A3
      261.63, 329.63, 392.0, 329.63, // C:  C4 E4 G4 E4
      164.81, 196.0, 246.94, 196.0, // Em: E3 G3 B3 G3
    ];
    const bass = [110.0, 87.31, 130.81, 82.41]; // A2 F2 C2 E2 per bar

    const idx = step % arp.length;
    this._pluck(time, arp[idx], 0.16);

    // New bass note at the top of each 4-step bar.
    if (step % 4 === 0) {
      const bar = Math.floor((step % arp.length) / 4);
      this._bassNote(time, bass[bar], 0.22);
    }

    // Sparse, eerie high tone every other bar for unease (a held dissonance).
    if (step % 8 === 2) {
      this._pluck(time, 659.25, 0.05); // E5, faint and ringing
    }
  }

  _pluck(time, freq, peak) {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.9);
    osc.connect(g).connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.95);
  }

  _bassNote(time, freq, peak) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const sub = this.ctx.createOscillator(); // sub octave for warmth
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    const g = this.ctx.createGain();
    const dur = this._musicStepDur * 4;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(peak, time + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    sub.connect(g);
    g.connect(this.musicGain);
    osc.start(time);
    sub.start(time);
    osc.stop(time + dur + 0.05);
    sub.stop(time + dur + 0.05);
  }

  // ---- footsteps ----

  /**
   * Drive footsteps from the game loop. Pass whether the player is moving; steps
   * are emitted on a walking cadence and reset when the player stops, so a step
   * lands almost immediately when they start walking again.
   * @param {number} dt seconds
   * @param {boolean} moving
   */
  updateFootsteps(dt, moving) {
    if (!this.enabled) return;
    if (!moving) {
      // Prime so the next move triggers a step right away.
      this._footTimer = 0.34;
      return;
    }
    this._footTimer += dt;
    const interval = 0.42; // ~brisk walk
    if (this._footTimer >= interval) {
      this._footTimer = 0;
      this._footstep();
    }
  }

  /** A soft scuff (filtered noise) + a low body thud; alternates foot weight. */
  _footstep() {
    const t = this.ctx.currentTime;
    this._footFlip ^= 1;
    const weight = this._footFlip ? 1 : 0.82; // slight L/R variation

    // Scuff: short low-passed noise.
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.18 * weight, t + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    noise.connect(lp).connect(ng).connect(this.footGain);
    noise.start(t);
    noise.stop(t + 0.12);

    // Thud: a quick low sine for body weight.
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.16 * weight, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(og).connect(this.footGain);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  // ---- objective cues ----

  /** Bright rising blip when an object is collected. */
  pickupCue() {
    if (!this.enabled) return;
    this._note(523.25, 0, 0.12, 'triangle', 0.22); // C5
    this._note(783.99, 0.07, 0.16, 'triangle', 0.2); // G5
  }

  /** Confirming two-note chime when an object is placed into a beacon slot. */
  placeCue(slotIndex = 0) {
    if (!this.enabled) return;
    // Rises slightly per slot so filling all five feels like progress.
    const base = 440 * Math.pow(2, slotIndex / 12);
    this._note(base, 0, 0.18, 'sine', 0.22);
    this._note(base * 1.5, 0.08, 0.24, 'sine', 0.18);
  }

  /** Low shimmer when the beacon is first discovered. */
  discoverCue() {
    if (!this.enabled) return;
    [196, 294, 392, 588].forEach((f, i) =>
      this._note(f, i * 0.1, 0.6, 'sine', 0.18)
    );
  }

  /** Triumphant chord when the beacon activates (all slots filled). */
  beaconActivateCue() {
    if (!this.enabled) return;
    [392, 494, 587, 784].forEach((f) => this._note(f, 0, 1.2, 'sine', 0.2));
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
