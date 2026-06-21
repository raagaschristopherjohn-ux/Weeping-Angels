import { describe, it, expect } from 'vitest';
import {
  activeEnemies,
  speedMultiplier,
  stepInterval,
  stepDistanceFor,
  angelStepDistance,
  MAX_ENEMIES,
  BASE_ENEMIES,
  BASE_STEP_DISTANCE,
  BASE_SPEED_BUMP,
  PER_OBJECT_SPEED,
} from '../src/difficulty.js';
import {
  isCaught,
  reachedExit,
  survived,
  evaluateGameState,
  LOSE_RADIUS,
  EXIT_RADIUS,
  SURVIVE_SECONDS,
} from '../src/gameRules.js';

describe('activeEnemies curve (+1 every 20s, cap 6)', () => {
  it('starts at the base count at t=0', () => {
    expect(activeEnemies(0)).toBe(BASE_ENEMIES);
  });

  it('guards negative / NaN time', () => {
    expect(activeEnemies(-5)).toBe(BASE_ENEMIES);
    expect(activeEnemies(NaN)).toBe(BASE_ENEMIES);
    // Infinity is non-finite => treated as invalid input, collapses to base.
    expect(activeEnemies(Infinity)).toBe(BASE_ENEMIES);
  });

  it('adds one enemy every 20 seconds', () => {
    expect(activeEnemies(19.9)).toBe(1);
    expect(activeEnemies(20)).toBe(2);
    expect(activeEnemies(40)).toBe(3);
    expect(activeEnemies(60)).toBe(4);
  });

  it('reaches at least 3 enemies by midgame (t=45s of 90s)', () => {
    expect(activeEnemies(45)).toBeGreaterThanOrEqual(3);
  });

  it('caps at MAX_ENEMIES', () => {
    expect(activeEnemies(100)).toBe(MAX_ENEMIES);
    expect(activeEnemies(100000)).toBe(MAX_ENEMIES);
  });
});

describe('speedMultiplier curve (+5% every 15s)', () => {
  it('is 1.0 at t=0 and for bad input', () => {
    expect(speedMultiplier(0)).toBe(1);
    expect(speedMultiplier(-1)).toBe(1);
    expect(speedMultiplier(NaN)).toBe(1);
  });

  it('adds 5% every 15 seconds', () => {
    expect(speedMultiplier(14.9)).toBeCloseTo(1.0, 5);
    expect(speedMultiplier(15)).toBeCloseTo(1.05, 5);
    expect(speedMultiplier(30)).toBeCloseTo(1.1, 5);
    expect(speedMultiplier(90)).toBeCloseTo(1.3, 5);
  });
});

describe('stepInterval', () => {
  it('shrinks as time grows but never below the floor', () => {
    expect(stepInterval(0)).toBeCloseTo(0.8, 5);
    expect(stepInterval(15)).toBeCloseTo(0.8 / 1.05, 5);
    expect(stepInterval(100000, 0.8, 0.4)).toBe(0.4); // floored
  });
});

describe('stepDistanceFor (+5% snap distance every 15s)', () => {
  it('equals the base at t=0', () => {
    expect(stepDistanceFor(0)).toBeCloseTo(BASE_STEP_DISTANCE, 5);
  });

  it('grows with the speed multiplier', () => {
    expect(stepDistanceFor(15)).toBeCloseTo(BASE_STEP_DISTANCE * 1.05, 5);
    expect(stepDistanceFor(30)).toBeCloseTo(BASE_STEP_DISTANCE * 1.1, 5);
  });

  it('respects a custom base', () => {
    expect(stepDistanceFor(0, 2)).toBeCloseTo(2, 5);
  });
});

