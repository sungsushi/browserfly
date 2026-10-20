import { describe, it, expect } from 'vitest';
import { createRng, mulberry32 } from '../../src/rng.js';
import { seedFor, mean, sd, circular } from './helpers.js';

const draws = (fn, n) => Array.from({ length: n }, fn);

// I_ν(x) by its power series; plenty accurate for x = 4.
function besselI(nu, x) {
  let term = Math.pow(x / 2, nu);
  for (let k = 1; k <= nu; k++) term /= k;
  let sum = term;
  for (let k = 1; k < 60; k++) {
    term *= (x * x) / 4 / (k * (k + nu));
    sum += term;
  }
  return sum;
}

describe('rng', () => {
  it('1. determinism: same seed same sequence, different seeds differ', () => {
    const a = mulberry32(seedFor(1));
    const b = mulberry32(seedFor(1));
    const c = mulberry32(seedFor(2));
    const sa = draws(a, 1000);
    expect(draws(b, 1000)).toEqual(sa);
    expect(draws(c, 1000)).not.toEqual(sa);
    for (const v of sa) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('2. uniform: mean 0.5 ± 0.01 over 100k', () => {
    const rng = createRng(seedFor(2));
    expect(Math.abs(mean(draws(() => rng.next(), 100000)) - 0.5)).toBeLessThan(0.01);
    const u = draws(() => rng.uniform(-2, 4), 100000);
    expect(Math.abs(mean(u) - 1)).toBeLessThan(0.06);
  });

  it('3. normal: mean 0 ± 0.02, SD 1 ± 0.02 over 100k', () => {
    const rng = createRng(seedFor(3));
    const x = draws(() => rng.normal(), 100000);
    expect(Math.abs(mean(x))).toBeLessThan(0.02);
    expect(Math.abs(sd(x) - 1)).toBeLessThan(0.02);
  });

  it('4. exponential: mean 1 ± 0.02, CV 1 ± 0.03', () => {
    const rng = createRng(seedFor(4));
    const x = draws(() => rng.exponential(1), 100000);
    const m = mean(x);
    expect(Math.abs(m - 1)).toBeLessThan(0.02);
    expect(Math.abs(sd(x) / m - 1)).toBeLessThan(0.03);
  });

  it('5. lognormal parameterised by mean: sample mean within 3%', () => {
    const rng = createRng(seedFor(5));
    for (const target of [0.3, 1.2, 5]) {
      const x = draws(() => rng.lognormal(target, 0.6), 100000);
      expect(Math.abs(mean(x) / target - 1)).toBeLessThan(0.03);
    }
  });

  it('6. von Mises κ = 0: R < 0.02 over 50k, values in (−π, π]', () => {
    const rng = createRng(seedFor(6));
    const x = draws(() => rng.vonMises(1.0, 0), 50000);
    expect(circular(x).R).toBeLessThan(0.02);
    for (const v of x) {
      expect(v).toBeGreaterThan(-Math.PI);
      expect(v).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('6b. von Mises κ < 1e-6 ignores μ and uses one draw', () => {
    const a = createRng(seedFor(66));
    const b = createRng(seedFor(66));
    for (let i = 0; i < 100; i++) expect(a.vonMises(2.5, 1e-7)).toBe(b.vonMises(-1, 0));
    expect(a.next()).toBe(b.next());
  });

  it('7. von Mises κ = 4, μ = 1: circular mean ± 0.03, R = I1/I0 ± 0.01', () => {
    const expectedR = besselI(1, 4) / besselI(0, 4);
    expect(expectedR).toBeCloseTo(0.8635, 3);
    const rng = createRng(seedFor(7));
    const x = draws(() => rng.vonMises(1.0, 4), 50000);
    const { mean: m, R } = circular(x);
    expect(Math.abs(m - 1.0)).toBeLessThan(0.03);
    expect(Math.abs(R - expectedR)).toBeLessThan(0.01);
  });

  it('7b. von Mises is stable at small κ and wraps around ±π', () => {
    const rng = createRng(seedFor(77));
    const small = draws(() => rng.vonMises(0.5, 1e-5), 20000);
    for (const v of small) expect(Number.isFinite(v)).toBe(true);
    const nearPi = draws(() => rng.vonMises(Math.PI, 20), 20000);
    const { mean: m } = circular(nearPi);
    expect(Math.abs(Math.abs(m) - Math.PI)).toBeLessThan(0.03);
    for (const v of nearPi) {
      expect(v).toBeGreaterThan(-Math.PI);
      expect(v).toBeLessThanOrEqual(Math.PI);
    }
  });
});
