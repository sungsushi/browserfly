import { describe, it, expect } from 'vitest';
import { wrapToPi, angleDiff, lerpAngle } from '../../src/angles.js';

const PI = Math.PI;

describe('8. angles', () => {
  it.each([
    [0, 0],
    [PI, PI],
    [-PI, PI],
    [3 * PI, PI],
    [-3 * PI, PI],
    [2 * PI, 0],
    [PI / 2, PI / 2],
    [-PI / 2, -PI / 2],
    [1.5 * PI, -PI / 2],
    [-1.5 * PI, PI / 2],
    [7, 7 - 2 * PI],
    [100, 100 - 32 * PI],
  ])('wrapToPi(%f) = %f', (a, expected) => {
    const w = wrapToPi(a);
    expect(w).toBeCloseTo(expected, 12);
    expect(w).toBeGreaterThan(-PI);
    expect(w).toBeLessThanOrEqual(PI);
  });

  it('wrapToPi(±π) is exactly π', () => {
    expect(wrapToPi(PI)).toBe(PI);
    expect(wrapToPi(-PI)).toBe(PI);
  });

  it.each([
    [3.1, -3.1, 6.2 - 2 * PI],
    [-3.1, 3.1, 2 * PI - 6.2],
    [1, 0, 1],
    [0, 1, -1],
    [PI / 2, -PI / 2, PI],
    [0.1, 2 * PI, 0.1],
  ])('angleDiff(%f, %f) = %f', (a, b, expected) => {
    expect(angleDiff(a, b)).toBeCloseTo(expected, 12);
  });

  it('angleDiff(3.1, −3.1) ≈ −0.083 (shortest path through π)', () => {
    expect(angleDiff(3.1, -3.1)).toBeCloseTo(-0.0832, 3);
  });

  it('lerpAngle takes the shortest path', () => {
    expect(lerpAngle(3.0, -3.0, 0.5)).toBeCloseTo(PI, 12);
    expect(lerpAngle(0, 1, 0.25)).toBeCloseTo(0.25, 12);
    expect(lerpAngle(0, 1, 0)).toBe(0);
  });
});
