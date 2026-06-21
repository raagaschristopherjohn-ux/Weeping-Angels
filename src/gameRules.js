/**
 * gameRules.js
 * -------------
 * Pure win/lose evaluation, kept renderer-free for unit testing.
 *
 * Win condition (chosen): survive SURVIVE_SECONDS (90s) OR reach the exit beacon.
 *   We implement BOTH and the game uses whichever happens first — reaching the
 *   exit is an early-out escape hatch for bold players.
 * Lose condition: any Angel comes within LOSE_RADIUS of the player.
 */

export const SURVIVE_SECONDS = 90;
export const LOSE_RADIUS = 1.6; // metres; an Angel this close gets you
export const EXIT_RADIUS = 2.2; // metres; stand this close to the beacon to escape

function dist2D(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Has any enemy breached the lose radius?
 * @param {{x,z}} playerPos
 * @param {Array<{x,z}>} enemyPositions
 * @param {number} [radius=LOSE_RADIUS]
 * @returns {boolean}
 */
export function isCaught(playerPos, enemyPositions, radius = LOSE_RADIUS) {
  return enemyPositions.some((e) => dist2D(playerPos, e) <= radius);
}

/**
 * Has the player reached the exit beacon?
 * @param {{x,z}} playerPos
 * @param {{x,z}} exitPos
 * @param {number} [radius=EXIT_RADIUS]
 * @returns {boolean}
 */
export function reachedExit(playerPos, exitPos, radius = EXIT_RADIUS) {
  return dist2D(playerPos, exitPos) <= radius;
}

/**
 * Has the player survived long enough?
 * @param {number} elapsed seconds
 * @param {number} [target=SURVIVE_SECONDS]
 * @returns {boolean}
 */
export function survived(elapsed, target = SURVIVE_SECONDS) {
  return Number.isFinite(elapsed) && elapsed >= target;
}

/**
 * Single source of truth for game outcome. Loss takes priority over win, so a
 * player caught on the very last frame still loses (no cheap tie-break escape).
 *
 * @returns {{ status: 'playing'|'won'|'lost', reason: string|null }}
 */
export function evaluateGameState({ playerPos, enemyPositions, exitPos, elapsed }) {
  if (isCaught(playerPos, enemyPositions)) {
    return { status: 'lost', reason: 'caught' };
  }
  if (reachedExit(playerPos, exitPos)) {
    return { status: 'won', reason: 'exit' };
  }
  if (survived(elapsed)) {
    return { status: 'won', reason: 'survived' };
  }
  return { status: 'playing', reason: null };
}
