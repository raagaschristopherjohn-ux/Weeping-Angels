/**
 * dread.js
 * ---------
 * Pure "dread meter" logic, renderer-free for unit testing. The meter rises
 * while an angel is close AND unseen (the genuinely dangerous situation) and
 * decays when the player is safe. Output is clamped to [0, 1] and drives the
 * vignette, desaturation, camera sway, and audio dread layers.
 */

export const DREAD_DANGER_RADIUS = 14; // metres; closer unseen angels build dread
export const DREAD_RISE_RATE = 0.55; // max units/sec added at point-blank
export const DREAD_DECAY_RATE = 0.35; // units/sec shed when safe

/**
 * @param {number} nearestUnseenDist distance to the closest UNSEEN angel
 *   (use Infinity if every angel is currently observed / none exist)
 * @param {number} [radius=DREAD_DANGER_RADIUS]
 * @returns {number} 0..1 threat proximity (1 = right on top of you)
 */
export function dreadProximity(nearestUnseenDist, radius = DREAD_DANGER_RADIUS) {
  if (!Number.isFinite(nearestUnseenDist) || nearestUnseenDist >= radius) return 0;
  if (nearestUnseenDist <= 0) return 1;
  return 1 - nearestUnseenDist / radius;
}

/**
 * Advance the dread meter by dt seconds.
 * @param {number} current current dread (0..1)
 * @param {number} dt seconds since last update
 * @param {number} nearestUnseenDist distance to nearest unseen angel (Infinity if none)
 * @param {object} [opts]
 * @returns {number} new dread, clamped to [0, 1]
 */
export function computeDread(current, dt, nearestUnseenDist, opts = {}) {
  const {
    radius = DREAD_DANGER_RADIUS,
    riseRate = DREAD_RISE_RATE,
    decayRate = DREAD_DECAY_RATE,
  } = opts;

  // Guard bad inputs (t=0, NaN dt, etc.) so the meter never corrupts.
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;

  const prox = dreadProximity(nearestUnseenDist, radius);

  let next;
  if (prox > 0) {
    next = safeCurrent + prox * riseRate * safeDt;
  } else {
    next = safeCurrent - decayRate * safeDt;
  }

  return Math.max(0, Math.min(1, next));
}
