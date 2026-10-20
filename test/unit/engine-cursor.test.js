// Engine cursor attraction (tests 15–21). Cursor fixed at the centre of a 2000 × 2000 box;
// flies start on a ring of radius 600 with random headings.
import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/rng.js';
import { createFly, step } from '../../src/engine.js';
import {
  seedFor, DT, SIZE, P, mean, sd, se, median, circular, collectEpisodes,
} from './helpers.js';

const BOX = { w: 2000, h: 2000 };
const C = { x: 1000, y: 1000 };
const SEEDS = 200;
const dist = (f, c = C) => Math.hypot(f.x - c.x, f.y - c.y);

function ringFly(rng) {
  const a = rng.vonMises(0, 0);
  return createFly({ x: C.x + 600 * Math.cos(a), y: C.y + 600 * Math.sin(a), theta: rng.vonMises(0, 0) });
}

/** Steps one fly for up to T seconds; onStep(fly, prev, t) returning true stops early. */
function simulate(p, seed, T, { cursor = C, onStep } = {}) {
  const rng = createRng(seed);
  const env = { cursor, bounds: BOX, sizePx: SIZE };
  let fly = ringFly(rng);
  const steps = Math.round(T / DT);
  for (let k = 1; k <= steps; k++) {
    const prev = fly;
    fly = step(fly, p, env, DT, rng);
    if (onStep && onStep(fly, prev, k * DT)) break;
  }
  return fly;
}

function timeAvgDistance(p, seed, T = 120) {
  let sum = 0;
  let n = 0;
  simulate(p, seed, T, { onStep: (f) => { sum += dist(f); n++; } });
  return sum / n;
}

function timeToArrival(p, seed, cap) {
  const r = p.arrivalRadius * SIZE;
  let t = cap;
  simulate(p, seed, cap, { onStep: (f, _prev, time) => (dist(f) < r ? ((t = time), true) : false) });
  return t;
}

const seeds = (offset) => Array.from({ length: SEEDS }, (_, i) => seedFor(offset + i));

/** a below b by at least 3 standard errors of the difference. */
function expectBelowBy3SE(a, b, label) {
  const diff = mean(b) - mean(a);
  const seDiff = Math.hypot(se(a), se(b));
  console.log(`${label}: ${mean(a).toFixed(1)} vs baseline ${mean(b).toFixed(1)} px, ` +
    `diff ${diff.toFixed(1)} = ${(diff / seDiff).toFixed(1)} SE`);
  expect(diff).toBeGreaterThanOrEqual(3 * seDiff);
}

