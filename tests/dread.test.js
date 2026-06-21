import { describe, it, expect } from 'vitest';
import {
  computeDread,
  dreadProximity,
  DREAD_DANGER_RADIUS,
  DREAD_DECAY_RATE,
} from '../src/dread.js';

describe('dreadProximity', () => {
  it('is 0 when no unseen angel is in range', () => {
    expect(dreadProximity(Infinity)).toBe(0);
    expect(dreadProximity(DREAD_DANGER_RADIUS + 1)).toBe(0);
    expect(dreadProximity(DREAD_DANGER_RADIUS)).toBe(0);
  });

  it('is 1 at point-blank', () => {
    expect(dreadProximity(0)).toBe(1);
    expect(dreadProximity(-3)).toBe(1);
  });

  it('scales linearly with closeness', () => {
    expect(dreadProximity(DREAD_DANGER_RADIUS / 2)).toBeCloseTo(0.5, 5);
  });
});

describe('computeDread', () => {
  it('rises when an unseen angel is close', () => {
    const next = computeDread(0, 0.1, 2); // close
    expect(next).toBeGreaterThan(0);
  });

  it('decays when safe', () => {
    const next = computeDread(0.5, 0.1, Infinity);
    expect(next).toBeCloseTo(0.5 - DREAD_DECAY_RATE * 0.1, 5);
  });

  it('clamps to [0, 1]', () => {
    expect(computeDread(0.99, 10, 0)).toBe(1); // huge rise
    expect(computeDread(0.01, 10, Infinity)).toBe(0); // huge decay
  });

  it('never goes negative even with large dt while safe', () => {
    expect(computeDread(0, 5, Infinity)).toBe(0);
  });

  it('guards bad inputs (NaN current/dt, t=0)', () => {
    expect(computeDread(NaN, 0.1, 2)).toBeGreaterThanOrEqual(0);
    expect(computeDread(0.3, NaN, 2)).toBe(0.3); // dt invalid => no change
    expect(computeDread(0.3, 0, 2)).toBe(0.3); // dt=0 => no change
  });

  it('closer angels raise dread faster than distant ones', () => {
    const close = computeDread(0, 0.1, 1);
    const far = computeDread(0, 0.1, DREAD_DANGER_RADIUS - 1);
    expect(close).toBeGreaterThan(far);
  });
});
