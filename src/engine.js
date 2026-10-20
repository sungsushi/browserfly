// Pure behaviour engine (PLAN.md §4.4). No DOM access: all randomness comes from the
// injected rng and all time from the explicit dt.
import { wrapToPi, angleDiff } from './angles.js';

export const MAX_DT = 0.05;
export const REORIENT_TOLERANCE = 0.05;
export const WALL_KAPPA = 2;
export const LOGNORMAL_SIGMA = 0.6;
export const SPEED_MUL_MIN = 0.6;
export const SPEED_MUL_MAX = 1.4;

const PI = Math.PI;
const HALF_PI = Math.PI / 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** A fly state with every field set; `init` overrides the defaults. */
export function createFly(init = {}) {
  const theta = init.theta ?? 0;
  return {
    x: 0,
    y: 0,
    mode: 'run',
    speedMul: 1,
    stopTimer: 0,
    lingerTimer: 0,
    arrivalArmed: true,
    targetTheta: 0,
    phase: 0,
    clip: 'walk',
    frame: 0,
    idleTimer: 0,
    thetaUnwrapped: theta,
    ...init,
    theta: wrapToPi(theta),
  };
}

/** A fly at a random position inside the inset bounds with a random heading. */
export function spawnFly(params, env, rng) {
  const box = insetBox(env.bounds, env.sizePx);
  return createFly({
    x: rng.uniform(box.x0, box.x1),
    y: rng.uniform(box.y0, box.y1),
    theta: rng.vonMises(0, 0),
    speedMul: sampleSpeedMul(params, rng),
    phase: rng.next(),
  });
}

/**
 * Bounds inset by half a body length. An axis whose inset extent is ≤ 0 is pinned
 * to the centre of the box.
 */
export function insetBox(bounds, sizePx) {
  const half = sizePx / 2;
  const box = { x0: half, x1: bounds.w - half, y0: half, y1: bounds.h - half, pinX: false, pinY: false };
  if (box.x1 <= box.x0) {
    box.x0 = box.x1 = bounds.w / 2;
    box.pinX = true;
  }
  if (box.y1 <= box.y0) {
    box.y0 = box.y1 = bounds.h / 2;
    box.pinY = true;
  }
  return box;
}

/** Returns a copy of `fly` clamped into the inset bounds (used after a resize). */
export function clampToBounds(fly, env) {
  const box = insetBox(env.bounds, env.sizePx);
  return { ...fly, x: clamp(fly.x, box.x0, box.x1), y: clamp(fly.y, box.y0, box.y1) };
}

/** Cursor weight w(d) = 1 / (1 + (d/R)²); 0 with no cursor. */
export function cursorWeight(d, range) {
  const q = d / range;
  return 1 / (1 + q * q);
}

function cursorTerms(x, y, cursor, p) {
  if (!cursor) return { present: false, d: 0, phi: 0, w: 0, s: 0 };
  const dx = cursor.x - x;
  const dy = cursor.y - y;
  const d = Math.hypot(dx, dy);
  const w = cursorWeight(d, p.attractionRange);
  return { present: true, d, phi: Math.atan2(dy, dx), w, s: p.attraction * w };
}

// Calls fn(dist, inwardNormalAngle) for each wall on a non-pinned axis.
function forEachWall(x, y, box, fn) {
  if (!box.pinX) {
    fn(x - box.x0, 0);
    fn(box.x1 - x, PI);
  }
  if (!box.pinY) {
    fn(y - box.y0, HALF_PI);
    fn(box.y1 - y, -HALF_PI);
  }
}

// Weight of a wall at distance `dist` for a margin; with margin 0 only touching walls count.
function wallWeight(dist, margin) {
  if (margin > 0) return dist < margin ? 1 - Math.max(dist, 0) / margin : 0;
  return dist <= 0 ? 1 : 0;
}

function wallSteer(x, y, theta, box, margin, gain) {
  if (!(margin > 0) || gain === 0) return 0;
  let steer = 0;
  forEachWall(x, y, box, (dist, n) => {
    const wt = wallWeight(dist, margin);
    if (wt > 0) steer += gain * wt * Math.sin(n - theta);
  });
  return steer;
}

/** Inward normal angle near the walls (weighted sum near corners), or null if no wall is near. */
export function inwardNormal(x, y, box, margin) {
  let sx = 0;
  let sy = 0;
  forEachWall(x, y, box, (dist, n) => {
    const wt = wallWeight(dist, margin);
    if (wt > 0) {
      sx += wt * Math.cos(n);
      sy += wt * Math.sin(n);
    }
  });
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return null;
  return Math.atan2(sy, sx);
}

function sampleSpeedMul(p, rng) {
  return clamp(1 + p.speedJitter * rng.normal(), SPEED_MUL_MIN, SPEED_MUL_MAX);
}

function sampleStop(p, rng) {
  return p.stopDistribution === 'exp'
    ? rng.exponential(p.stopMean)
    : rng.lognormal(p.stopMean, LOGNORMAL_SIGMA);
}

function turn(f, delta) {
  f.theta = wrapToPi(f.theta + delta);
  f.thetaUnwrapped += delta;
}

