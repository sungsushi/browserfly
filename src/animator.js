// Pure animator (PLAN.md §4.5): maps body motion to stride phase and clip frames.
import { angleDiff } from './angles.js';

const TWO_PI = 2 * Math.PI;

/** Placeholder sheet metadata used until the real sprite sheet exists (M4). */
export const PLACEHOLDER_META = Object.freeze({
  version: 1,
  clips: Object.freeze({
    walk: Object.freeze({ row: 0, frames: 12, strideBL: 0.42, loop: true }),
    idle: Object.freeze({ row: 1, frames: 2 }),
  }),
});

export const IDLE_MIN = 0.5;
export const IDLE_MAX = 2;

function frameAt(phase, frames) {
  return Math.min(frames - 1, Math.floor(phase * frames));
}

/**
 * Updates phase, clip and frame from the change between `prevFly` and `fly`.
 * Pure: returns a new state. The idle timer draws from the injected rng.
 */
export function animate(fly, prevFly, meta, sizePx, dt, rng) {
  const f = { ...fly };
  const walk = meta.clips.walk;

  let phase = f.phase;
  if (prevFly.mode === 'run') {
    phase += Math.hypot(f.x - prevFly.x, f.y - prevFly.y) / (walk.strideBL * sizePx);
  } else if (prevFly.mode === 'reorient') {
    // Feet step in place: one full cycle per full turn.
    phase += Math.abs(angleDiff(f.theta, prevFly.theta)) / TWO_PI;
  }
  f.phase = phase - Math.floor(phase);

  if (f.mode === 'stop') {
    const idle = meta.clips.idle;
    if (prevFly.clip !== 'idle') {
      f.clip = 'idle';
      f.frame = 0;
      f.idleTimer = rng.uniform(IDLE_MIN, IDLE_MAX);
    } else if (idle.frames > 1) {
      f.idleTimer -= dt;
      if (f.idleTimer <= 0) {
        f.frame = (f.frame + 1) % idle.frames;
        f.idleTimer = rng.uniform(IDLE_MIN, IDLE_MAX);
      }
    }
    return f;
  }

  f.clip = f.mode === 'reorient' && meta.clips.turn ? 'turn' : 'walk';
  f.frame = frameAt(f.phase, meta.clips[f.clip].frames);
  return f;
}
