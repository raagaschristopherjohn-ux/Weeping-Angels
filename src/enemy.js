/**
 * enemy.js
 * ---------
 * A "Weeping Angel". Frozen the instant it is observed; while unobserved it
 * SNAPS a discrete distance toward the player's last-known position on a timer
 * (or on a forced blink) — it does NOT glide. The moment it re-enters view it
 * simply occupies a visibly different spot.
 *
 * The same lunging mesh is reused for inert decoy statues (opts.decoy), which
 * never move — forcing the player to actually watch rather than pattern-match.
 *
 * Each Angel owns its observed state independently.
 */
import * as THREE from 'three';

let _nextId = 0;

/**
 * Build a hunched, reaching angel figure from primitives. Asymmetric arms and a
 * forward-thrust head sell a mid-lunge pose. Faces +Z (rotated at runtime).
 * @param {number} poseSeed 0..1 jitters the pose so figures aren't identical
 * @returns {{ group: THREE.Group, material: THREE.MeshStandardMaterial }}
 */
export function buildAngelMesh(poseSeed = 0.5) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xe6e6ee,
    roughness: 0.92,
    metalness: 0.04,
    // Faint self-glow so a figure is always discernible in shadow.
    emissive: 0x24242c,
  });

  // Robe/torso: a tapered cylinder, hunched forward.
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.55, 1.5, 7),
    material
  );
  torso.position.set(0, 0.95, 0.1);
  torso.rotation.x = 0.28 + poseSeed * 0.12; // lean forward
  group.add(torso);

  // Skirt of the robe pooling at the base (wider, grounded).
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.9, 7), material);
  skirt.position.set(0, 0.4, 0);
  group.add(skirt);

  // Head: thrust forward and down (predatory hunch).
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), material);
  head.position.set(0, 1.62, 0.42);
  group.add(head);

  // Shoulders.
  const shoulders = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 10, 8),
    material
  );
  shoulders.position.set(0, 1.45, 0.12);
  shoulders.scale.set(1.3, 0.7, 1);
  group.add(shoulders);

  // Reaching arms — asymmetric: one arm higher/more extended than the other.
  const mkArm = (side, raise, reach) => {
    const arm = new THREE.Group();
    const upper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 0.95, 6),
      material
    );
    upper.rotation.x = Math.PI / 2; // point forward (+Z)
    upper.position.z = 0.45;
    arm.add(upper);
    // a clawed "hand"
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), material);
    hand.position.z = 0.95;
    hand.scale.set(1, 0.7, 1.3);
    arm.add(hand);

    arm.position.set(side * 0.32, 1.4 + raise, 0.18);
    arm.rotation.x = -0.5 - reach; // angle the reach forward/up
    arm.rotation.z = -side * 0.25;
    group.add(arm);
    return arm;
  };
  // Left arm reaches higher and farther; right arm lower — asymmetry.
  mkArm(-1, 0.18 + poseSeed * 0.1, 0.35 + poseSeed * 0.2);
  mkArm(1, -0.05, 0.1);

  return { group, material };
}

export class Enemy {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts]
   *   @param {number} [opts.stepDistance=1.7] metres per discrete snap
   *   @param {THREE.Vector3} [opts.position] spawn position
   *   @param {boolean} [opts.decoy=false] inert statue that never moves
   */
  constructor(scene, opts = {}) {
    this.id = _nextId++;
    this.scene = scene;
    this.stepDistance = opts.stepDistance ?? 1.7;
    this.decoy = !!opts.decoy;

    this.seen = false;
    this.stepTimer = 0;

    // Where the Angel "remembers" the player to be — updated each time it is
    // observed (it lunges toward where you last looked at it from).
    this.lastKnownPlayer = new THREE.Vector3();

    const poseSeed = Math.random();
    const built = buildAngelMesh(poseSeed);
    this.group = built.group;
    this.material = built.material;
    if (opts.position) this.group.position.copy(opts.position);
    // Random facing for decoys/spawns so they don't all point the same way.
    this.group.rotation.y = Math.random() * Math.PI * 2;
    this.radius = 0.55; // visibility "body radius"

    // Decoys read as slightly more weathered/static (very subtle tint).
    if (this.decoy) this.material.color.setHex(0xdedee6);

    scene.add(this.group);

    this._dir = new THREE.Vector3(); // scratch (avoid per-frame allocation)
  }

  get position() {
    return this.group.position;
  }

  /** Plain {x,y,z} for the pure visibility check (aimed at the torso). */
  getSightPoint() {
    const p = this.group.position;
    return { x: p.x, y: p.y + 1.0, z: p.z };
  }

  /**
   * @param {number} dt seconds
   * @param {boolean} seen is this Angel currently observed?
   * @param {THREE.Vector3} playerPos
   * @param {number} stepIntervalSec how often to step when unseen
   * @param {number} stepDistance metres to snap this step (difficulty-scaled)
   * @param {(enemy:Enemy)=>void} [onStep] called the instant a snap happens
   */
  update(dt, seen, playerPos, stepIntervalSec, stepDistance, onStep) {
    if (this.decoy) return; // statues never move

    const wasSeen = this.seen;
    this.seen = seen;

    if (seen) {
      // Frozen. Remember where the player is right now, then do nothing.
      this.lastKnownPlayer.copy(playerPos);
      if (!wasSeen) this._setObservedLook(true);
      return;
    }

    if (wasSeen) this._setObservedLook(false);

    this.stepTimer += dt;
    if (this.stepTimer >= stepIntervalSec) {
      this.stepTimer = 0;
      this._snap(stepDistance, onStep);
    }
  }

  /**
   * A guaranteed free move (used during a forced blink, when the whole screen
   * is black and every angel is effectively unseen).
   */
  forceStep(playerPos, stepDistance, onStep) {
    if (this.decoy) return;
    this.lastKnownPlayer.copy(playerPos);
    this.stepTimer = 0;
    this._snap(stepDistance, onStep);
  }

  /** Instantly move stepDistance toward the last-known player position. */
  _snap(stepDistance, onStep) {
    this._dir.copy(this.lastKnownPlayer).sub(this.group.position);
    this._dir.y = 0;
    const dist = this._dir.length();
    if (dist < 1e-4) return;

    this._dir.normalize();
    const stepLen = Math.min(stepDistance, dist);
    this.group.position.addScaledVector(this._dir, stepLen);
    this.group.rotation.y = Math.atan2(this._dir.x, this._dir.z); // face travel
    if (onStep) onStep(this);
  }

  /** Visual tell when observed (red tint) vs. free (faint base glow). */
  _setObservedLook(observed) {
    this.material.emissive.setHex(observed ? 0x3a1c1c : 0x24242c);
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
