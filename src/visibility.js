/**
 * visibility.js
 * --------------
 * Pure "is this enemy being watched?" logic, deliberately free of Three.js so it
 * can be unit-tested in plain Node without a renderer or DOM.
 *
 * An enemy is SEEN only if BOTH are true:
 *   1. its center lies within the player's FOV cone (default ~75°), and
 *   2. a ray from the camera to the enemy reaches it without an obstacle in between.
 *
 * All vectors are plain { x, y, z } objects. The game layer converts Three.js
 * camera/objects into these before calling in.
 */

// ---- tiny vector helpers (no external deps) ----

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function normalize(a) {
  const len = length(a);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

/**
 * Ray vs axis-aligned bounding box (slab method).
 * Returns the distance along the ray to the first intersection, or Infinity
 * if the ray (within [0, maxDist]) never hits the box.
 *
 * @param {{x,y,z}} origin
 * @param {{x,y,z}} dir       normalized direction
 * @param {{min:{x,y,z}, max:{x,y,z}}} box
 * @param {number} maxDist
 */
export function rayAABB(origin, dir, box, maxDist = Infinity) {
  let tmin = 0;
  let tmax = maxDist;

  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis];
    const d = dir[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];

    if (Math.abs(d) < 1e-9) {
      // Ray is parallel to this slab: if the origin is outside it, no hit ever.
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

/**
 * Is `enemyPosition` currently seen by the camera?
 *
 * @param {object} cameraState
 *   @param {{x,y,z}} cameraState.position  camera world position (eye)
 *   @param {{x,y,z}} cameraState.forward   normalized look direction
 * @param {{x,y,z}} enemyPosition           enemy center
 * @param {Array<{min,max}>} obstacles      AABBs that can occlude the view
 * @param {object} [options]
 *   @param {number} [options.fovDegrees=75]   full cone angle of "vision"
 *   @param {number} [options.maxDistance=Infinity]  beyond this, treated as unseen
 *   @param {number} [options.enemyRadius=0]   widens the cone so a partly-framed
 *                                             enemy still counts as seen
 * @returns {boolean}
 */
export function isEnemySeen(cameraState, enemyPosition, obstacles = [], options = {}) {
  const { fovDegrees = 75, maxDistance = Infinity, enemyRadius = 0 } = options;

  const toEnemy = sub(enemyPosition, cameraState.position);
  const distance = length(toEnemy);

  // Edge case: enemy is essentially on top of the camera. You can't NOT see
  // something occupying your face — count it as seen (and the game will have
  // already triggered a loss at this proximity anyway).
  if (distance < 1e-6) return true;

  if (distance > maxDistance) return false;

  const dirToEnemy = {
    x: toEnemy.x / distance,
    y: toEnemy.y / distance,
    z: toEnemy.z / distance,
  };
  const forward = normalize(cameraState.forward);

  // --- (1) FOV cone test ---
  // cos of the angle between where we're looking and the enemy.
  const cosAngle = dot(forward, dirToEnemy);
  const clamped = Math.max(-1, Math.min(1, cosAngle));
  const angle = Math.acos(clamped); // radians, 0 = dead ahead

  // Edge case "enemy half in frame": we only have the enemy's center point, but a
  // body has width. We widen the half-FOV by the angular radius of the enemy
  // (atan(radius / distance)) so an Angel whose center is just outside the cone
  // but whose body edge pokes into view still registers as seen. With
  // enemyRadius=0 this reduces to a strict center-point test.
  const halfFovRad = (fovDegrees * Math.PI) / 180 / 2;
  const angularRadius = Math.atan2(enemyRadius, distance);
  if (angle > halfFovRad + angularRadius) return false;

  // --- (2) Occlusion test ---
  // Cast toward the enemy; if any obstacle is hit strictly before we reach the
  // enemy, the line of sight is blocked. Note: obstacles are static geometry
  // only — other Angels do NOT occlude each other by design, so one Angel can't
  // "hide" behind another. Each enemy is evaluated independently by the caller,
  // so "multiple enemies in view at once" is simply N independent calls.
  const epsilon = 1e-4;
  for (const box of obstacles) {
    const hit = rayAABB(cameraState.position, dirToEnemy, box, distance);
    if (hit < distance - epsilon) {
      return false; // something solid is between camera and enemy
    }
  }

  return true;
}
