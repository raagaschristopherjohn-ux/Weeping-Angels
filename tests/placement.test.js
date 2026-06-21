import { describe, it, expect } from 'vitest';
import { dist, pickSpaced, pickFar, farthestFrom } from '../src/placement.js';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A grid of candidate cells spaced 5 apart.
function grid(n, step = 5) {
  const cells = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) cells.push({ x: i * step, z: j * step });
  return cells;
}

describe('dist', () => {
  it('is euclidean ground distance', () => {
    expect(dist({ x: 0, z: 0 }, { x: 3, z: 4 })).toBeCloseTo(5, 5);
  });
});

describe('pickSpaced', () => {
  it('returns the requested count', () => {
    const chosen = pickSpaced(mulberry32(1), grid(12), 5, { minSpacing: 10 });
    expect(chosen.length).toBe(5);
  });

  it('respects minSpacing when feasible', () => {
    const chosen = pickSpaced(mulberry32(3), grid(20), 5, { minSpacing: 12 });
    for (let i = 0; i < chosen.length; i++)
      for (let j = i + 1; j < chosen.length; j++)
        expect(dist(chosen[i], chosen[j])).toBeGreaterThanOrEqual(12);
  });

  it('respects avoid constraints', () => {
    const avoid = [{ x: 0, z: 0, dist: 20 }];
    const chosen = pickSpaced(mulberry32(9), grid(20), 5, { minSpacing: 8, avoid });
    for (const c of chosen) expect(dist(c, { x: 0, z: 0 })).toBeGreaterThanOrEqual(20);
  });

  it('still returns enough points when constraints are too tight (relaxes)', () => {
    // Impossible spacing for the space; should relax rather than under-deliver.
    const chosen = pickSpaced(mulberry32(2), grid(6), 5, { minSpacing: 999 });
    expect(chosen.length).toBe(5);
  });
});

describe('pickFar / farthestFrom', () => {
  it('picks a candidate at least minDist away when one exists', () => {
    const cells = grid(20); // up to ~95 units across
    const p = pickFar(mulberry32(4), cells, { x: 0, z: 0 }, 40);
    expect(dist(p, { x: 0, z: 0 })).toBeGreaterThanOrEqual(40);
  });

  it('farthestFrom returns the most distant candidate', () => {
    const cells = [
      { x: 0, z: 0 },
      { x: 5, z: 0 },
      { x: 100, z: 0 },
    ];
    expect(farthestFrom(cells, { x: 0, z: 0 })).toEqual({ x: 100, z: 0 });
  });
});
