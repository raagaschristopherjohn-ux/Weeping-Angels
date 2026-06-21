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
    // Global fill so you can always make out the room and where you're walking.
    this.ambient = new THREE.AmbientLight(0x6678a0, 0.95);
    scene.add(this.ambient);

    // A cool directional light for shape definition and floor visibility.
    this.moon = new THREE.DirectionalLight(0x8fa3c8, 0.6);
    this.moon.position.set(-1, 3, 2);
    scene.add(this.moon);

    // The player's flickering lantern (wide reach so nearby threats are visible).
    this.lantern = new THREE.PointLight(0xffe8c0, 4.0, 45, 2);
    this.lantern.position.set(0, 2.2, 0);
    scene.add(this.lantern);

    this._baseIntensity = 4.0;
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

    // Layered sines + occasional dips => candle-like flicker. Kept shallow so
    // the scene never goes dark enough to lose track of where you are.
    const a = Math.sin(this._t * 11 + this._phases[0]);
    const b = Math.sin(this._t * 23 + this._phases[1]);
    const c = Math.sin(this._t * 37 + this._phases[2]);
    let flicker = 1 + 0.06 * a + 0.03 * b + 0.02 * c;

    // Rare, mild dip for a heart-skip moment (no longer a near-blackout).
    if (Math.random() < 0.01) flicker *= 0.8;

    this.lantern.intensity = this._baseIntensity * flicker;

    // Keep the lantern just above and at the player.
    this.lantern.position.set(playerPos.x, 2.2, playerPos.z);
  }

  /** Briefly surge the light (used on win) or kill it (used on lose). */
  setMood(mood) {
    if (mood === 'lose') {
      this.lantern.color.set(0xff4040);
      this._baseIntensity = 2.0;
    } else if (mood === 'win') {
      this.lantern.color.set(0xb0ffd8);
      this._baseIntensity = 5.0;
    } else {
      this.lantern.color.set(0xffe8c0);
      this._baseIntensity = 4.0;
    }
  }
}
