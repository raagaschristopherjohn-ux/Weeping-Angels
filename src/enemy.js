/**
 * enemy.js
 * ---------
 * A "Weeping Angel". Frozen the instant it is observed; while unobserved it
 * takes discrete steps toward the player's last-known position on a timer, so
 * its motion reads clearly the moment you look back.
 *
 * Each Angel owns its observed state independently, so several can be evaluated
 * separately every frame.
 */
import * as THREE from 'three';

let _nextId = 0;

export class Enemy {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts]
   *   @param {number} [opts.stepDistance=1.1] metres per discrete step
   *   @param {THREE.Vector3} [opts.position] spawn position
   */
  constructor(scene, opts = {}) {
    this.id = _nextId++;
    this.scene = scene;
    this.stepDistance = opts.stepDistance ?? 1.1;

    this.seen = false;
    this.stepTimer = 0;

    // Discrete-but-animated stepping. A step lerps over stepDuration; if the
    // Angel is observed mid-step, all motion halts (true mid-step freeze) and
    // resumes only once it's unobserved again.
    this.stepping = false;
    this.stepProgress = 0;
    this.stepDuration = 0.28;
    this._stepFrom = new THREE.Vector3();
    this._stepTo = new THREE.Vector3();

    // Where the Angel "remembers" the player to be — updated each time it is
    // observed (it lunges toward where you last looked at it from).
    this.lastKnownPlayer = new THREE.Vector3();

    this._buildMesh(opts.position);
    scene.add(this.group);

    // Scratch vectors (avoid per-frame allocation).
    this._dir = new THREE.Vector3();
  }

  _buildMesh(position) {
    this.group = new THREE.Group();

    // Body: a cone (the classic "angel" silhouette placeholder).
    const bodyGeo = new THREE.ConeGeometry(0.55, 1.8, 5);
    this.material = new THREE.MeshStandardMaterial({
      color: 0xe8e8f0,
      roughness: 0.9,
      metalness: 0.05,
      // Faint self-glow so an Angel is always discernible in shadow.
      emissive: 0x2a2a33,
    });
    const body = new THREE.Mesh(bodyGeo, this.material);
    body.position.y = 0.9;
    this.group.add(body);

    // A small "head" sphere so it's clearly a figure, not a traffic cone.
    const headGeo = new THREE.SphereGeometry(0.28, 12, 10);
    const head = new THREE.Mesh(headGeo, this.material);
    head.position.y = 2.0;
    this.group.add(head);

    if (position) this.group.position.copy(position);
    this.radius = 0.55; // used as the visibility "body radius"
  }

  get position() {
    return this.group.position;
  }

  /** Plain {x,y,z} for the pure visibility check (uses chest height). */
  getSightPoint() {
    const p = this.group.position;
    // Aim the sight test at the torso, not the feet, so it reads naturally.
    return { x: p.x, y: p.y + 1.0, z: p.z };
  }

  /**
   * @param {number} dt seconds
   * @param {boolean} seen is this Angel currently observed?
   * @param {THREE.Vector3} playerPos
   * @param {number} stepIntervalSec how often to step when unseen
   * @param {number} speedMult difficulty speed multiplier (scales step distance)
   * @param {() => void} [onStep] called when a new step begins (for SFX)
   */
  update(dt, seen, playerPos, stepIntervalSec, speedMult = 1, onStep) {
    const wasSeen = this.seen;
    this.seen = seen;

    if (seen) {
      // Frozen. Remember where the player is right now, then do nothing —
      // this also freezes any in-progress step animation exactly where it is.
      this.lastKnownPlayer.copy(playerPos);
      if (!wasSeen) this._setObservedLook(true);
      return;
    }

    if (wasSeen) this._setObservedLook(false);

    // Continue an in-progress step.
    if (this.stepping) {
      this.stepProgress += dt / this.stepDuration;
      if (this.stepProgress >= 1) {
        this.stepProgress = 1;
        this.stepping = false;
      }
      this.group.position.lerpVectors(this._stepFrom, this._stepTo, this.stepProgress);
      this._faceTarget();
      return;
    }

    // Tick toward the next step.
    this.stepTimer += dt;
    if (this.stepTimer >= stepIntervalSec) {
      this.stepTimer = 0;
      this._beginStep(speedMult, onStep);
    }
  }

  _beginStep(speedMult, onStep) {
    this._dir.copy(this.lastKnownPlayer).sub(this.group.position);
    this._dir.y = 0;
    const dist = this._dir.length();
    if (dist < 1e-4) return; // already there

    this._dir.normalize();
    const stepLen = Math.min(this.stepDistance * speedMult, dist);

    this._stepFrom.copy(this.group.position);
    this._stepTo.copy(this.group.position).addScaledVector(this._dir, stepLen);
    this.stepProgress = 0;
    this.stepping = true;
    this._faceTarget();

    if (onStep) onStep();
  }

  _faceTarget() {
    // Rotate to face the direction of travel.
    this.group.rotation.y = Math.atan2(this._dir.x, this._dir.z);
  }

  /** Subtle visual tell when observed (red tint) vs. free (faint base glow). */
  _setObservedLook(observed) {
    this.material.emissive.setHex(observed ? 0x402020 : 0x2a2a33);
  }

  /** Straight-line ground distance to a point (for proximity checks). */
  distanceTo(pos) {
    const dx = this.group.position.x - pos.x;
    const dz = this.group.position.z - pos.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.material.dispose();
  }
}
