/**
 * exitPlacement.js
 * -----------------
 * Pure helpers for randomly placing the exit beacon each run. A valid spot is:
 * in-bounds, far from the spawn, clear of obstacles, and (by default) hidden
 * from the spawn point by at least one obstacle — so reaching it still requires
 * turning away from danger. Renderer-free for unit testing.
 */
import { rayAABB } from './visibility.js';

/**
 * Is the straight ground line a->b blocked by any obstacle AABB?
 * @param {{x,z}} a @param {{x,z}} b
 * @param {Array<{min,max}>} boxes
 */
export function segmentOccluded(a, b, boxes) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return false;
  const dir = { x: dx / dist, y: 0, z: dz / dist };
  const origin = { x: a.x, y: 1.5, z: a.z }; // eye-ish height
  for (const box of boxes) {
    const t = rayAABB(origin, dir, box, dist);
    if (t < dist - 1e-3) return true;
  }
  return false;
}

/** Is point p inside any obstacle AABB (expanded by `margin`)? */
export function insideAnyBox(p, boxes, margin = 0) {
  return boxes.some(
    (b) =>
      p.x > b.min.x - margin &&
      p.x < b.max.x + margin &&
      p.z > b.min.z - margin &&
      p.z < b.max.z + margin
  );
}

/**
 * @param {{x,z}} p candidate exit spot
 * @param {{x,z}} spawn player spawn
 * @param {Array<{min,max}>} boxes obstacles
 * @param {object} [opts]
 * @returns {boolean}
 */
export function isValidExitSpot(p, spawn, boxes, opts = {}) {
  const {
    bounds = 22,
    minDistFromSpawn = 26,
    clearance = 1.8,
    requireHidden = true,
  } = opts;
  if (Math.abs(p.x) > bounds || Math.abs(p.z) > bounds) return false;
  if (Math.hypot(p.x - spawn.x, p.z - spawn.z) < minDistFromSpawn) return false;
  if (insideAnyBox(p, boxes, clearance)) return false;
  if (requireHidden && !segmentOccluded(spawn, p, boxes)) return false;
  return true;
}

/**
 * Rejection-sample a random valid exit spot. Falls back to the corner opposite
 * the spawn if no hidden spot is found within `tries`.
 * @param {() => number} rng returns 0..1 (e.g. Math.random)
 * @param {{x,z}} spawn
 * @param {Array<{min,max}>} boxes
 * @param {object} [opts]
 * @returns {{x:number, z:number}}
 */
export function pickExitSpot(rng, spawn, boxes, opts = {}) {
  const { bounds = 22, tries = 400 } = opts;
  for (let i = 0; i < tries; i++) {
    const p = { x: (rng() * 2 - 1) * bounds, z: (rng() * 2 - 1) * bounds };
    if (isValidExitSpot(p, spawn, boxes, opts)) return p;
  }
  // Fallback: opposite corner (guaranteed far, may not be hidden).
  return { x: -spawn.x, z: -spawn.z };
}
