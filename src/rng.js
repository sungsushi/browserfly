// Seeded PRNG (mulberry32) and the samplers used by the engine.
// Every sampler draws from the same uint32 stream, so a seed fully determines a simulation.
import { wrapToPi } from './angles.js';

const PI = Math.PI;
const TWO_PI = 2 * Math.PI;

/** Below this concentration the von Mises sampler returns a plain uniform draw. */
export const KAPPA_EPSILON = 1e-6;

/** Returns a function giving uniform floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Creates a PRNG with samplers. `seed` is a uint32. */
export function createRng(seed) {
  const next = mulberry32(seed);

  return {
    next,

    uniform(lo, hi) {
      return lo + (hi - lo) * next();
    },

    /** Standard normal via Box–Muller (two draws, no cached spare). */
    normal() {
      const u1 = 1 - next(); // (0, 1], safe for log
      const u2 = next();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);
    },

    exponential(mean) {
      return -mean * Math.log(1 - next());
    },

    /** Lognormal parameterised by its mean: μ = ln(mean) − σ²/2. */
    lognormal(mean, sigma) {
      const mu = Math.log(mean) - (sigma * sigma) / 2;
      return Math.exp(mu + sigma * this.normal());
    },

    /**
     * von Mises sample on (−π, π] (Best & Fisher 1979).
     * For κ < KAPPA_EPSILON this is a single uniform draw that ignores μ.
     */
    vonMises(mu, kappa) {
      if (!(kappa >= KAPPA_EPSILON)) return PI - TWO_PI * next();
      // a = 1 + sqrt(1 + 4κ²); b = (a − sqrt(2a)) / 2κ, rewritten to avoid cancellation at small κ.
      const s = Math.sqrt(1 + 4 * kappa * kappa);
      const a = 1 + s;
      const b = (a * 2 * kappa) / ((s + 1) * (a + Math.sqrt(2 * a)));
      const r = (1 + b * b) / (2 * b);
      let f;
      for (;;) {
        const z = Math.cos(PI * next());
        f = (1 + r * z) / (r + z);
        const c = kappa * (r - f);
        const u2 = next();
        if (c * (2 - c) - u2 > 0) break;
        if (u2 > 0 && Math.log(c / u2) + 1 - c >= 0) break;
      }
      const sign = next() < 0.5 ? -1 : 1;
      return wrapToPi(mu + sign * Math.acos(Math.max(-1, Math.min(1, f))));
    },
  };
}
