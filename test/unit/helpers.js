// Shared helpers for the unit tests.
import { DEFAULTS } from '../../src/params.js';
import { createRng } from '../../src/rng.js';
import { createFly, step } from '../../src/engine.js';

/** Base seed offset; `npm run test:sweep` reruns the suite with FLY_SEED_BASE=1..20. */
export const SEED_BASE = Number(process.env.FLY_SEED_BASE ?? 0) >>> 0;

/** Seed n under the current base seed. */
export function seedFor(n) {
  return (Math.imul(SEED_BASE, 0x9e3779b1) + n) >>> 0;
}

export const DT = 1 / 60;
export const SIZE = 48;
export const BIG = { w: 1e6, h: 1e6 };

/** Engine params: defaults overlaid with `over` (not validated, so e.g. Infinity is allowed). */
export function P(over = {}) {
  return { ...DEFAULTS, ...over };
}

export function mean(a) {
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

export function variance(a) {
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) * (v - m);
  return s / (a.length - 1);
}

export function sd(a) {
  return Math.sqrt(variance(a));
}

/** Standard error of the mean. */
export function se(a) {
  return sd(a) / Math.sqrt(a.length);
}

export function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Circular mean direction and mean resultant length R. */
export function circular(angles) {
  let c = 0;
  let s = 0;
  for (const a of angles) {
    c += Math.cos(a);
    s += Math.sin(a);
  }
  return { mean: Math.atan2(s, c), R: Math.hypot(c, s) / angles.length };
}

/**
 * Runs one fly with no cursor (or a cursor placed by `cursorFn(fly)`) until `nRuns` runs have
 * ended. Returns run durations, stop durations, run-ending outcomes and reorientation targets.
 */
export function collectEpisodes(p, { dt = DT, nRuns, seed, cursorFn = null }) {
  const rng = createRng(seed);
  const env = { cursor: null, bounds: BIG, sizePx: SIZE };
  let fly = createFly({ x: BIG.w / 2, y: BIG.h / 2, theta: rng.vonMises(0, 0) });
  const runs = [];
  const stops = [];
  const targets = [];
  let endedInStop = 0;
  let runSteps = 0;
  let stopSteps = 0;
  while (runs.length < nRuns) {
    const prev = fly;
    env.cursor = cursorFn ? cursorFn(fly) : null;
    fly = step(fly, p, env, dt, rng);
    if (prev.mode === 'run') {
      runSteps++;
      if (fly.mode !== 'run') {
        runs.push(runSteps * dt);
        runSteps = 0;
        if (fly.mode === 'stop') endedInStop++;
      }
    } else if (prev.mode === 'stop') {
      stopSteps++;
      if (fly.mode !== 'stop') {
        stops.push(stopSteps * dt);
        stopSteps = 0;
      }
    }
    if (fly.mode === 'reorient' && prev.mode !== 'reorient') targets.push(fly.targetTheta);
  }
  return { runs, stops, targets, endedInStop };
}

/** Variance of thetaUnwrapped(t) − thetaUnwrapped(0) across n independent flies. */
export function diffusionVariance(p, { dt = DT, n, t, seed }) {
  const rng = createRng(seed);
  const env = { cursor: null, bounds: BIG, sizePx: SIZE };
  const steps = Math.round(t / dt);
  const deltas = new Array(n);
  for (let i = 0; i < n; i++) {
    let fly = createFly({ x: BIG.w / 2, y: BIG.h / 2, theta: rng.vonMises(0, 0) });
    const start = fly.thetaUnwrapped;
    for (let k = 0; k < steps; k++) fly = step(fly, p, env, dt, rng);
    deltas[i] = fly.thetaUnwrapped - start;
  }
  return variance(deltas);
}

export const FLY_NUMERIC_FIELDS = [
  'x', 'y', 'theta', 'thetaUnwrapped', 'speedMul', 'stopTimer', 'lingerTimer',
  'targetTheta', 'phase', 'frame', 'idleTimer',
];
