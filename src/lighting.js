/**
 * lighting.js
 * ------------
 * Low ambient + a narrow flashlight-style spotlight bound to the camera, so the
 * periphery is genuinely dark and the player can only ever light what they look
 * at directly. A short flicker can be pulsed on the exact frames angels are
 * allowed to move, so the player can't tell movement from a failing bulb.
 */
import * as THREE from 'three';

export class Lighting {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;

    // Just enough ambient to not be pitch black, but the periphery stays dark.
    this.ambient = new THREE.AmbientLight(0x2a3550, 0.32);
    scene.add(this.ambient);

    // Faint cold fill for shape definition.
    this.moon = new THREE.DirectionalLight(0x4a587a, 0.18);
    this.moon.position.set(-1, 3, 2);
    scene.add(this.moon);

    // Flashlight: a tight spotlight that tracks the camera's aim.
    this.flashlight = new THREE.SpotLight(0xfff0d8, 6.0, 38, 0.5, 0.45, 1.2);
    this.flashlight.position.set(0, 1.7, 0);
    this.flashTarget = new THREE.Object3D();
    scene.add(this.flashTarget);
    this.flashlight.target = this.flashTarget;
    scene.add(this.flashlight);

    // A small warm point light at the player so their immediate feet/body read.
    this.glowPad = new THREE.PointLight(0xffe6c0, 0.8, 6, 2);
    scene.add(this.glowPad);

    this._baseIntensity = 6.0;
    this._t = 0;
    this._phases = [1.7, 4.2, 9.1];
    this._pulse = 0; // transient flicker injection (0..1), decays each frame

    this._fwd = new THREE.Vector3();
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Camera} camera
   * @param {number} [dread=0] 0..1 — deepens the flicker when dread is high
   */
  update(dt, camera, dread = 0) {
    this._t += dt;

    // Base candle-like flicker, deepened by dread.
    const a = Math.sin(this._t * 11 + this._phases[0]);
    const b = Math.sin(this._t * 23 + this._phases[1]);
    const c = Math.sin(this._t * 37 + this._phases[2]);
    const depth = 0.05 + dread * 0.12;
    let flicker = 1 + depth * a + depth * 0.5 * b + depth * 0.3 * c;

    // Transient pulse (synced to angel-move moments) drops the light sharply.
    if (this._pulse > 0) {
      flicker *= 1 - 0.55 * this._pulse;
      this._pulse = Math.max(0, this._pulse - dt * 6);
    }

    this.flashlight.intensity = this._baseIntensity * flicker;
    this.glowPad.intensity = 0.8 * flicker;

    // Track the camera.
    if (camera) {
      const p = camera.position;
      this.flashlight.position.set(p.x, p.y, p.z);
      this.glowPad.position.set(p.x, p.y - 0.2, p.z);
      camera.getWorldDirection(this._fwd);
      this.flashTarget.position.set(
        p.x + this._fwd.x * 10,
        p.y + this._fwd.y * 10,
        p.z + this._fwd.z * 10
      );
    }
  }

  /** Inject a sharp flicker (used the instant angels are allowed to move). */
  pulseFlicker(strength = 1) {
    this._pulse = Math.min(1, this._pulse + strength);
  }

  setMood(mood) {
    if (mood === 'lose') {
      this.flashlight.color.set(0xff5050);
      this._baseIntensity = 3.0;
    } else if (mood === 'win') {
      this.flashlight.color.set(0xc0ffe0);
      this._baseIntensity = 8.0;
      this.ambient.intensity = 0.6;
    } else {
      this.flashlight.color.set(0xfff0d8);
      this._baseIntensity = 6.0;
      this.ambient.intensity = 0.32;
    }
  }
}
