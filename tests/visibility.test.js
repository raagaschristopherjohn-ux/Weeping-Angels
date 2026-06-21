import { describe, it, expect } from 'vitest';
import { isEnemySeen, rayAABB, normalize, dot, sub } from '../src/visibility.js';

// Camera at origin looking down -Z (Three.js default look direction).
const cam = () => ({ position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } });

describe('vector helpers', () => {
  it('normalizes a vector to unit length', () => {
    const n = normalize({ x: 0, y: 0, z: -5 });
    expect(n).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('normalize guards the zero vector', () => {
    expect(normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('dot and sub behave', () => {
    expect(dot({ x: 1, y: 2, z: 3 }, { x: 1, y: 0, z: -1 })).toBe(-2);
    expect(sub({ x: 5, y: 5, z: 5 }, { x: 1, y: 2, z: 3 })).toEqual({ x: 4, y: 3, z: 2 });
  });
});

describe('rayAABB', () => {
  const box = { min: { x: -1, y: -1, z: -6 }, max: { x: 1, y: 1, z: -4 } };

  it('hits a box dead ahead', () => {
    const t = rayAABB({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, box, Infinity);
    expect(t).toBeCloseTo(4, 5);
  });

  it('misses a box off to the side', () => {
    const t = rayAABB({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, box, Infinity);
    expect(t).toBe(Infinity);
  });

  it('respects maxDist (box beyond range = miss)', () => {
    const t = rayAABB({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, box, 3);
    expect(t).toBe(Infinity);
  });

  it('handles a ray parallel to a slab and outside it', () => {
    const t = rayAABB({ x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, box, Infinity);
    expect(t).toBe(Infinity);
  });
});

describe('isEnemySeen — FOV cone', () => {
  it('sees an enemy directly ahead', () => {
    expect(isEnemySeen(cam(), { x: 0, y: 0, z: -10 })).toBe(true);
  });

  it('does NOT see an enemy directly behind', () => {
    expect(isEnemySeen(cam(), { x: 0, y: 0, z: 10 })).toBe(false);
  });

  it('does NOT see an enemy at 90° (outside a 75° cone)', () => {
    expect(isEnemySeen(cam(), { x: 10, y: 0, z: 0 })).toBe(false);
  });

  it('sees an enemy just inside the cone edge', () => {
    // ~30° off-axis is inside half of a 75° cone (37.5°).
    const angle = (30 * Math.PI) / 180;
    const pos = { x: Math.sin(angle) * 10, y: 0, z: -Math.cos(angle) * 10 };
    expect(isEnemySeen(cam(), pos, [], { fovDegrees: 75 })).toBe(true);
  });

  it('does NOT see an enemy just outside the cone edge', () => {
    const angle = (40 * Math.PI) / 180; // > 37.5° half-cone
    const pos = { x: Math.sin(angle) * 10, y: 0, z: -Math.cos(angle) * 10 };
    expect(isEnemySeen(cam(), pos, [], { fovDegrees: 75 })).toBe(false);
  });

  it('respects a custom narrow FOV', () => {
    const angle = (35 * Math.PI) / 180;
    const pos = { x: Math.sin(angle) * 10, y: 0, z: -Math.cos(angle) * 10 };
    expect(isEnemySeen(cam(), pos, [], { fovDegrees: 60 })).toBe(false); // half = 30°
    expect(isEnemySeen(cam(), pos, [], { fovDegrees: 90 })).toBe(true); // half = 45°
  });
});

describe('isEnemySeen — edge case: enemy half in frame', () => {
  it('center just outside cone but body radius pokes in -> seen', () => {
    // 39° off-axis, just past the 37.5° half-cone with a point test...
    const angle = (39 * Math.PI) / 180;
    const distance = 5;
    const pos = { x: Math.sin(angle) * distance, y: 0, z: -Math.cos(angle) * distance };
    // strict point test: not seen
    expect(isEnemySeen(cam(), pos, [], { fovDegrees: 75, enemyRadius: 0 })).toBe(false);
    // with a body radius widening the cone: now seen
    expect(isEnemySeen(cam(), pos, [], { fovDegrees: 75, enemyRadius: 0.6 })).toBe(true);
  });
});

describe('isEnemySeen — occlusion', () => {
  const wall = { min: { x: -2, y: -2, z: -6 }, max: { x: 2, y: 2, z: -5 } };

  it('does NOT see an enemy hidden behind a wall', () => {
    expect(isEnemySeen(cam(), { x: 0, y: 0, z: -10 }, [wall])).toBe(false);
  });

  it('sees an enemy in front of the wall', () => {
    expect(isEnemySeen(cam(), { x: 0, y: 0, z: -3 }, [wall])).toBe(true);
  });

  it('sees an enemy when the wall is off to the side (no blocking)', () => {
    const sideWall = { min: { x: 5, y: -2, z: -6 }, max: { x: 7, y: 2, z: -5 } };
    expect(isEnemySeen(cam(), { x: 0, y: 0, z: -10 }, [sideWall])).toBe(true);
  });
});

describe('isEnemySeen — distance & degenerate cases', () => {
  it('does not see an enemy beyond maxDistance', () => {
    expect(isEnemySeen(cam(), { x: 0, y: 0, z: -100 }, [], { maxDistance: 50 })).toBe(false);
  });

  it('treats an enemy on top of the camera as seen', () => {
    expect(isEnemySeen(cam(), { x: 0, y: 0, z: 0 })).toBe(true);
  });
});

describe('isEnemySeen — multiple enemies are independent', () => {
  it('evaluates each enemy separately (one seen, one not)', () => {
    const enemies = [
      { x: 0, y: 0, z: -10 }, // ahead -> seen
      { x: 0, y: 0, z: 10 }, // behind -> not
    ];
    const results = enemies.map((e) => isEnemySeen(cam(), e));
    expect(results).toEqual([true, false]);
  });
});
