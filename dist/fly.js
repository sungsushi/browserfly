var Fly = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.js
  var index_exports = {};
  __export(index_exports, {
    create: () => create,
    instances: () => instances,
    schema: () => schema,
    version: () => version2
  });

  // package.json
  var version = "0.1.0";

  // src/params.js
  var num = (def, min, max, doc) => ({ type: "number", default: def, min, max, doc });
  var int = (def, min, max, doc) => ({ type: "int", default: def, min, max, doc });
  var oneOf = (def, values, doc) => ({ type: "enum", default: def, values, doc });
  var SCHEMA = {
    count: int(1, 1, 50, "number of flies"),
    size: num(48, 8, 200, "rendered body length (px)"),
    speed: num(2.5, 0.1, 20, "mean run speed (BL/s)"),
    speedJitter: num(0.15, 0, 0.5, "SD of the per-run speed multiplier"),
    runMean: num(2.5, 0.1, 60, "mean run duration with no cursor influence (s)"),
    stopProbability: num(0.7, 0, 1, "chance that a run ends in a stop rather than an immediate reorientation"),
    stopMean: num(1.2, 0.05, 30, "mean stop duration (s)"),
    stopDistribution: oneOf("lognormal", ["exp", "lognormal"], "stop duration distribution"),
    rotDiffusion: num(0.4, 0, 10, "heading diffusion during runs (rad\xB2/s)"),
    turnRate: num(5, 0.5, 30, "max angular speed while reorienting (rad/s)"),
    attraction: num(0.3, -1, 1, "cursor attraction; negative means repulsion"),
    attractionRange: num(400, 10, 5e3, "cursor falloff length scale (px)"),
    steeringGain: num(3, 0, 20, "strength of continuous steering during runs (rad/s)"),
    kappaMax: num(6, 0, 50, "von Mises concentration of reorientation at full attraction"),
    klinokinesis: num(0.5, 0, 0.9, "modulation of the run-ending hazard by heading"),
    arrivalRadius: num(1.5, 0, 10, "attracted flies stop within this distance of the cursor (BL; 0 disables)"),
    lingerMax: num(6, 0, 60, "max time to linger at the cursor (s)"),
    wallMargin: num(1.5, 0, 5, "soft wall-avoidance zone (BL)"),
    wallGain: num(6, 0, 30, "wall steering strength (rad/s)"),
    container: { type: "container", default: null, doc: "Element or CSS selector; null means full-viewport overlay" },
    zIndex: int(2147483e3, -2147483648, 2147483647, "overlay z-index"),
    seed: { type: "seed", default: null, min: 0, max: 4294967295, doc: "uint32 seed; null means random" },
    reducedMotion: oneOf("static", ["static", "hide", "ignore"], "behaviour when prefers-reduced-motion: reduce"),
    sprite: { type: "sprite", default: "auto", doc: "'auto', 'procedural' or a sprite sheet URL" },
    touchTargetTimeout: num(4, 0, 30, "how long a tap acts as the cursor on touch devices (s)"),
    debug: { type: "bool", default: false, doc: "draw the debug overlay" }
  };
  var DEFAULTS = Object.freeze(
    Object.fromEntries(Object.entries(SCHEMA).map(([k, s]) => [k, s.default]))
  );
  var warned = /* @__PURE__ */ new Set();
  function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[fly] ${message}`);
  }
  var INVALID = /* @__PURE__ */ Symbol("invalid");
  function clampNumber(key, spec, v) {
    if (typeof v === "string" && v.trim() !== "") v = Number(v);
    if (typeof v !== "number" || Number.isNaN(v)) return INVALID;
    if (spec.type === "int" || spec.type === "seed") v = Math.round(v);
    const c = Math.min(spec.max, Math.max(spec.min, v));
    if (c !== v) warnOnce(key, `${key}=${v} is out of range [${spec.min}, ${spec.max}]; using ${c}`);
    return c;
  }
  function coerce(key, spec, v) {
    switch (spec.type) {
      case "number":
      case "int":
        return clampNumber(key, spec, v);
      case "seed":
        return v === null ? null : clampNumber(key, spec, v);
      case "enum":
        return spec.values.includes(v) ? v : INVALID;
      case "bool":
        return typeof v === "boolean" ? v : INVALID;
      case "container":
        if (v === null || typeof v === "string" && v.trim() !== "") return v;
        return v && typeof v === "object" && v.nodeType === 1 ? v : INVALID;
      case "sprite":
        return typeof v === "string" && v.trim() !== "" ? v : INVALID;
    }
    return INVALID;
  }
  function validateParams(partial = {}) {
    const out = {};
    for (const [key, value] of Object.entries(partial)) {
      const spec = SCHEMA[key];
      if (!spec) {
        warnOnce(key, `unknown option "${key}" ignored`);
        continue;
      }
      const v = coerce(key, spec, value);
      if (v === INVALID) {
        warnOnce(key, `invalid value for ${key}: ${String(value)}; keeping ${String(spec.default)}`);
        continue;
      }
      out[key] = v;
    }
    return out;
  }
  function resolveParams(partial = {}, base = DEFAULTS) {
    return { ...base, ...validateParams(partial) };
  }
  var camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  function parseDataset(dataset) {
    const raw = {};
    for (const [k, value] of Object.entries(dataset)) {
      const key = camel(k);
      if (key === "fly") continue;
      const spec = SCHEMA[key];
      if (!spec) {
        raw[key] = value;
        continue;
      }
      const s = String(value).trim();
      switch (spec.type) {
        case "number":
        case "int":
          raw[key] = s === "" ? NaN : Number(s);
          break;
        case "seed":
          raw[key] = s === "" || s === "null" ? null : Number(s);
          break;
        case "bool":
          raw[key] = s === "" || s === "true" ? true : s === "false" ? false : s;
          break;
        default:
          raw[key] = s;
      }
    }
    return validateParams(raw);
  }

  // src/angles.js
  var PI = Math.PI;
  var TWO_PI = 2 * Math.PI;
  function wrapToPi(a) {
    let r = a % TWO_PI;
    if (r <= -PI) r += TWO_PI;
    else if (r > PI) r -= TWO_PI;
    return r;
  }
  function angleDiff(a, b) {
    return wrapToPi(a - b);
  }

  // src/rng.js
  var PI2 = Math.PI;
  var TWO_PI2 = 2 * Math.PI;
  var KAPPA_EPSILON = 1e-6;
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function createRng(seed) {
    const next = mulberry32(seed);
    return {
      next,
      uniform(lo, hi) {
        return lo + (hi - lo) * next();
      },
      /** Standard normal via Box–Muller (two draws, no cached spare). */
      normal() {
        const u1 = 1 - next();
        const u2 = next();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI2 * u2);
      },
      exponential(mean) {
        return -mean * Math.log(1 - next());
      },
      /** Lognormal parameterised by its mean: μ = ln(mean) − σ²/2. */
      lognormal(mean, sigma) {
        const mu = Math.log(mean) - sigma * sigma / 2;
        return Math.exp(mu + sigma * this.normal());
      },
      /**
       * von Mises sample on (−π, π] (Best & Fisher 1979).
       * For κ < KAPPA_EPSILON this is a single uniform draw that ignores μ.
       */
      vonMises(mu, kappa) {
        if (!(kappa >= KAPPA_EPSILON)) return PI2 - TWO_PI2 * next();
        const s = Math.sqrt(1 + 4 * kappa * kappa);
        const a = 1 + s;
        const b = a * 2 * kappa / ((s + 1) * (a + Math.sqrt(2 * a)));
        const r = (1 + b * b) / (2 * b);
        let f;
        for (; ; ) {
          const z = Math.cos(PI2 * next());
          f = (1 + r * z) / (r + z);
          const c = kappa * (r - f);
          const u2 = next();
          if (c * (2 - c) - u2 > 0) break;
          if (u2 > 0 && Math.log(c / u2) + 1 - c >= 0) break;
        }
        const sign = next() < 0.5 ? -1 : 1;
        return wrapToPi(mu + sign * Math.acos(Math.max(-1, Math.min(1, f))));
      }
    };
  }

  // src/engine.js
  var MAX_DT = 0.05;
  var REORIENT_TOLERANCE = 0.05;
  var WALL_KAPPA = 2;
  var LOGNORMAL_SIGMA = 0.6;
  var SPEED_MUL_MIN = 0.6;
  var SPEED_MUL_MAX = 1.4;
  var PI3 = Math.PI;
  var HALF_PI = Math.PI / 2;
  var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  function createFly(init = {}) {
    const theta = init.theta ?? 0;
    return {
      x: 0,
      y: 0,
      mode: "run",
      speedMul: 1,
      stopTimer: 0,
      lingerTimer: 0,
      arrivalArmed: true,
      targetTheta: 0,
      phase: 0,
      clip: "walk",
      frame: 0,
      idleTimer: 0,
      thetaUnwrapped: theta,
      ...init,
      theta: wrapToPi(theta)
    };
  }
  function spawnFly(params, env, rng) {
    const box = insetBox(env.bounds, env.sizePx);
    return createFly({
      x: rng.uniform(box.x0, box.x1),
      y: rng.uniform(box.y0, box.y1),
      theta: rng.vonMises(0, 0),
      speedMul: sampleSpeedMul(params, rng),
      phase: rng.next()
    });
  }
  function insetBox(bounds, sizePx) {
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
  function clampToBounds(fly, env) {
    const box = insetBox(env.bounds, env.sizePx);
    return { ...fly, x: clamp(fly.x, box.x0, box.x1), y: clamp(fly.y, box.y0, box.y1) };
  }
  function cursorWeight(d, range) {
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
  function forEachWall(x, y, box, fn) {
    if (!box.pinX) {
      fn(x - box.x0, 0);
      fn(box.x1 - x, PI3);
    }
    if (!box.pinY) {
      fn(y - box.y0, HALF_PI);
      fn(box.y1 - y, -HALF_PI);
    }
  }
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
  function inwardNormal(x, y, box, margin) {
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
    return p.stopDistribution === "exp" ? rng.exponential(p.stopMean) : rng.lognormal(p.stopMean, LOGNORMAL_SIGMA);
  }
  function turn(f, delta) {
    f.theta = wrapToPi(f.theta + delta);
    f.thetaUnwrapped += delta;
  }
  function inArrival(f, p, c, sizePx) {
    return f.arrivalArmed && p.attraction > 0 && c.present && p.arrivalRadius > 0 && c.d < p.arrivalRadius * sizePx;
  }
  function enterStop(f, p, rng) {
    f.mode = "stop";
    f.stopTimer = sampleStop(p, rng);
    f.lingerTimer = 0;
  }
  function enterReorient(f, p, c, box, sizePx, rng, uniform) {
    f.mode = "reorient";
    const n = inwardNormal(f.x, f.y, box, p.wallMargin * sizePx);
    if (n !== null) {
      f.targetTheta = rng.vonMises(n, WALL_KAPPA);
    } else if (uniform) {
      f.targetTheta = rng.vonMises(0, 0);
    } else {
      const mu = p.attraction >= 0 ? c.phi : c.phi + PI3;
      f.targetTheta = rng.vonMises(mu, p.kappaMax * Math.abs(p.attraction) * c.w);
    }
  }
  function runStep(f, p, env, box, dt, rng) {
    const size = env.sizePx;
    const c = cursorTerms(f.x, f.y, env.cursor, p);
    const theta0 = f.theta;
    const drift = p.steeringGain * c.s * Math.sin(c.phi - theta0) + wallSteer(f.x, f.y, theta0, box, p.wallMargin * size, p.wallGain);
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
    const lambda = 1 / p.runMean * clamp(1 - p.klinokinesis * c.s * Math.cos(c.phi - theta0), 0.1, 3);
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
      f.mode = "run";
      f.speedMul = sampleSpeedMul(p, rng);
      f.lingerTimer = 0;
    }
  }
  function assertFinite(f) {
    for (const k of ["x", "y", "theta", "thetaUnwrapped", "speedMul", "stopTimer", "lingerTimer", "targetTheta"]) {
      if (!Number.isFinite(f[k])) throw new Error(`fly.${k} is not finite: ${f[k]}`);
    }
  }
  function step(fly, params, env, dt, rng) {
    dt = dt > MAX_DT ? MAX_DT : dt > 0 ? dt : 0;
    const f = { ...fly };
    const box = insetBox(env.bounds, env.sizePx);
    if (f.mode === "run") runStep(f, params, env, box, dt, rng);
    else if (f.mode === "stop") stopStep(f, params, env, box, dt, rng);
    else reorientStep(f, params, dt, rng);
    if (true) assertFinite(f);
    return f;
  }

  // src/animator.js
  var TWO_PI3 = 2 * Math.PI;
  var PLACEHOLDER_META = Object.freeze({
    version: 1,
    clips: Object.freeze({
      walk: Object.freeze({ row: 0, frames: 12, strideBL: 0.42, loop: true }),
      idle: Object.freeze({ row: 1, frames: 2 })
    })
  });
  var IDLE_MIN = 0.5;
  var IDLE_MAX = 2;
  function frameAt(phase, frames) {
    return Math.min(frames - 1, Math.floor(phase * frames));
  }
  function animate(fly, prevFly, meta, sizePx, dt, rng) {
    const f = { ...fly };
    const walk = meta.clips.walk;
    let phase = f.phase;
    if (prevFly.mode === "run") {
      phase += Math.hypot(f.x - prevFly.x, f.y - prevFly.y) / (walk.strideBL * sizePx);
    } else if (prevFly.mode === "reorient") {
      phase += Math.abs(angleDiff(f.theta, prevFly.theta)) / TWO_PI3;
    }
    f.phase = phase - Math.floor(phase);
    if (f.mode === "stop") {
      const idle = meta.clips.idle;
      if (prevFly.clip !== "idle") {
        f.clip = "idle";
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
    f.clip = f.mode === "reorient" && meta.clips.turn ? "turn" : "walk";
    f.frame = frameAt(f.phase, meta.clips[f.clip].frames);
    return f;
  }

  // src/input.js
  function createInput() {
    let state = null;
    const opts = { passive: true };
    const onPointer = (e) => {
      state = { x: e.clientX, y: e.clientY, mouse: e.pointerType === "mouse", time: performance.now() };
    };
    const clearMouse = () => {
      if (state && state.mouse) state = null;
    };
    const onMouseOut = (e) => {
      if (e.relatedTarget === null) clearMouse();
    };
    const onBlur = () => {
      state = null;
    };
    const root = document.documentElement;
    window.addEventListener("pointermove", onPointer, opts);
    window.addEventListener("pointerdown", onPointer, opts);
    document.addEventListener("mouseout", onMouseOut, opts);
    root.addEventListener("pointerleave", clearMouse, opts);
    window.addEventListener("blur", onBlur, opts);
    return {
      cursor(now, touchTimeoutS) {
        if (!state) return null;
        if (!state.mouse && now - state.time > touchTimeoutS * 1e3) {
          state = null;
          return null;
        }
        return { x: state.x, y: state.y };
      },
      destroy() {
        window.removeEventListener("pointermove", onPointer, opts);
        window.removeEventListener("pointerdown", onPointer, opts);
        document.removeEventListener("mouseout", onMouseOut, opts);
        root.removeEventListener("pointerleave", clearMouse, opts);
        window.removeEventListener("blur", onBlur, opts);
        state = null;
      }
    };
  }

  // src/overlay.js
  function resolveContainer(container) {
    if (typeof container !== "string") return container;
    const el = document.querySelector(container);
    if (!el) console.warn(`[fly] container "${container}" not found; using the viewport`);
    return el;
  }
  function createOverlay({ container, zIndex, onResize, onVisible }) {
    const host = resolveContainer(container);
    const canvas = document.createElement("canvas");
    const s = canvas.style;
    s.position = host ? "absolute" : "fixed";
    s.inset = "0";
    s.top = s.left = "0";
    s.width = s.height = "100%";
    s.pointerEvents = "none";
    s.zIndex = String(zIndex);
    s.display = "block";
    if (host && getComputedStyle(host).position === "static") {
      console.warn("[fly] container is position: static; setting it to relative");
      host.style.position = "relative";
    }
    (host || document.body).appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const overlay = {
      canvas,
      ctx,
      host,
      dpr: 1,
      bounds: { w: 0, h: 0 },
      /** Re-reads the CSS size and DPR and resizes the backing store. */
      resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (canvas.width !== bw) canvas.width = bw;
        if (canvas.height !== bh) canvas.height = bh;
        overlay.dpr = dpr;
        overlay.bounds = { w, h };
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      },
      /** Converts client coordinates to container coordinates. */
      toLocal(p) {
        if (!p) return null;
        if (!host) return { x: p.x, y: p.y };
        const r = canvas.getBoundingClientRect();
        return { x: p.x - r.left, y: p.y - r.top };
      },
      clear() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(overlay.dpr, 0, 0, overlay.dpr, 0, 0);
      },
      setZIndex(z) {
        s.zIndex = String(z);
      },
      destroy() {
        if (ro) ro.disconnect();
        window.removeEventListener("resize", handleResize);
        if (io) io.disconnect();
        canvas.remove();
      }
    };
    const handleResize = () => {
      overlay.resize();
      onResize();
    };
    let ro = null;
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(handleResize);
      ro.observe(canvas);
    }
    window.addEventListener("resize", handleResize);
    let io = null;
    if (host && typeof IntersectionObserver === "function") {
      io = new IntersectionObserver((entries) => onVisible(entries[entries.length - 1].isIntersecting));
      io.observe(host);
    }
    overlay.resize();
    return overlay;
  }

  // src/render-procedural.js
  var TWO_PI4 = 2 * Math.PI;
  var STANCE = 0.6;
  var COLORS = {
    leg: "rgba(52, 38, 24, 0.95)",
    thorax: "#7d5b34",
    head: "#6e4f2c",
    abdomen: "#a07a48",
    band: "rgba(48, 32, 18, 0.55)",
    eye: "#c0281c",
    wing: "rgba(225, 232, 240, 0.38)",
    wingEdge: "rgba(90, 90, 100, 0.45)",
    outline: "rgba(30, 20, 10, 0.6)"
  };
  var LEGS = [
    { hip: [-0.07, -0.07], foot: [-0.3, -0.3], bend: 0.06 },
    { hip: [-0.09, 0], foot: [-0.38, 0.02], bend: 0.05 },
    { hip: [-0.07, 0.08], foot: [-0.3, 0.38], bend: 0.06 }
  ];
  function ellipse(ctx, x, y, rx, ry, rot, fill) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot, 0, TWO_PI4);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function footOffset(p, strideBL) {
    if (p < STANCE) return { fore: strideBL * (0.5 - p / STANCE), lift: 0 };
    const t = (p - STANCE) / (1 - STANCE);
    return { fore: strideBL * (t - 0.5), lift: Math.sin(Math.PI * t) };
  }
  function drawLeg(ctx, leg, side, phase, strideBL) {
    const { fore, lift } = footOffset(phase, strideBL);
    const hx = leg.hip[0] * side;
    const hy = leg.hip[1];
    const fx = (leg.foot[0] - 0.04 * lift) * side;
    const fy = leg.foot[1] - fore;
    const kx = (hx + fx) / 2 + leg.bend * side;
    const ky = (hy + fy) / 2;
    ctx.moveTo(hx, hy);
    ctx.lineTo(kx, ky);
    ctx.lineTo(fx, fy);
  }
  function drawProcedural(ctx, fly, size, strideBL) {
    ctx.save();
    ctx.translate(fly.x, fly.y);
    ctx.rotate(fly.theta + Math.PI / 2);
    ctx.scale(size, size);
    const px = 1 / size;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const offset = i % 2 ? 0.5 : 0;
      drawLeg(ctx, LEGS[i], 1, (fly.phase + offset) % 1, strideBL);
      drawLeg(ctx, LEGS[i], -1, (fly.phase + 0.5 - offset) % 1, strideBL);
    }
    ctx.lineWidth = Math.max(1, size * 0.022) * px;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = COLORS.leg;
    ctx.stroke();
    ctx.lineWidth = Math.max(0.75, size * 0.012) * px;
    ctx.strokeStyle = COLORS.outline;
    ellipse(ctx, 0, 0.34, 0.15, 0.24, 0, COLORS.abdomen);
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    for (const y of [0.24, 0.34, 0.44, 0.53]) {
      ctx.moveTo(-0.2, y);
      ctx.quadraticCurveTo(0, y + 0.05, 0.2, y);
    }
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = COLORS.band;
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = COLORS.outline;
    ellipse(ctx, 0, 0, 0.13, 0.16, 0, COLORS.thorax);
    ctx.stroke();
    ellipse(ctx, 0, -0.33, 0.11, 0.09, 0, COLORS.head);
    ctx.stroke();
    ellipse(ctx, -0.075, -0.34, 0.05, 0.065, 0.25, COLORS.eye);
    ellipse(ctx, 0.075, -0.34, 0.05, 0.065, -0.25, COLORS.eye);
    for (const side of [-1, 1]) {
      ellipse(ctx, 0.065 * side, 0.34, 0.095, 0.3, -0.13 * side, COLORS.wing);
      ctx.strokeStyle = COLORS.wingEdge;
      ctx.stroke();
    }
    ctx.restore();
  }

  // src/render-debug.js
  var TWO_PI5 = 2 * Math.PI;
  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI5);
    ctx.stroke();
  }
  function drawDebug(ctx, flies, params, cursor) {
    const size = params.size;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "top";
    if (cursor) {
      ctx.strokeStyle = "rgba(220, 40, 120, 0.9)";
      ctx.beginPath();
      ctx.moveTo(cursor.x - 8, cursor.y);
      ctx.lineTo(cursor.x + 8, cursor.y);
      ctx.moveTo(cursor.x, cursor.y - 8);
      ctx.lineTo(cursor.x, cursor.y + 8);
      ctx.stroke();
      if (params.arrivalRadius > 0) {
        const r = params.arrivalRadius * size;
        circle(ctx, cursor.x, cursor.y, r);
        ctx.setLineDash([4, 4]);
        circle(ctx, cursor.x, cursor.y, 2 * r);
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = "rgba(220, 40, 120, 0.25)";
      circle(ctx, cursor.x, cursor.y, params.attractionRange);
    }
    for (const f of flies) {
      const len = size;
      ctx.strokeStyle = "rgba(0, 140, 255, 0.95)";
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(f.x + Math.cos(f.theta) * len, f.y + Math.sin(f.theta) * len);
      ctx.stroke();
      if (f.mode === "reorient") {
        ctx.strokeStyle = "rgba(255, 150, 0, 0.95)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.lineTo(f.x + Math.cos(f.targetTheta) * len, f.y + Math.sin(f.targetTheta) * len);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      let label = f.mode;
      if (f.mode === "stop") label += ` ${Math.max(0, f.stopTimer).toFixed(1)}s`;
      if (f.lingerTimer > 0) label += ` linger ${f.lingerTimer.toFixed(1)}`;
      if (!f.arrivalArmed) label += " (disarmed)";
      const tx = f.x + size * 0.6;
      const ty = f.y - size * 0.6;
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.fillRect(tx - 2, ty - 1, ctx.measureText(label).width + 4, 14);
      ctx.fillStyle = "#111";
      ctx.fillText(label, tx, ty);
    }
    ctx.restore();
  }

  // src/index.js
  var version2 = version;
  var instances = [];
  var schema = SCHEMA;
  var REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
  var currentScript = typeof document !== "undefined" ? document.currentScript : null;
  function randomSeed() {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      return crypto.getRandomValues(new Uint32Array(1))[0];
    }
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }
  function create(options = {}) {
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
    const mql = typeof matchMedia === "function" ? matchMedia(REDUCED_MOTION) : null;
    const motion = () => mql && mql.matches && params.reducedMotion !== "ignore" ? params.reducedMotion : "animate";
    const env = () => ({ cursor: cursor(), bounds: overlay.bounds, sizePx: params.size });
    const cursor = () => overlay.toLocal(input.cursor(performance.now(), params.touchTargetTimeout));
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
      if (motion() === "hide") return;
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
    const running = () => !destroyed && !paused && onScreen && !document.hidden && motion() === "animate";
    function frame(now) {
      rafId = 0;
      if (!running()) return;
      if (true) performance.mark("fly:frame:start");
      if (last !== null) {
        const dt = (now - last) / 1e3;
        if (dt > 0) fps = fps ? fps * 0.9 + 0.1 / dt : 1 / dt;
        update(dt);
      }
      last = now;
      render();
      if (true) {
        performance.measure("fly:frame", "fly:frame:start");
        performance.clearMarks("fly:frame:start");
        performance.clearMeasures("fly:frame");
      }
      rafId = requestAnimationFrame(frame);
    }
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
    document.addEventListener("visibilitychange", sync);
    if (mql) mql.addEventListener("change", sync);
    buildOverlay();
    spawnTo(params.count);
    const swarm = {
      /** Live update. Count changes add or remove flies; a new seed restarts the swarm. */
      set(partial = {}) {
        if (destroyed) return swarm;
        const changes = validateParams(partial);
        const prev = params;
        params = { ...params, ...changes };
        if ("container" in changes && changes.container !== prev.container) buildOverlay();
        else if (params.zIndex !== prev.zIndex) overlay.setZIndex(params.zIndex);
        if ("seed" in changes) {
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
        document.removeEventListener("visibilitychange", sync);
        if (mql) mql.removeEventListener("change", sync);
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
          running: running()
        };
      }
    };
    instances.push(swarm);
    sync();
    return swarm;
  }
  function autoInit() {
    if (!currentScript || !currentScript.hasAttribute("data-fly")) return;
    const start = () => create(parseDataset(currentScript.dataset));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
  autoInit();
  return __toCommonJS(index_exports);
})();
