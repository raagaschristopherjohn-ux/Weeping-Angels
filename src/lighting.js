/**
 * lighting.js
 * ------------
 * Dim ambient base plus a flickering point light that follows the player, like
 * a failing lantern. The flicker is driven from the game loop via update(dt).
 */
import * as THREE from 'three';

export class Lighting {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    // Faint global fill so the room isn't pure black, but stays oppressive.
    this.ambient = new THREE.AmbientLight(0x223044, 0.38);
    scene.add(this.ambient);

    // A cold, dim moon-ish directional light for shape definition.
    this.moon = new THREE.DirectionalLight(0x405066, 0.15);
    this.moon.position.set(-1, 3, 2);
    scene.add(this.moon);

    // The player's flickering lantern.
    this.lantern = new THREE.PointLight(0xffe0a0, 2.2, 26, 2);
    this.lantern.position.set(0, 2.2, 0);
    scene.add(this.lantern);

    this._baseIntensity = 2.2;
    this._t = 0;
    // Pre-seeded noise phases so the flicker isn't a clean sine.
    this._phases = [1.7, 4.2, 9.1];
  }

  /**
   * @param {number} dt seconds since last frame
   * @param {THREE.Vector3} playerPos
   */
  update(dt, playerPos) {
    this._t += dt;

    // Layered sines + occasional sharp dropouts => candle-like flicker.
    const a = Math.sin(this._t * 11 + this._phases[0]);
    const b = Math.sin(this._t * 23 + this._phases[1]);
    const c = Math.sin(this._t * 37 + this._phases[2]);
    let flicker = 1 + 0.12 * a + 0.06 * b + 0.04 * c;

    // Rare deep dip for a heart-skip moment.
    if (Math.random() < 0.012) flicker *= 0.45;

    this.lantern.intensity = this._baseIntensity * flicker;

    // Keep the lantern just above and at the player.
    this.lantern.position.set(playerPos.x, 2.2, playerPos.z);
  }

  /** Briefly surge the light (used on win) or kill it (used on lose). */
  setMood(mood) {
    if (mood === 'lose') {
      this.lantern.color.set(0xff3030);
      this._baseIntensity = 0.6;
    } else if (mood === 'win') {
      this.lantern.color.set(0xa0ffd0);
      this._baseIntensity = 2.4;
    } else {
      this.lantern.color.set(0xffe0a0);
      this._baseIntensity = 2.2;
    }
  }
}