function inArrival(f, p, c, sizePx) {
  return f.arrivalArmed && p.attraction > 0 && c.present && p.arrivalRadius > 0 &&
    c.d < p.arrivalRadius * sizePx;
}

function enterStop(f, p, rng) {
  f.mode = 'stop';
  f.stopTimer = sampleStop(p, rng);
  f.lingerTimer = 0;
}

function enterReorient(f, p, c, box, sizePx, rng, uniform) {
  f.mode = 'reorient';
  const n = inwardNormal(f.x, f.y, box, p.wallMargin * sizePx);
  if (n !== null) {
    f.targetTheta = rng.vonMises(n, WALL_KAPPA);
  } else if (uniform) {
    f.targetTheta = rng.vonMises(0, 0);
  } else {
    const mu = p.attraction >= 0 ? c.phi : c.phi + PI;
    f.targetTheta = rng.vonMises(mu, p.kappaMax * Math.abs(p.attraction) * c.w);
  }
}

function runStep(f, p, env, box, dt, rng) {
  const size = env.sizePx;
  const c = cursorTerms(f.x, f.y, env.cursor, p);
  const theta0 = f.theta;

  const drift = p.steeringGain * c.s * Math.sin(c.phi - theta0) +
    wallSteer(f.x, f.y, theta0, box, p.wallMargin * size, p.wallGain);
  turn(f, drift * dt + Math.sqrt(2 * p.rotDiffusion * dt) * rng.normal());

  const v = p.speed * size * f.speedMul;
  let x = f.x + v * Math.cos(f.theta) * dt;
  let y = f.y + v * Math.sin(f.theta) * dt;
  let hit = false;
  if (box.pinX) x = box.x0;
  else if (x < box.x0 || x > box.x1) {
    x = clamp(x, box.x0, box.x1);
    hit = true;
  }
  if (box.pinY) y = box.y0;
  else if (y < box.y0 || y > box.y1) {
    y = clamp(y, box.y0, box.y1);
    hit = true;
  }
  f.x = x;
  f.y = y;

  const lambda = (1 / p.runMean) * clamp(1 - p.klinokinesis * c.s * Math.cos(c.phi - theta0), 0.1, 3);
  const ended = rng.next() < -Math.expm1(-lambda * dt);

  const c1 = cursorTerms(x, y, env.cursor, p);
  if (hit) {
    enterReorient(f, p, c1, box, size, rng, false);
    return;
  }
  if (!f.arrivalArmed && (!c1.present || c1.d > 2 * p.arrivalRadius * size)) f.arrivalArmed = true;
  if (inArrival(f, p, c1, size)) {
    enterStop(f, p, rng);
    return;
  }
  if (ended) {
    if (rng.next() < p.stopProbability) enterStop(f, p, rng);
    else enterReorient(f, p, c1, box, size, rng, false);
  }
}

function stopStep(f, p, env, box, dt, rng) {
  const size = env.sizePx;
  const c = cursorTerms(f.x, f.y, env.cursor, p);
  f.stopTimer -= dt;
  const lingering = inArrival(f, p, c, size);
  if (lingering) f.lingerTimer += dt;
  if (f.stopTimer > 0) return;
  if (lingering && f.lingerTimer < p.lingerMax) return;
  if (lingering) {
    // Leaving after a full linger: disarm arrival and walk off in a uniform direction,
    // otherwise the fly would re-aim at the cursor it is sitting on and stop again.
    f.arrivalArmed = false;
    enterReorient(f, p, c, box, size, rng, true);
  } else {
    enterReorient(f, p, c, box, size, rng, false);
  }
}

function reorientStep(f, p, dt, rng) {
  const maxTurn = p.turnRate * dt;
  turn(f, clamp(angleDiff(f.targetTheta, f.theta), -maxTurn, maxTurn));
  if (Math.abs(angleDiff(f.targetTheta, f.theta)) < REORIENT_TOLERANCE) {
    f.mode = 'run';
    f.speedMul = sampleSpeedMul(p, rng);
    f.lingerTimer = 0;
  }
}

function assertFinite(f) {
  for (const k of ['x', 'y', 'theta', 'thetaUnwrapped', 'speedMul', 'stopTimer', 'lingerTimer', 'targetTheta']) {
    if (!Number.isFinite(f[k])) throw new Error(`fly.${k} is not finite: ${f[k]}`);
  }
}

/**
 * Advances one fly by dt seconds. Pure: returns a new state and never mutates `fly`.
 * env = { cursor: {x,y}|null, bounds: {w,h}, sizePx }.
 */
export function step(fly, params, env, dt, rng) {
  dt = dt > MAX_DT ? MAX_DT : dt > 0 ? dt : 0;
  const f = { ...fly };
  const box = insetBox(env.bounds, env.sizePx);
  if (f.mode === 'run') runStep(f, params, env, box, dt, rng);
  else if (f.mode === 'stop') stopStep(f, params, env, box, dt, rng);
  else reorientStep(f, params, dt, rng);
  if (__DEBUG__) assertFinite(f);
  return f;
}
