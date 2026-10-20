// Engine robustness: bounds, walls, purity and DOM isolation (test 22 plus edge cases).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRng } from '../../src/rng.js';
import {
  createFly, spawnFly, step, insetBox, clampToBounds, inwardNormal, cursorWeight, WALL_KAPPA,
} from '../../src/engine.js';
import { angleDiff } from '../../src/angles.js';
import { seedFor, DT, SIZE, P, circular, FLY_NUMERIC_FIELDS } from './helpers.js';

function expectFinite(f) {
  for (const k of FLY_NUMERIC_FIELDS) expect(Number.isFinite(f[k])).toBe(true);
}

function deepFreeze(o) {
  Object.freeze(o);
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return o;
}

describe('engine robustness', () => {
  it.each([
    [0.3, 3600],
    [1, 600],
    [-1, 600],
  ])('22. bounds: attraction %f, 5 flies, %i s in 800×600 with a random-walk cursor', (attraction, T) => {
    const p = P({ attraction });
    const rng = createRng(seedFor(22));
    const crng = createRng(seedFor(220));
    const env = { cursor: { x: 400, y: 300 }, bounds: { w: 800, h: 600 }, sizePx: SIZE };
    const box = insetBox(env.bounds, SIZE);
    let flies = Array.from({ length: 5 }, () => spawnFly(p, env, rng));
    let cursor = { x: 400, y: 300 };
    const modes = new Set();
    for (let k = 0; k < T / DT; k++) {
      cursor = {
        x: Math.min(800, Math.max(0, cursor.x + 15 * crng.normal())),
        y: Math.min(600, Math.max(0, cursor.y + 15 * crng.normal())),
      };
      env.cursor = k % 3000 < 300 ? null : cursor; // cursor leaves now and then
      flies = flies.map((f) => step(f, p, env, DT, rng));
      for (const f of flies) {
        modes.add(f.mode);
        if (!(f.x >= box.x0 && f.x <= box.x1 && f.y >= box.y0 && f.y <= box.y1)) {
          throw new Error(`fly outside inset bounds at step ${k}: ${f.x}, ${f.y}`);
        }
        if (!FLY_NUMERIC_FIELDS.every((key) => Number.isFinite(f[key]))) throw new Error(`non-finite state at step ${k}`);
      }
    }
    expect([...modes].sort()).toEqual(['reorient', 'run', 'stop']);
  });

  it('step is pure: never mutates its input', () => {
    const p = deepFreeze(P());
    const env = deepFreeze({ cursor: { x: 100, y: 100 }, bounds: { w: 800, h: 600 }, sizePx: SIZE });
    const rng = createRng(seedFor(221));
    let fly = deepFreeze(createFly({ x: 400, y: 300 }));
    for (let k = 0; k < 5000; k++) {
      const next = step(fly, p, env, DT, rng);
      expect(next).not.toBe(fly);
      fly = deepFreeze(next);
    }
  });

  it('non-positive or NaN dt changes nothing but the rng stream', () => {
    const p = P();
    const env = { cursor: null, bounds: { w: 800, h: 600 }, sizePx: SIZE };
    const fly = createFly({ x: 400, y: 300, theta: 1 });
    for (const dt of [0, -1, NaN]) {
      const next = step(fly, p, env, dt, createRng(seedFor(222)));
      expect(next).toEqual(fly);
    }
  });

  it('tiny bounds: a container smaller than the fly pins it at the centre', () => {
    const p = P({ attraction: 1 });
    const env = { cursor: { x: 0, y: 0 }, bounds: { w: 30, h: 20 }, sizePx: SIZE };
    const rng = createRng(seedFor(223));
    let fly = spawnFly(p, env, rng);
    for (let k = 0; k < 3000; k++) {
      fly = step(fly, p, env, DT, rng);
      expect(fly.x).toBe(15);
      expect(fly.y).toBe(10);
      expectFinite(fly);
    }
  });

  it('one pinned axis still walks along the other', () => {
    const p = P();
    const env = { cursor: null, bounds: { w: 800, h: 30 }, sizePx: SIZE };
    const rng = createRng(seedFor(224));
    let fly = spawnFly(p, env, rng);
    const xs = new Set();
    for (let k = 0; k < 3000; k++) {
      fly = step(fly, p, env, DT, rng);
      expect(fly.y).toBe(15);
      expect(fly.x).toBeGreaterThanOrEqual(SIZE / 2);
      expect(fly.x).toBeLessThanOrEqual(800 - SIZE / 2);
      xs.add(Math.round(fly.x));
    }
    expect(xs.size).toBeGreaterThan(50);
  });

  it('inward normals: single walls, corners weighted, and none away from walls', () => {
    const box = insetBox({ w: 1000, h: 800 }, SIZE);
    const m = 72;
    expect(inwardNormal(box.x0 + 10, 400, box, m)).toBeCloseTo(0, 12);
    expect(Math.abs(inwardNormal(box.x1 - 10, 400, box, m))).toBeCloseTo(Math.PI, 12);
    expect(inwardNormal(500, box.y0 + 10, box, m)).toBeCloseTo(Math.PI / 2, 12);
    expect(inwardNormal(500, box.y1 - 10, box, m)).toBeCloseTo(-Math.PI / 2, 12);
    expect(inwardNormal(box.x0 + 10, box.y0 + 10, box, m)).toBeCloseTo(Math.PI / 4, 12);
    // Closer to the left wall than the top: normal leans towards +x.
    const n = inwardNormal(box.x0 + 5, box.y0 + 50, box, m);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(Math.PI / 4);
    expect(inwardNormal(500, 400, box, m)).toBe(null);
    // Margin 0: only touching walls count.
    expect(inwardNormal(box.x0, 400, box, 0)).toBeCloseTo(0, 12);
    expect(inwardNormal(box.x0 + 1, 400, box, 0)).toBe(null);
  });

  it('hitting a wall clamps and forces a reorientation around the inward normal', () => {
    for (const wallMargin of [1.5, 0]) {
      const p = P({ wallMargin, wallGain: 0, rotDiffusion: 0, runMean: Infinity });
      const env = { cursor: null, bounds: { w: 1000, h: 800 }, sizePx: SIZE };
      const box = insetBox(env.bounds, SIZE);
      const targets = [];
      for (let i = 0; i < 4000; i++) {
        const rng = createRng(seedFor(2250 + i));
        const fly = createFly({ x: box.x0 + 0.5, y: 400, theta: Math.PI });
        const next = step(fly, p, env, DT, rng);
        expect(next.x).toBe(box.x0);
        expect(next.mode).toBe('reorient');
        targets.push(next.targetTheta);
      }
      const { mean: mu, R } = circular(targets);
      expect(Math.abs(mu)).toBeLessThan(0.05);
      // von Mises κ = 2 has R = I1(2)/I0(2) ≈ 0.698.
      expect(Math.abs(R - 0.698)).toBeLessThan(0.03);
      expect(WALL_KAPPA).toBe(2);
    }
  });

  it('wall steering turns a fly in the margin away from the wall', () => {
    const p = P({ rotDiffusion: 0, runMean: Infinity });
    const env = { cursor: null, bounds: { w: 1000, h: 800 }, sizePx: SIZE };
    const box = insetBox(env.bounds, SIZE);
    // Heading up along the left wall, inside the margin: should turn towards +x (θ increases from −π/2).
    const fly = createFly({ x: box.x0 + 10, y: 400, theta: -Math.PI / 2 });
    const next = step(fly, p, env, DT, createRng(seedFor(226)));
    expect(angleDiff(next.theta, fly.theta)).toBeGreaterThan(0);
    // Outside the margin there is no steering.
    const far = createFly({ x: 500, y: 400, theta: -Math.PI / 2 });
    expect(step(far, p, env, DT, createRng(seedFor(226))).theta).toBe(far.theta);
  });

  it('stop near a wall reorients away from it', () => {
    const p = P();
    const env = { cursor: null, bounds: { w: 1000, h: 800 }, sizePx: SIZE };
    const box = insetBox(env.bounds, SIZE);
    const fly = createFly({ x: box.x1 - 5, y: 400, mode: 'stop', stopTimer: 0.001 });
    const targets = [];
    for (let i = 0; i < 2000; i++) targets.push(step(fly, p, env, DT, createRng(seedFor(2270 + i))).targetTheta);
    expect(Math.abs(Math.abs(circular(targets).mean) - Math.PI)).toBeLessThan(0.06);
  });

  it('clampToBounds, spawnFly and cursorWeight', () => {
    const env = { cursor: null, bounds: { w: 400, h: 300 }, sizePx: SIZE };
    const c = clampToBounds(createFly({ x: 1000, y: -50 }), env);
    expect([c.x, c.y]).toEqual([400 - SIZE / 2, SIZE / 2]);
    const rng = createRng(seedFor(228));
    for (let i = 0; i < 100; i++) {
      const f = spawnFly(P(), env, rng);
      expect(f.x).toBeGreaterThanOrEqual(SIZE / 2);
      expect(f.x).toBeLessThanOrEqual(400 - SIZE / 2);
      expect(f.mode).toBe('run');
      expect(f.speedMul).toBeGreaterThanOrEqual(0.6);
      expect(f.speedMul).toBeLessThanOrEqual(1.4);
    }
    expect(cursorWeight(0, 400)).toBe(1);
    expect(cursorWeight(400, 400)).toBe(0.5);
  });

  it('createFly wraps theta and keeps the unwrapped accumulator', () => {
    const f = createFly({ theta: 3 * Math.PI });
    expect(f.theta).toBeCloseTo(Math.PI, 12);
    expect(f.thetaUnwrapped).toBe(3 * Math.PI);
  });

  it('debug builds assert finiteness', () => {
    const p = P({ speed: NaN });
    const env = { cursor: null, bounds: { w: 1000, h: 800 }, sizePx: SIZE };
    expect(() => step(createFly({ x: 500, y: 400 }), p, env, DT, createRng(1))).toThrow(/not finite/);
  });

  it('engine and animator import nothing from the DOM', () => {
    for (const file of ['engine.js', 'animator.js', 'rng.js', 'angles.js']) {
      const src = readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
      const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const i of imports) expect(['./angles.js', './rng.js']).toContain(i);
      expect(src).not.toMatch(/\b(window|document|navigator|requestAnimationFrame|performance)\b/);
    }
  });
});