describe('engine: cursor attraction', () => {
  it('15. neutral: attraction 0 with a cursor is bit-identical to no cursor', () => {
    const p = P({ attraction: 0 });
    for (let i = 0; i < 20; i++) {
      const withCursor = [];
      const without = [];
      simulate(p, seedFor(1500 + i), 60, { cursor: C, onStep: (f) => { withCursor.push(f); } });
      simulate(p, seedFor(1500 + i), 60, { cursor: null, onStep: (f) => { without.push(f); } });
      expect(withCursor).toEqual(without);
      // toEqual treats +0/−0 alike; the trajectories must match bit for bit.
      for (let k = 0; k < without.length; k += 97) {
        for (const key of Object.keys(without[k])) expect(Object.is(withCursor[k][key], without[k][key])).toBe(true);
      }
    }
  });

  it('16. attraction 1: ≥ 95% of 200 seeds arrive within 60 s; mean cos(φ − θ) during runs > 0.5', () => {
    const p = P({ attraction: 1 });
    const r = p.arrivalRadius * SIZE;
    let arrived = 0;
    let cosSum = 0;
    let cosN = 0;
    for (const s of seeds(1600)) {
      let hit = false;
      simulate(p, s, 60, {
        onStep: (f, prev) => {
          if (prev.mode === 'run') {
            cosSum += Math.cos(Math.atan2(C.y - prev.y, C.x - prev.x) - prev.theta);
            cosN++;
          }
          return (hit = dist(f) < r);
        },
      });
      if (hit) arrived++;
    }
    console.log(`16: arrived ${arrived}/${SEEDS}, mean cos ${(cosSum / cosN).toFixed(3)}`);
    expect(arrived).toBeGreaterThanOrEqual(0.95 * SEEDS);
    expect(cosSum / cosN).toBeGreaterThan(0.5);
  });

  it('17. monotonic: median time-to-arrival strictly decreases over attraction 0.25, 0.5, 1', () => {
    const medians = [0.25, 0.5, 1].map((a) =>
      median(seeds(1700).map((s) => timeToArrival(P({ attraction: a }), s, 300))));
    console.log(`17: median arrival times ${medians.map((m) => m.toFixed(1)).join(', ')} s`);
    expect(medians[1]).toBeLessThan(medians[0]);
    expect(medians[2]).toBeLessThan(medians[1]);
  });

  it('18. repulsion: attraction −1 time-averaged distance ≥ 1.2 × the attraction 0 baseline', () => {
    const base = seeds(1800).map((s) => timeAvgDistance(P({ attraction: 0 }), s));
    const rep = seeds(1800).map((s) => timeAvgDistance(P({ attraction: -1 }), s));
    const ratio = mean(rep) / mean(base);
    console.log(`18: repulsion ${mean(rep).toFixed(1)} px vs baseline ${mean(base).toFixed(1)} px, ratio ${ratio.toFixed(3)}`);
    expect(ratio).toBeGreaterThanOrEqual(1.2);
  });

  it('19. falloff: cursor at 50·R is indistinguishable from no cursor', () => {
    const p = P({ attraction: 1, stopProbability: 0.5 });
    const far = p.attractionRange * 50;
    const near = collectEpisodes(p, {
      nRuns: 20010, seed: seedFor(19), cursorFn: (f) => ({ x: f.x + far, y: f.y }),
    });
    const none = collectEpisodes(p, { nRuns: 20010, seed: seedFor(19) });
    for (const { runs, targets } of [near, none]) {
      expect(Math.abs(mean(runs) / p.runMean - 1)).toBeLessThan(0.04);
      expect(Math.abs(sd(runs) / mean(runs) - 1)).toBeLessThan(0.06);
      expect(circular(targets).R).toBeLessThan(0.03);
    }
  });

  // Relaxed from the spec's 30 s (user decision, see PLAN.md test 20): with attraction 1,
  // steering curls a disarmed fly back, so 3–10 of 50 flies need longer than 30 s to escape.
  const LEAVE_CAP = 120;

  it(`20. lingering: stays ≥ lingerMax − dt, never lingers again until re-armed, leaves beyond 2·arrivalRadius within ${LEAVE_CAP} s`, () => {
    const p = P({ attraction: 1 });
    const r = p.arrivalRadius * SIZE;
    const leaveTimes = [];
    let reStops = 0;
    for (let i = 0; i < 50; i++) {
      const rng = createRng(seedFor(2000 + i));
      const env = { cursor: C, bounds: BOX, sizePx: SIZE };
      let fly = createFly({ x: C.x + 10, y: C.y, theta: rng.vonMises(0, 0) });
      fly = step(fly, p, env, DT, rng);
      expect(fly.mode).toBe('stop');
      let stopSteps = 0;
      while (fly.mode === 'stop') {
        fly = step(fly, p, env, DT, rng);
        stopSteps++;
        expect(stopSteps).toBeLessThan((p.lingerMax + 120) / DT);
      }
      expect(stopSteps * DT).toBeGreaterThanOrEqual(p.lingerMax - DT);
      expect(fly.arrivalArmed).toBe(false);
      let t = 0;
      while (dist(fly) <= 2 * r) {
        const prev = fly;
        fly = step(fly, p, env, DT, rng);
        t += DT;
        if (fly.mode === 'stop' && prev.mode !== 'stop' && dist(fly) < r) reStops++;
        // Until it escapes, the fly stays disarmed and never lingers again.
        if (dist(fly) <= 2 * r) expect(fly.arrivalArmed).toBe(false);
        expect(fly.lingerTimer).toBeLessThanOrEqual(prev.lingerTimer);
        if (t > LEAVE_CAP) break;
      }
      leaveTimes.push(t);
      if (t > LEAVE_CAP) continue;
      // Re-armed once beyond 2·arrivalRadius (the next run step re-arms).
      while (fly.mode !== 'run') fly = step(fly, p, env, DT, rng);
      if (dist(fly) > 2 * r) expect(step(fly, p, env, DT, rng).arrivalArmed).toBe(true);
    }
    const over30 = leaveTimes.filter((t) => t > 30).length;
    const late = leaveTimes.filter((t) => t > LEAVE_CAP).length;
    // Ordinary run-ending stops inside the radius are allowed (the spec keeps them); only arrival
    // stops/lingering are forbidden, which the disarmed + lingerTimer checks above enforce.
    console.log(`20: time to leave 2·arrivalRadius: median ${median(leaveTimes).toFixed(2)} s, ` +
      `max ${Math.max(...leaveTimes).toFixed(1)} s; ${over30}/${leaveTimes.length} took > 30 s; ` +
      `${reStops} ordinary (non-linger) stops inside the radius`);
    expect(late).toBe(0);
  });

  it('21. each mechanism isolated (arrivalRadius 0): control matches baseline; each term alone lowers distance by ≥ 3 SE', () => {
    const off = { arrivalRadius: 0, steeringGain: 0, klinokinesis: 0, kappaMax: 0 };
    const D = P();
    // 600 s per seed: at 120 s the klinokinesis-only effect is real but only ~2.7 SE on average,
    // so it fails the 3 SE criterion on most seed bases; at 600 s it is ~6 SE.
    const avg = (over) => seeds(2100).map((s) => timeAvgDistance(P({ ...off, ...over }), s, 600));

    const baseline = avg({ attraction: 0, steeringGain: D.steeringGain, klinokinesis: D.klinokinesis, kappaMax: D.kappaMax });
    const control = avg({ attraction: 1 });
    const seDiff = Math.hypot(se(control), se(baseline));
    console.log(`21 control: ${mean(control).toFixed(1)} vs baseline ${mean(baseline).toFixed(1)} px (SE of diff ${seDiff.toFixed(1)})`);
    expect(Math.abs(mean(control) - mean(baseline))).toBeLessThanOrEqual(3 * seDiff);

    expectBelowBy3SE(avg({ attraction: 1, kappaMax: D.kappaMax }), baseline, '21 kappaMax only');
    expectBelowBy3SE(avg({ attraction: 1, steeringGain: D.steeringGain }), baseline, '21 steeringGain only');
    expectBelowBy3SE(avg({ attraction: 1, klinokinesis: D.klinokinesis }), baseline, '21 klinokinesis only');
  });
});
