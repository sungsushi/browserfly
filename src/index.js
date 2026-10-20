// Public API, lifecycle and auto-init (PLAN.md §4.7–4.8).
import { version as pkgVersion } from '../package.json';
import { SCHEMA, resolveParams, validateParams, parseDataset } from './params.js';
import { createRng } from './rng.js';
import { spawnFly, step, clampToBounds } from './engine.js';
import { animate, PLACEHOLDER_META } from './animator.js';
import { createInput } from './input.js';
import { createOverlay } from './overlay.js';
import { drawProcedural } from './render-procedural.js';
import { drawDebug } from './render-debug.js';

export const version = pkgVersion;

/** Live swarms; auto-init puts its swarm at instances[0]. */
export const instances = [];

/** The parameter schema (defaults, ranges, docs), used by the demo panel. */
export const schema = SCHEMA;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
// Captured at load: currentScript is only set while the bundle is first evaluated.
const currentScript = typeof document !== 'undefined' ? document.currentScript : null;

function randomSeed() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/**
 * Creates a swarm of flies. Options are validated against the schema (PLAN.md §4.2).
 * Sprite sheets arrive in M5; until then every swarm uses the procedural renderer.
 */
export function create(options = {}) {
  let params = resolveParams(options);
  let rng = createRng(params.seed ?? randomSeed());
  let flies = [];
  let overlay = null;
  const input = createInput();
  const meta = PLACEHOLDER_META;
  const strideBL = meta.clips.walk.strideBL;

  let destroyed = false;
  let paused = false;
  let onScreen = true;
  let rafId = 0;
  let last = null;
  let fps = 0;

  const mql = typeof matchMedia === 'function' ? matchMedia(REDUCED_MOTION) : null;

  // 'animate' | 'static' | 'hide'
  const motion = () =>
    mql && mql.matches && params.reducedMotion !== 'ignore' ? params.reducedMotion : 'animate';

  const env = () => ({ cursor: cursor(), bounds: overlay.bounds, sizePx: params.size });
  const cursor = () => overlay.toLocal(input.cursor(performance.now(), params.touchTargetTimeout));

  // False while flies were spawned into a zero-size overlay (e.g. a hidden container),
  // where they would all start at the same point; they are re-spawned on the first real size.
  let placed = false;

  function spawnTo(n) {
    const e = env();
    while (flies.length < n) flies.push(spawnFly(params, e, rng));
    flies.length = n;
    placed = e.bounds.w > 0 && e.bounds.h > 0;
  }

  function render() {
    if (overlay.dpr !== (window.devicePixelRatio || 1)) overlay.resize();
    overlay.clear();
    if (motion() === 'hide') return;
    const { ctx } = overlay;
    for (const f of flies) drawProcedural(ctx, f, params.size, strideBL);
    if (params.debug) drawDebug(ctx, flies, params, cursor());
  }

  function update(dt) {
    const e = env();
    for (let i = 0; i < flies.length; i++) {
      const prev = flies[i];
      flies[i] = animate(step(prev, params, e, dt, rng), prev, meta, params.size, dt, rng);
    }
  }

  const running = () => !destroyed && !paused && onScreen && !document.hidden && motion() === 'animate';

  function frame(now) {
    rafId = 0;
    if (!running()) return;
    if (__DEBUG__) performance.mark('fly:frame:start');
    if (last !== null) {
      const dt = (now - last) / 1000;
      if (dt > 0) fps = fps ? fps * 0.9 + 0.1 / dt : 1 / dt;
      update(dt);
    }
    last = now;
    render();
    if (__DEBUG__) {
      // Observed by the e2e performance check; cleared so the timeline buffer can't grow.
      performance.measure('fly:frame', 'fly:frame:start');
      performance.clearMarks('fly:frame:start');
      performance.clearMeasures('fly:frame');
    }
    rafId = requestAnimationFrame(frame);
  }

  // Starts or stops the loop to match the current state; draws once when not animating.
  function sync() {
    if (destroyed) return;
    if (running()) {
      if (!rafId) {
        last = null;
        rafId = requestAnimationFrame(frame);
      }
    } else {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      render();
    }
  }

  function onResize() {
    if (!placed) {
      flies = [];
      spawnTo(params.count);
    }
    const e = env();
    flies = flies.map((f) => clampToBounds(f, e));
    render();
  }

  function onVisible(visible) {
    onScreen = visible;
    sync();
  }

  function buildOverlay() {
    if (overlay) overlay.destroy();
    overlay = createOverlay({ container: params.container, zIndex: params.zIndex, onResize, onVisible });
    onScreen = true;
  }

  document.addEventListener('visibilitychange', sync);
  if (mql) mql.addEventListener('change', sync);

  buildOverlay();
  spawnTo(params.count);

  const swarm = {
    /** Live update. Count changes add or remove flies; a new seed restarts the swarm. */
    set(partial = {}) {
      if (destroyed) return swarm;
      const changes = validateParams(partial);
      const prev = params;
      params = { ...params, ...changes };
      if ('container' in changes && changes.container !== prev.container) buildOverlay();
      else if (params.zIndex !== prev.zIndex) overlay.setZIndex(params.zIndex);
      if ('seed' in changes) {
        rng = createRng(params.seed ?? randomSeed());
        flies = [];
      }
      if (params.size !== prev.size) onResize();
      spawnTo(params.count);
      sync();
      return swarm;
    },
    pause() {
      paused = true;
      sync();
      return swarm;
    },
    resume() {
      paused = false;
      sync();
      return swarm;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      document.removeEventListener('visibilitychange', sync);
      if (mql) mql.removeEventListener('change', sync);
      input.destroy();
      overlay.destroy();
      const i = instances.indexOf(swarm);
      if (i >= 0) instances.splice(i, 1);
    },
    /** Read-only snapshot for tests and the demo. */
    debug() {
      return {
        flies: flies.map((f) => ({ ...f })),
        cursor: destroyed ? null : cursor(),
        bounds: { ...overlay.bounds },
        fps,
        params: { ...params, container: params.container && String(params.container) },
        running: running(),
      };
    },
  };

  instances.push(swarm);
  sync();
  return swarm;
}

function autoInit() {
  if (!currentScript || !currentScript.hasAttribute('data-fly')) return;
  const start = () => create(parseDataset(currentScript.dataset));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

autoInit();
