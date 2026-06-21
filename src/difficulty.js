/**
 * difficulty.js
 * --------------
 * Pure difficulty-scaling formulas, isolated so they can be unit-tested without
 * any game state. Guarded against edge cases at and below t = 0.
 *
 * Exact curve (elapsed time `t` in seconds):
 *   - Enemy count:  start with 1, +1 every 20s, capped at 6.
 *                   activeEnemies(t) = clamp(1 + floor(t / 20), 1, 6)
 *                   => 1 at t∈[0,20), 2 at [20,40), 3 at [40,60) (>=3 by midgame),
 *                      4 at [60,80), 5 at [80,100), 6 at t>=100.
 *   - Enemy speed:  +5% of base every 15s, uncapped multiplier.
 *                   speedMultiplier(t) = 1 + 0.05 * floor(t / 15)
 *   - Step interval shrinks as speed grows (faster cadence), floored at 0.4s
 *                   to keep motion legible when re-observed.
 *   - Step distance: a tuned BASE_STEP_DISTANCE that grows with speedMultiplier,
 *                   so "+5% every 15s" applies to how far each snap carries the
 *                   angel. The base is large enough that one missed glance is
 *                   genuinely costly.
 */

export const MAX_ENEMIES = 6;
export const BASE_ENEMIES = 1;
export const ENEMY_INTERVAL_SECONDS = 20; // add an enemy this often
export const SPEED_INTERVAL_SECONDS = 15; // bump speed this often
export const SPEED_STEP = 0.05; // +5% per bump
export const BASE_STEP_DISTANCE = 1.7; // metres an angel snaps per step at t=0

// Objective-driven speed scaling (ties difficulty to player progress).
export const BASE_SPEED_BUMP = 1.25; // +25% baseline over the old base speed
export const PER_OBJECT_SPEED = 0.1; // +10% per collected object (≈+50% at 5)

/**
 * Number of Angels that should be active at elapsed time `t`.
 * @param {number} t elapsed seconds
 * @returns {number} integer in [BASE_ENEMIES, MAX_ENEMIES]
 */
export function activeEnemies(t) {
  // Guard: negative or non-finite time collapses to the base count.
  if (!Number.isFinite(t) || t <= 0) return BASE_ENEMIES;
  const count = BASE_ENEMIES + Math.floor(t / ENEMY_INTERVAL_SECONDS);
  return Math.min(MAX_ENEMIES, Math.max(BASE_ENEMIES, count));
}

/**
 * Speed multiplier applied to an Angel's base step distance at time `t`.
 * @param {number} t elapsed seconds
 * @returns {number} >= 1.0
 */
export function speedMultiplier(t) {
  // Guard: at or before t=0 (and for bad input) there is no bonus.
  if (!Number.isFinite(t) || t <= 0) return 1;
  return 1 + SPEED_STEP * Math.floor(t / SPEED_INTERVAL_SECONDS);
}

/**
 * How often (seconds) an unseen Angel takes a step. Derived from the speed
 * multiplier so the cadence quickens over time, but floored so a re-observed
 * Angel's motion still reads as discrete steps rather than a blur.
 * @param {number} t elapsed seconds
 * @param {number} [baseInterval=0.8] step interval at t=0
 * @param {number} [floor=0.4] minimum interval
 * @returns {number} seconds between steps
 */
export function stepInterval(t, baseInterval = 0.8, floor = 0.4) {
  const mult = speedMultiplier(t);
  return Math.max(floor, baseInterval / mult);
}

/**
 * How far (metres) an angel snaps in a single step at time `t`. Grows with the
 * speed multiplier so a missed glance later in the run costs more ground.
 * @param {number} t elapsed seconds
 * @param {number} [base=BASE_STEP_DISTANCE]
 * @returns {number}
 */
export function stepDistanceFor(t, base = BASE_STEP_DISTANCE) {
  return base * speedMultiplier(t);
}

/**
 * Full angel snap distance: the tuned base, a +25% baseline bump, the time-based
 * multiplier, AND a per-object multiplier (+10% per object collected). So an
 * angel is ~50% faster from objects alone by the 5th pickup, on top of the
 * baseline and time scaling.
 * @param {number} t elapsed seconds
 * @param {number} [objectsCollected=0]
 * @param {number} [base=BASE_STEP_DISTANCE]
 * @returns {number}
 */
export function angelStepDistance(t, objectsCollected = 0, base = BASE_STEP_DISTANCE) {
  const objs = Math.max(0, Number.isFinite(objectsCollected) ? objectsCollected : 0);
  const objMult = 1 + PER_OBJECT_SPEED * objs;
  return base * BASE_SPEED_BUMP * speedMultiplier(t) * objMult;
}
