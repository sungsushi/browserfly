// Engine statistics with no cursor and no walls in play (tests 10–14, 23, 24).
import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/rng.js';
import { createFly, step, MAX_DT, SPEED_MUL_MAX } from '../../src/engine.js';
import { angleDiff } from '../../src/angles.js';
import {
  seedFor, DT, SIZE, BIG, P, mean, sd, circular, collectEpisodes, diffusionVariance,
} from './helpers.js';

const runStats = (runs) => ({ mean: mean(runs), cv: sd(runs) / mean(runs) });

describe('engine statistics', () => {
  it('10. run speed: displacement after 10 s = speed·size·10 ± 0.1%', () => {
    const p = P({ rotDiffusion: 0, speedJitter: 0, runMean: Infinity });
    const rng = createRng(seedFor(10));
    const env = { cursor: null, bounds: BIG, sizePx: SIZE };
    const start = createFly({ x: 5e5, y: 5e5, theta: 0.7 });
    let fly = start;
    for (let i = 0; i < 600; i++) fly = step(fly, p, env, DT, rng);
    expect(fly.mode).toBe('run');
    const disp = Math.hypot(fly.x - start.x, fly.y - start.y);
    const expected = p.speed * SIZE * 10;
    expect(Math.abs(disp / expected - 1)).toBeLessThan(0.001);
  });

  it('11. rotational diffusion: Var[Δθ] at t = 5 s is 2·D_r·t ± 8% (10,000 flies)', () => {
    const p = P({ runMean: Infinity });
    const v = diffusionVariance(p, { n: 10000, t: 5, seed: seedFor(11) });
    const expected = 2 * p.rotDiffusion * 5;
    expect(Math.abs(v / expected - 1)).toBeLessThan(0.08);
  });

  it('12. run durations: mean = runMean ± 4%, CV = 1 ± 0.06 (20k runs)', () => {
    const p = P({ stopProbability: 0 });
    const { runs } = collectEpisodes(p, { nRuns: 20000, seed: seedFor(12) });
    const s = runStats(runs);
    expect(Math.abs(s.mean / p.runMean - 1)).toBeLessThan(0.04);
    expect(Math.abs(s.cv - 1)).toBeLessThan(0.06);
  });

  it.each(['lognormal', 'exp'])('13. stop durations (%s): mean = stopMean ± 4%, stop fraction ± 0.02', (dist) => {
    const p = P({ stopDistribution: dist, runMean: 0.1 });
    const { runs, stops, endedInStop } = collectEpisodes(p, { nRuns: 28000, seed: seedFor(13) });
    expect(stops.length).toBeGreaterThan(18000);
    expect(Math.abs(mean(stops) / p.stopMean - 1)).toBeLessThan(0.04);
    expect(Math.abs(endedInStop / runs.length - p.stopProbability)).toBeLessThan(0.02);
  });

  describe('14. reorientation', () => {
    it('bounded per-step turn, shortest direction, reaches target and enters run', () => {
      const p = P({ stopProbability: 0, runMean: 0.2 });
      const rng = createRng(seedFor(14));
      const env = { cursor: null, bounds: BIG, sizePx: SIZE };
      const maxTurn = p.turnRate * DT;
      const maxSteps = Math.ceil(Math.PI / maxTurn) + 2;
      let fly = createFly({ x: 5e5, y: 5e5 });
      let episodes = 0;
      let episodeSteps = 0;
      while (episodes < 2000) {
        const prev = fly;
        fly = step(fly, p, env, DT, rng);
        if (prev.mode !== 'reorient') continue;
        const turned = fly.thetaUnwrapped - prev.thetaUnwrapped;
        expect(Math.abs(turned)).toBeLessThanOrEqual(maxTurn + 1e-9);
        expect(Math.abs(angleDiff(fly.theta, prev.theta) - turned)).toBeLessThan(1e-9);
        const before = angleDiff(prev.targetTheta, prev.theta);
        if (Math.abs(before) > 1e-12) expect(Math.sign(turned)).toBe(Math.sign(before));
        episodeSteps++;
        if (fly.mode !== 'reorient') {
          expect(fly.mode).toBe('run');
          expect(Math.abs(angleDiff(fly.targetTheta, fly.theta))).toBeLessThan(0.05);
          expect(episodeSteps).toBeLessThanOrEqual(maxSteps);
          episodes++;
          episodeSteps = 0;
        }
      }
    });

    it('turns through ±π when that is shorter', () => {
      const p = P();
      const rng = createRng(seedFor(141));
      const env = { cursor: null, bounds: BIG, sizePx: SIZE };
      const fly = createFly({ x: 5e5, y: 5e5, theta: 3.0, mode: 'reorient', targetTheta: -3.0 });
      const next = step(fly, p, env, DT, rng);
      expect(next.thetaUnwrapped - fly.thetaUnwrapped).toBeCloseTo(p.turnRate * DT, 12);
      expect(next.theta).toBeGreaterThan(3.0);
    });

    it('with no cursor, target headings are uniform (R < 0.03 over 20k)', () => {
      const p = P({ stopProbability: 0.5, runMean: 0.2 });
      const { targets } = collectEpisodes(p, { nRuns: 20010, seed: seedFor(142) });
      expect(targets.length).toBeGreaterThanOrEqual(20000);
      expect(circular(targets).R).toBeLessThan(0.03);
    });
  });

  describe('23. dt invariance', () => {
    it.each([1 / 30, 1 / 144])('dt = %f: run-duration mean/CV and diffusion variance within tests 11–12 tolerances', (dt) => {
      const p = P({ stopProbability: 0 });
      const { runs } = collectEpisodes(p, { dt, nRuns: 20000, seed: seedFor(23) });
      const s = runStats(runs);
      expect(Math.abs(s.mean / p.runMean - 1)).toBeLessThan(0.04);
      expect(Math.abs(s.cv - 1)).toBeLessThan(0.06);

      const v = diffusionVariance(P({ runMean: Infinity }), { dt, n: 10000, t: 5, seed: seedFor(231) });
      expect(Math.abs(v / (2 * p.rotDiffusion * 5) - 1)).toBeLessThan(0.08);
    });
  });

  it('24. large dt: dt = 5 behaves exactly like dt = 0.05', () => {
    const p = P({ speedJitter: 0.5 });
    const env = { cursor: { x: 5e5 + 300, y: 5e5 }, bounds: BIG, sizePx: SIZE };
    for (let i = 0; i < 50; i++) {
      const fly = createFly({ x: 5e5, y: 5e5, theta: i * 0.37, speedMul: SPEED_MUL_MAX });
      const a = step(fly, p, env, 5, createRng(seedFor(240 + i)));
      const b = step(fly, p, env, MAX_DT, createRng(seedFor(240 + i)));
      expect(a).toEqual(b);
      const v = p.speed * SIZE * fly.speedMul;
      expect(Math.hypot(a.x - fly.x, a.y - fly.y)).toBeLessThanOrEqual(0.05 * v * 1.01);
    }
  });
});
