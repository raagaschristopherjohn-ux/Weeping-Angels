import { describe, it, expect } from 'vitest';
import { generateMaze, allOpenReachable } from '../src/maze.js';

// Deterministic RNG so the tests are stable.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('generateMaze', () => {
  it('produces the expected wall-grid dimensions', () => {
    const m = generateMaze(10, 10, mulberry32(1), { cell: 5 });
    expect(m.gw).toBe(21);
    expect(m.gh).toBe(21);
    expect(m.cell).toBe(5);
  });

  it('has a solid border (out-of-bounds and edge cells are solid)', () => {
    const m = generateMaze(8, 8, mulberry32(2));
    expect(m.isSolidCell(0, 0)).toBe(true); // corner
    expect(m.isSolidCell(-1, 5)).toBe(true); // out of bounds
    expect(m.isSolidCell(m.gw, 5)).toBe(true);
  });

  it('GUARANTEES every open cell is reachable (key requirement)', () => {
    for (const seed of [1, 2, 3, 42, 1337, 9999]) {
      const m = generateMaze(10, 10, mulberry32(seed));
      expect(allOpenReachable(m)).toBe(true);
    }
  });

  it('exposes open walkable cells with world coordinates', () => {
    const m = generateMaze(10, 10, mulberry32(7), { cell: 5 });
    expect(m.openCellsWorld.length).toBeGreaterThan(50);
    for (const c of m.openCellsWorld) {
      expect(m.isSolidWorld(c.x, c.z)).toBe(false);
    }
  });

  it('segmentBlocked returns true when the ray leaves the maze', () => {
    const m = generateMaze(10, 10, mulberry32(5), { cell: 5 });
    const c = m.openCellsWorld[0];
    // Far outside the maze => must cross a wall / leave bounds.
    expect(m.segmentBlocked(c.x, c.z, c.x + 9999, c.z)).toBe(true);
  });

  it('segmentBlocked is false for a zero-length / same-cell ray', () => {
    const m = generateMaze(10, 10, mulberry32(6), { cell: 5 });
    const c = m.openCellsWorld[0];
    expect(m.segmentBlocked(c.x, c.z, c.x, c.z)).toBe(false);
  });
});