describe('angelStepDistance (baseline bump + per-object scaling)', () => {
  it('applies the +25% baseline at t=0 with no objects', () => {
    expect(angelStepDistance(0, 0)).toBeCloseTo(BASE_STEP_DISTANCE * BASE_SPEED_BUMP, 5);
  });

  it('adds +10% per object collected (~+50% at 5)', () => {
    const base = angelStepDistance(0, 0);
    expect(angelStepDistance(0, 1)).toBeCloseTo(base * 1.1, 5);
    expect(angelStepDistance(0, 5)).toBeCloseTo(base * 1.5, 5);
    expect(PER_OBJECT_SPEED).toBe(0.1);
  });

  it('stacks with the time-based multiplier', () => {
    // t=15 => speedMultiplier 1.05; 2 objects => 1.2
    const expected = BASE_STEP_DISTANCE * BASE_SPEED_BUMP * 1.05 * 1.2;
    expect(angelStepDistance(15, 2)).toBeCloseTo(expected, 5);
  });

  it('guards bad object counts', () => {
    const base = angelStepDistance(0, 0);
    expect(angelStepDistance(0, -3)).toBeCloseTo(base, 5);
    expect(angelStepDistance(0, NaN)).toBeCloseTo(base, 5);
  });
});

describe('win/lose rules — proximity (lose)', () => {
  const player = { x: 0, z: 0 };

  it('is caught when an enemy is within the lose radius', () => {
    expect(isCaught(player, [{ x: LOSE_RADIUS - 0.1, z: 0 }])).toBe(true);
  });

  it('is NOT caught when all enemies are outside the radius', () => {
    expect(isCaught(player, [{ x: LOSE_RADIUS + 0.1, z: 0 }])).toBe(false);
  });

  it('catches if ANY of several enemies is close', () => {
    const enemies = [
      { x: 10, z: 10 },
      { x: 0, z: LOSE_RADIUS - 0.2 },
      { x: -8, z: 3 },
    ];
    expect(isCaught(player, enemies)).toBe(true);
  });

  it('empty enemy list is never a catch', () => {
    expect(isCaught(player, [])).toBe(false);
  });
});

describe('win/lose rules — win conditions', () => {
  it('survived() triggers at the survive threshold', () => {
    expect(survived(SURVIVE_SECONDS - 0.1)).toBe(false);
    expect(survived(SURVIVE_SECONDS)).toBe(true);
    expect(survived(SURVIVE_SECONDS + 5)).toBe(true);
    expect(survived(NaN)).toBe(false);
  });

  it('reachedExit() triggers within the exit radius', () => {
    expect(reachedExit({ x: 0, z: 0 }, { x: 0, z: EXIT_RADIUS - 0.1 })).toBe(true);
    expect(reachedExit({ x: 0, z: 0 }, { x: 0, z: EXIT_RADIUS + 0.1 })).toBe(false);
  });
});

describe('evaluateGameState — combined outcome', () => {
  const exit = { x: 50, z: 50 };

  it('returns playing during normal play', () => {
    const r = evaluateGameState({
      playerPos: { x: 0, z: 0 },
      enemyPositions: [{ x: 20, z: 0 }],
      exitPos: exit,
      elapsed: 10,
    });
    expect(r.status).toBe('playing');
  });

  it('loss takes priority over a simultaneous survive-win', () => {
    const r = evaluateGameState({
      playerPos: { x: 0, z: 0 },
      enemyPositions: [{ x: 0.5, z: 0 }], // inside lose radius
      exitPos: exit,
      elapsed: SURVIVE_SECONDS + 1, // also "survived"
    });
    expect(r.status).toBe('lost');
    expect(r.reason).toBe('caught');
  });

  it('wins by reaching the exit', () => {
    const r = evaluateGameState({
      playerPos: { x: 50, z: 50 },
      enemyPositions: [{ x: 20, z: 0 }],
      exitPos: exit,
      elapsed: 5,
    });
    expect(r.status).toBe('won');
    expect(r.reason).toBe('exit');
  });

  it('wins by surviving the clock', () => {
    const r = evaluateGameState({
      playerPos: { x: 0, z: 0 },
      enemyPositions: [{ x: 20, z: 0 }],
      exitPos: exit,
      elapsed: SURVIVE_SECONDS,
    });
    expect(r.status).toBe('won');
    expect(r.reason).toBe('survived');
  });
});
