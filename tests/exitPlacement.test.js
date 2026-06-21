import { describe, it, expect } from 'vitest';
import {
  segmentOccluded,
  insideAnyBox,
  isValidExitSpot,
  pickExitSpot,
} from '../src/exitPlacement.js';

// A wall straddling the origin, between SW spawn and NE candidates.
const wall = { min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 4, z: 2 } };
const spawn = { x: -21, z: -21 };

describe('segmentOccluded', () => {
  it('detects a wall on the spawn->exit diagonal', () => {
    expect(segmentOccluded(spawn, { x: 21, z: 21 }, [wall])).toBe(true);
  });

  it('is false when nothing is in the way', () => {
    expect(segmentOccluded(spawn, { x: 21, z: 21 }, [])).toBe(false);
  });

  it('is false for a zero-length segment', () => {
    expect(segmentOccluded(spawn, { ...spawn }, [wall])).toBe(false);
  });
});

describe('insideAnyBox', () => {
  it('flags a point inside a box', () => {
    expect(insideAnyBox({ x: 0, z: 0 }, [wall])).toBe(true);
  });
  it('respects the margin', () => {
    expect(insideAnyBox({ x: 3, z: 0 }, [wall])).toBe(false);
    expect(insideAnyBox({ x: 3, z: 0 }, [wall], 1.5)).toBe(true);
  });
});

describe('isValidExitSpot', () => {
  const opts = { bounds: 22, minDistFromSpawn: 26, clearance: 1.8 };

  it('accepts a far, clear, hidden spot', () => {
    expect(isValidExitSpot({ x: 21, z: 21 }, spawn, [wall], opts)).toBe(true);
  });

  it('rejects out-of-bounds spots', () => {
    expect(isValidExitSpot({ x: 30, z: 0 }, spawn, [wall], opts)).toBe(false);
  });

  it('rejects spots too close to spawn', () => {
    expect(isValidExitSpot({ x: -18, z: -18 }, spawn, [wall], opts)).toBe(false);
  });

  it('rejects spots inside/too near an obstacle', () => {
    expect(isValidExitSpot({ x: 0, z: 0 }, spawn, [wall], opts)).toBe(false);
  });

  it('rejects spots visible from spawn when requireHidden', () => {
    // No occluder => not hidden => invalid.
    expect(isValidExitSpot({ x: 21, z: 21 }, spawn, [], opts)).toBe(false);
  });

  it('allows visible spots when requireHidden is false', () => {
    expect(
      isValidExitSpot({ x: 21, z: 21 }, spawn, [], { ...opts, requireHidden: false })
    ).toBe(true);
  });
});

describe('pickExitSpot', () => {
  it('returns a spot that passes validation (with a real-ish layout)', () => {
    const boxes = [
      { min: { x: -10, y: 0, z: -0.75 }, max: { x: 10, y: 4, z: 0.75 } },
      { min: { x: -0.75, y: 0, z: -10 }, max: { x: 0.75, y: 4, z: 10 } },
    ];
    const opts = { bounds: 22, minDistFromSpawn: 26, clearance: 1.8 };
    // Deterministic RNG sequence so the test is stable.
    let s = 0;
    const seq = [0.9, 0.92, 0.5, 0.5, 0.95, 0.96]; // pushes toward NE corner
    const rng = () => seq[s++ % seq.length];
    const spot = pickExitSpot(rng, spawn, boxes, opts);
    expect(isValidExitSpot(spot, spawn, boxes, opts)).toBe(true);
  });

  it('falls back to the opposite corner if no valid spot is found', () => {
    // requireHidden with no boxes => nothing validates => fallback.
    const spot = pickExitSpot(() => 0.5, spawn, [], { tries: 10 });
    expect(spot).toEqual({ x: 21, z: 21 });
  });
});
