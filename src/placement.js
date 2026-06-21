/**
 * placement.js
 * -------------
 * Pure helpers for choosing randomized spawn/object positions from a set of
 * valid candidate cells, with min-distance constraints. Renderer-free + testable.
 */

export function dist(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/** Fisher–Yates shuffle into a new array, using the supplied rng. */
export function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pick a single random candidate. */
export function pickOne(rng, candidates) {
  return candidates[Math.floor(rng() * candidates.length)];
}

/**
 * Choose up to `count` candidates that are each at least `minSpacing` from one
 * another and respect every `avoid` constraint ({ x, z, dist }). Best-effort: if
 * constraints are too tight it relaxes spacing progressively rather than
 * returning fewer than `count` (so callers always get enough points).
 *
 * @param {() => number} rng
 * @param {Array<{x,z}>} candidates
 * @param {number} count
 * @param {object} [opts]
 *   @param {number} [opts.minSpacing=0]
 *   @param {Array<{x,z,dist}>} [opts.avoid=[]]
 * @returns {Array<{x,z}>}
 */
export function pickSpaced(rng, candidates, count, opts = {}) {
  const { minSpacing = 0, avoid = [] } = opts;
  const pool = shuffled(candidates, rng);

  const tryFill = (spacing, respectAvoid) => {
    const chosen = [];
    for (const c of pool) {
      if (chosen.length >= count) break;
      if (respectAvoid && avoid.some((a) => dist(c, a) < a.dist)) continue;
      if (chosen.some((ch) => dist(c, ch) < spacing)) continue;
      chosen.push(c);
    }
    return chosen;
  };

  // Progressive relaxation: full constraints → looser spacing → drop avoid.
  let chosen = tryFill(minSpacing, true);
  for (let s = minSpacing; chosen.length < count && s > 0; s *= 0.6) {
    chosen = tryFill(s * 0.6, true);
  }
  if (chosen.length < count) chosen = tryFill(0, true);
  if (chosen.length < count) chosen = tryFill(0, false);
  return chosen.slice(0, count);
}

/** The candidate farthest from a reference point (e.g. a distant beacon). */
export function farthestFrom(candidates, ref) {
  let best = candidates[0];
  let bestD = -Infinity;
  for (const c of candidates) {
    const d = dist(c, ref);
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Pick a position that is at least `minDist` from `ref`, biased toward farther
 * cells (samples a random one from the far half). Falls back to the farthest.
 */
export function pickFar(rng, candidates, ref, minDist) {
  const far = candidates.filter((c) => dist(c, ref) >= minDist);
  if (far.length) return pickOne(rng, far);
  return farthestFrom(candidates, ref);
}
