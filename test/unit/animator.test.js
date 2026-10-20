import { describe, it, expect } from 'vitest';
import { createRng } from '../../src/rng.js';
import { createFly } from '../../src/engine.js';
import { animate, PLACEHOLDER_META, IDLE_MIN, IDLE_MAX } from '../../src/animator.js';
import { seedFor, DT, SIZE } from './helpers.js';

const META = PLACEHOLDER_META;
const WALK = META.clips.walk;
const STRIDE_PX = WALK.strideBL * SIZE;

/** Moves a running fly along +x by `perStep` px for `n` steps, counting frame changes. */
function walk(start, perStep, n, rng) {
  let fly = start;
  let changes = 0;
  for (let i = 0; i < n; i++) {
    const prev = fly;
    // Keep coordinates small so float error in the distance cannot accumulate.
    const moved = { ...prev, x: perStep, y: 0 };
    fly = animate(moved, { ...prev, x: 0, y: 0 }, META, SIZE, DT, rng);
    if (fly.frame !== prev.frame) changes++;
  }
  return { fly, changes };
}

describe('animator', () => {
  it('25. one stride advances exactly walk.frames frame changes and returns to the start frame', () => {
    const rng = createRng(seedFor(25));
    const phase0 = 0.5 / WALK.frames;
    const start = createFly({ phase: phase0, frame: 0 });
    for (const k of [37, 40, 12, 101]) {
      const { fly, changes } = walk(start, STRIDE_PX / k, k, rng);
      expect(changes).toBe(WALK.frames);
      expect(fly.frame).toBe(start.frame);
      expect(fly.clip).toBe('walk');
    }
    const half = walk(start, STRIDE_PX / 40, 20, rng);
    expect(Math.abs(half.changes - WALK.frames / 2)).toBeLessThanOrEqual(1);
  });

  it('26. stillness: zero distance in run keeps the frame; stop shows idle frames only', () => {
    const rng = createRng(seedFor(26));
    let fly = createFly({ phase: 0.3, frame: 3 });
    for (let i = 0; i < 100; i++) {
      const next = animate(fly, fly, META, SIZE, DT, rng);
      expect(next.frame).toBe(3);
      expect(next.phase).toBe(0.3);
      fly = next;
    }

    // Enter stop from a run: idle clip, frame 0, timer in [0.5, 2).
    fly = animate({ ...fly, mode: 'stop' }, fly, META, SIZE, DT, rng);
    expect(fly.clip).toBe('idle');
    expect(fly.frame).toBe(0);
    expect(fly.idleTimer).toBeGreaterThanOrEqual(IDLE_MIN);
    expect(fly.idleTimer).toBeLessThan(IDLE_MAX);

    // Idle frames change on the slow timer, never faster than IDLE_MIN.
    const seen = new Set();
    let lastChange = 0;
    for (let i = 1; i <= 60 * 30; i++) {
      const next = animate(fly, fly, META, SIZE, DT, rng);
      expect(next.clip).toBe('idle');
      expect(next.frame).toBeGreaterThanOrEqual(0);
      expect(next.frame).toBeLessThan(META.clips.idle.frames);
      if (next.frame !== fly.frame) {
        expect((i - lastChange) * DT).toBeGreaterThanOrEqual(IDLE_MIN - 1e-9);
        lastChange = i;
      }
      seen.add(next.frame);
      fly = next;
    }
    expect(seen.size).toBe(META.clips.idle.frames);
  });

  it('single-frame idle never changes frame', () => {
    const meta = { clips: { walk: WALK, idle: { row: 1, frames: 1 } } };
    const rng = createRng(seedFor(261));
    let fly = animate(createFly({ mode: 'stop' }), createFly(), meta, SIZE, DT, rng);
    for (let i = 0; i < 600; i++) {
      fly = animate(fly, fly, meta, SIZE, DT, rng);
      expect(fly.frame).toBe(0);
    }
  });

  it('27. phase stays in [0, 1) and returns to its start after 1e6 whole strides', () => {
    const rng = createRng(seedFor(27));
    const phase0 = 0.5 / WALK.frames;
    let fly = createFly({ phase: phase0 });
    const perStep = STRIDE_PX / 12;
    for (let i = 0; i < 12e6; i++) {
      const prevPhase = fly.phase;
      fly = animate({ ...fly, x: perStep, y: 0 }, { ...fly, x: 0, y: 0 }, META, SIZE, DT, rng);
      if (!(fly.phase >= 0 && fly.phase < 1)) throw new Error(`phase out of range: ${fly.phase} (from ${prevPhase})`);
    }
    expect(Math.abs(fly.phase - phase0)).toBeLessThan(1e-6);
  });

  it('reorient steps in place: one cycle per full turn, using the turn clip when present', () => {
    const rng = createRng(seedFor(28));
    const turnMeta = { clips: { ...META.clips, turn: { row: 2, frames: 8, loop: true } } };
    let fly = createFly({ mode: 'reorient', phase: 0 });
    const n = 360;
    const dTheta = (2 * Math.PI) / n;
    for (let i = 0; i < n - 1; i++) {
      fly = animate({ ...fly, theta: fly.theta + dTheta }, fly, turnMeta, SIZE, DT, rng);
      expect(fly.clip).toBe('turn');
      expect(fly.frame).toBe(Math.floor(fly.phase * 8));
    }
    expect(fly.phase).toBeCloseTo((n - 1) / n, 9);

    const plain = animate({ ...fly, theta: fly.theta + 0.1 }, fly, META, SIZE, DT, rng);
    expect(plain.clip).toBe('walk');
  });

  it('is pure', () => {
    const rng = createRng(seedFor(29));
    const prev = Object.freeze(createFly());
    const cur = Object.freeze(createFly({ x: 5 }));
    const out = animate(cur, prev, META, SIZE, DT, rng);
    expect(out).not.toBe(cur);
    expect(cur.phase).toBe(0);
  });
});
