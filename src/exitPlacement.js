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
    // Keep the exit out of the open middle: it must sit in the outer ring.
    minPerimeter = 0,
    // Extra viewpoints the exit must ALSO be hidden from (e.g. arena centre).
    alsoHiddenFrom = [],
  } = opts;
  if (Math.abs(p.x) > bounds || Math.abs(p.z) > bounds) return false;
  if (Math.max(Math.abs(p.x), Math.abs(p.z)) < minPerimeter) return false;
  if (Math.hypot(p.x - spawn.x, p.z - spawn.z) < minDistFromSpawn) return false;
  if (insideAnyBox(p, boxes, clearance)) return false;
  if (requireHidden && !segmentOccluded(spawn, p, boxes)) return false;
  for (const vp of alsoHiddenFrom) {
    if (!segmentOccluded(vp, p, boxes)) return false;
  }
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
  const { bounds = 22, tries = 600 } = opts;

  // Edge-biased sample: one axis pinned near a wall (rng^2 keeps it close to the
  // perimeter), the other runs along that edge — never the open centre.
  const sample = () => {
    const along = (rng() * 2 - 1) * bounds;
    const depth = bounds - rng() * rng() * bounds * 0.45;
    const edge = Math.floor(rng() * 4);
    if (edge === 0) return { x: along, z: depth };
    if (edge === 1) return { x: along, z: -depth };
    if (edge === 2) return { x: depth, z: along };
    return { x: -depth, z: along };
  };

  // Try strict first, then progressively relax — but always keep it hidden from
  // spawn (requireHidden stays true) so it's never just sitting in plain view.
  const stages = [
    opts,
    { ...opts, alsoHiddenFrom: [] }, // drop "hidden from centre"
    { ...opts, alsoHiddenFrom: [], minPerimeter: 0 }, // drop the outer-ring rule
  ];
  for (const stage of stages) {
    for (let i = 0; i < tries; i++) {
      const p = sample();
      if (isValidExitSpot(p, spawn, boxes, stage)) return p;
    }
  }
  // Last resort: opposite corner (guaranteed far from spawn).
  return { x: -spawn.x, z: -spawn.z };
}
