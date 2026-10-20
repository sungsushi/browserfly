# Fruit-fly sprite for a static website — implementation plan for Claude Code

## 0. Read this first

You are implementing a lightweight, drop-in web component: one or more top-down fruit flies that wander over a web page with run-and-stop behaviour and a tunable attraction or repulsion to the cursor. The site is a static GitHub Pages site. The end user should only need to copy one JS file, and optionally one image, into their repo and add one `<script>` tag.

The work has two independent halves:

1. **Runtime (JavaScript, browser).** This covers the behaviour engine, the animator, the renderer and the public API. It has zero runtime dependencies.
2. **Asset pipeline (Python, offline).** This renders a walk cycle from FlyGym (NeuroMechFly, MuJoCo) and converts it into a small sprite sheet plus metadata.

The runtime must work **without** the sprite sheet by using a built-in procedural renderer. This lets the JS be developed, tested and shipped before the pipeline exists. It also serves as the fallback if the asset fails to load.

### Working rules

- Work milestone by milestone, in order. Do not start a milestone until the previous one's tests pass. Commit at the end of each milestone with message `M<n>: <title>`.
- Every milestone lists acceptance criteria and tests. Write the tests, run them, and report the results. Never weaken a test tolerance to make it pass without telling the user why.
- **Gates** (marked 🚦) require stopping and asking the user before continuing.
- Runtime code: vanilla JS (ES2020), no frameworks, no runtime npm dependencies. Dev-only dependencies (esbuild, vitest, playwright, eslint) are fine.
- Do not assume FlyGym API names from memory. Install a pinned version, read its docs, examples and source, and record the exact version and the classes used in `pipeline/README.md`.
- Keep the runtime engine **pure and deterministic given a seed**. All randomness goes through an injected PRNG, and all time through an explicit `dt`. This is what makes the statistical tests possible.
- **Debug builds.** esbuild defines `__DEBUG__`. It is `true` in tests and in `fly.js`, and `false` in the minified bundles, where the debug-only checks (such as NaN assertions) are stripped.

### Revision notes (rev 2)

Changes from the first draft, so the reasoning isn't lost:
- **Linger loop fixed (§4.4).** Previously a fly that finished lingering reoriented toward the cursor it was sitting on, ran one step and stopped again, forever. Arrival is now disarmed after a linger until the fly moves beyond 2× the arrival radius, and the post-linger reorientation is uniform.
- **von Mises at κ ≈ 0 (§4.4, test 15).** It must return a plain uniform draw that ignores μ and consumes the same number of RNG draws. Otherwise "attraction = 0 with a cursor" and "no cursor" diverge.
- **Test 21** now disables arrival, which was a fourth attracting effect, and adds an all-off control.
- **Test 11** uses 10,000 flies instead of 2,000. At 2,000 the ±8% tolerance was only about 2.5σ, so it would flake across 20 seeds.
- Ranges added for every parameter. `angleDiff` sign convention, mode-transition timing, corner wall normals, the margin origin, tiny bounds, test 17 censoring and test 25 start phase are now specified.
- The repository root is the current folder, not `fly-sprite/`.

### Revision notes (rev 6, after M6 — user decision)

Flies can be anchored to the page instead of the viewport, so they scroll with the content (§4.10, milestone M8). New option `anchor: 'viewport' | 'page'`, default `'viewport'` (today's behaviour). In page mode the canvas stays fixed and viewport-sized; fly positions are page coordinates and are drawn shifted by the scroll offset. A canvas as tall as the page was rejected: at 2× pixel density a 10,000 px page would need a ~200 MB backing store, beyond browser canvas limits (Safari's especially). Flies spawn inside the visible part of the page and then roam the whole page. Only simple vertical scrolling of the document is in scope. M8 is done before the optional M7.

### Revision notes (rev 5, after M6 — user decision)

The user tuned the defaults in the demo: `size` 25, `stopProbability` 0.09, `rotDiffusion` 0.5, `attraction` 0.1, `attractionRange` 219, `touchTargetTimeout` 5 (§4.2). The statistical unit tests keep the engine values their criteria were designed at (`STATS_BASE` in `test/unit/helpers.js`), so every criterion is unchanged.

### Revision notes (rev 4, after the M2 gate — user decision)

The M2 procedural fly was judged not good enough: the head floated off the thorax, the motion looked jittery, the legs moved too fast to see, and it looked nothing like the 3D NeuroMechFly model. A feasibility spike (FlyGym 2.1.0, MuJoCo 3.9.0, recorded "Spotlight" walking replayed in NeuroMechFly, rendered overhead) showed the sprite route can meet the standard. Changes:
- **Sprite-first.** The FlyGym sprite is the intended look; the procedural renderer is a fallback only (§4.9).
- **Defaults:** `size` 48 → 96 px; `speed` 2.5 → 1.2 BL/s (§4.2). Real flies walk ~6 BL/s with legs stepping at ~11 Hz, which is ~5 display frames per step at 60 Hz, too fast to see individual legs. 1.2 BL/s is deliberate slow motion (~0.2× real time, ~3–4 steps/s). At 48 px the legs are 1–2 px hairlines; ~96 px is needed to resemble the 3D model.
- **Smooth heading noise (§4.4).** White-noise heading diffusion moved the body ~6.6° at random every frame at 60 Hz. Heading noise now comes from an Ornstein–Uhlenbeck angular velocity with correlation time `headingTau` (new param), which keeps the same long-run diffusion coefficient but has no frame-to-frame twitch.
- **Walking data (M3/M4):** kinematic replay of FlyGym's recorded walking snippet (tutorial 2, `flygym_demo.spotlight_data`), not a synthetic controller. The CPG controller (tutorial 4a) is the fallback if the loop-seam test can't be met with recorded data.
- **Sheet:** 16 frames per stride (was 12). PNG is quantised; WebP may be lossy or near-lossless to meet its budget (lossless WebP was 3–4× larger than quantised PNG in the spike).
- **Scheduling.** The runtime changes (§4.2 defaults, §4.4 heading noise, §4.9 head fix and the affected tests) are implemented in **M5**. Until then the code follows rev 3.

---

## 1. Target deliverables

```
dist/
  fly.js               # readable IIFE bundle, exposes window.Fly, auto-inits from script tag
  fly.min.js           # minified version of the above (budget: ≤ 8 KB gzipped)
  fly.inline.min.js    # same, with the sprite sheet embedded as a data URI (true single-file drop-in)
  fly.esm.js           # ES module build: export { create, version }
  fly-sheet.webp       # sprite sheet (budget: ≤ 30 KB; lossy/near-lossless allowed)
  fly-sheet.png        # PNG fallback (budget: ≤ 40 KB; palette-quantised)
  fly-sheet.json       # sheet metadata (also embedded in the JS bundles)
demo/
  index.html           # demo page with a live parameter panel and debug overlay
```

### Intended usage (document this in README.md)

Simplest form, with auto-init and the sprite resolved relative to the script's own URL:

```html
<script src="fly.min.js" data-fly data-count="2" data-attraction="0.4" defer></script>
```

Single-file form, with no image file needed:

```html
<script src="fly.inline.min.js" data-fly defer></script>
```

Programmatic form:

```html
<script src="fly.min.js" defer></script>
<script defer>
  const swarm = Fly.create({ count: 3, attraction: -0.5 });
  // swarm.set({ attraction: 0.8 });  swarm.pause();  swarm.resume();  swarm.destroy();
</script>
```

Contained in an element instead of the whole viewport:

```js
Fly.create({ container: document.querySelector('#hero'), count: 1 });
```

---

## 2. Repository layout

The repository root is the project folder itself (`browserfly/`). Run `git init` in M0 if it isn't already a repo.

```
browserfly/
  README.md
  PLAN.md
  PROGRESS.md           # current milestone, what's done, open issues
  .gitignore            # node_modules, coverage, test-results, pipeline/.venv, pipeline/out
  package.json
  esbuild.config.mjs
  scripts/
    serve.mjs           # zero-dependency static server for the repo root (supports a /<prefix>/ mount)
  src/
    index.js            # public API, auto-init from <script data-fly>, lifecycle
    params.js           # defaults, validation/clamping, data-attribute parsing
    rng.js              # mulberry32 PRNG + normal, exponential, lognormal, von Mises samplers
    angles.js           # wrapToPi, angleDiff (shortest signed), lerpAngle
    engine.js           # pure behaviour step function (no DOM)
    animator.js         # stride-phase → frame index (no DOM)
    input.js            # pointer tracking (mouse + touch), produces {x,y}|null in container coords
    overlay.js          # canvas creation, DPR sizing, resize handling, container/viewport bounds
    render-sprite.js    # draws a fly from the sprite sheet
    render-procedural.js# draws a fly with canvas primitives (fallback/dev)
    render-debug.js     # heading vector, cursor, arrival radius, state label
    sheet.js            # loads the sheet image + metadata, validates, URL resolution
  test/
    unit/*.test.js      # vitest (node)
    e2e/*.spec.js       # playwright
    fixtures/
  demo/index.html
  pipeline/
    README.md
    requirements.txt    # pinned flygym, numpy, pillow, scipy, pytest
    render_walk.py      # run simulation, save raw frames + per-frame metadata
    extract_cycle.py    # find one steady stride, resample to N frames
    align_frames.py     # mask-based centring + rotation to canonical pose
    build_sheet.py      # downscale, outline/thicken, quantize, pack, write JSON
    contact_sheet.py    # visual QA image at 1x and 4x
    tests/test_*.py
  dist/                 # build output (committed, so GitHub Pages users can copy from it)
```

---

## 3. Conventions (must be consistent everywhere)

- **Units.** Positions are in CSS pixels in container coordinates, with the origin at the top-left and y pointing down. Time is in seconds.
- **Heading** `θ` is in radians: `0` means facing +x (right), and positive values rotate clockwise on screen because y points down. Always store `θ` wrapped to (−π, π]. For diffusion tests, keep a separate unwrapped accumulator.
- **Angle helpers.** `wrapToPi(a)` returns a value in (−π, π], so `wrapToPi(−π) = π`. `angleDiff(a, b) = wrapToPi(a − b)` is the signed shortest rotation that takes `b` to `a`. For example, `angleDiff(3.1, −3.1) ≈ −0.083`. Turning code calls `angleDiff(target, current)`.
- **Sprite orientation.** In the sheet, the fly faces **up** (−y). The draw rotation is therefore `θ + π/2`.
- **Anchor.** The thorax centre is the fly's position. The sheet metadata gives the anchor pixel inside each frame.
- **Body length (BL).** This is the scale unit. `size` (px) is the rendered body length, head tip to abdomen tip, wings excluded. Speeds, radii and margins are expressed in BL where noted and converted at runtime.

### Sprite metadata (`fly-sheet.json`)

```json
{
  "version": 1,
  "image": "fly-sheet.webp",
  "frameWidth": 96,
  "frameHeight": 96,
  "anchor": [48, 50],
  "bodyLengthPx": 60,
  "clips": {
    "walk": { "row": 0, "frames": 12, "strideBL": 0.42, "loop": true },
    "idle": { "row": 1, "frames": 2 },
    "turn": { "row": 2, "frames": 8, "loop": true, "optional": true }
  },
  "source": { "generator": "flygym", "flygymVersion": "x.y.z", "controller": "<name>", "notes": "" }
}
```

`strideBL` is the distance the body travels during one full walk cycle, in body lengths. The animator relies on it to prevent foot sliding.

---

## 4. Behaviour model (authoritative spec for `engine.js`)

### 4.1 State per fly

`{ x, y, theta, thetaUnwrapped, omega, mode, speedMul, stopTimer, lingerTimer, arrivalArmed, targetTheta, phase, clip, frame, idleTimer }`

`omega` (rev 4) is the heading-noise angular velocity (rad/s) of the Ornstein–Uhlenbeck process in §4.4.

`mode` is one of `'run'`, `'stop'` or `'reorient'`. `clip` is the animator's current clip (`'walk'`, `'idle'` or `'turn'`). `arrivalArmed` is a boolean and starts as `true`. `phase` is always stored in [0, 1).

### 4.2 Parameters and defaults (`params.js`)

| Param | Default | Units / range | Meaning |
|---|---|---|---|
| `count` | 1 | int 1–50 | number of flies |
| `size` | 25 | px, 8–200 | rendered body length (rev 5: user default; rev 4: 96; rev 3: 48) |
| `speed` | 1.2 | BL/s, 0.1–20 | mean run speed (rev 4: was 2.5; deliberate slow motion, real flies ≈ 6 BL/s) |
| `speedJitter` | 0.15 | 0–0.5 | SD of the per-run speed multiplier: `speedMul = clamp(1 + speedJitter·N(0,1), 0.6, 1.4)` |
| `runMean` | 2.5 | s, 0.1–60 | mean run duration with no cursor influence |
| `stopProbability` | 0.09 | 0–1 | chance that a run ends in a stop rather than an immediate reorientation (rev 5: was 0.7) |
| `stopMean` | 1.2 | s, 0.05–30 | mean stop duration |
| `stopDistribution` | `'lognormal'` | `'exp'` \| `'lognormal'` | lognormal uses σ = 0.6 and μ = ln(`stopMean`) − σ²/2, so the mean equals `stopMean` |
| `rotDiffusion` | 0.5 | rad²/s, 0–10 | long-run heading diffusion during runs (rev 5: was 0.4) |
| `headingTau` | 0.3 | s, 0.02–2 | correlation time of the heading noise (rev 4) |
| `turnRate` | 5 | rad/s, 0.5–30 | max angular speed while reorienting |
| `attraction` | 0.1 | −1 to 1 | cursor attraction; negative means repulsion (rev 5: was 0.3) |
| `attractionRange` | 219 | px, 10–5000 | falloff length scale R (deliberately in px, not BL, because the cursor lives in screen space) (rev 5: was 400) |
| `steeringGain` | 3 | rad/s, 0–20 | strength of continuous steering during runs |
| `kappaMax` | 6 | 0–50 | von Mises concentration at full attraction |
| `klinokinesis` | 0.5 | 0–0.9 | modulation of run-ending hazard by heading |
| `arrivalRadius` | 1.5 | BL, 0–10 | attracted flies stop within this distance of the cursor (0 disables arrival) |
| `lingerMax` | 6 | s, 0–60 | max time to linger at the cursor before wandering again |
| `wallMargin` | 1.5 | BL, 0–5 | soft wall-avoidance zone |
| `wallGain` | 6 | rad/s, 0–30 | wall steering strength |
| `container` | `null` | Element \| CSS selector string \| null | `null` means fixed full-viewport overlay; a string is resolved with `document.querySelector` |
| `zIndex` | 2147483000 | int | overlay z-index |
| `seed` | `null` | uint32 \| null | `null` means a random seed |
| `reducedMotion` | `'static'` | `'static'` \| `'hide'` \| `'ignore'` | behaviour when `prefers-reduced-motion: reduce` |
| `sprite` | `'auto'` | `'auto'` \| URL \| `'procedural'` | sprite source |
| `touchTargetTimeout` | 5 | s, 0–30 | how long a tap acts as the cursor on touch devices (rev 5: was 4) |
| `anchor` | `'viewport'` | `'viewport'` \| `'page'` | `'viewport'`: flies stay on screen while the page scrolls under them. `'page'`: flies live on the page and scroll with the content (§4.10). Viewport mode only; ignored with a warning when `container` is set (a container already scrolls with its content) |
| `debug` | `false` | bool | draw the debug overlay |

`params.js` defines these in a single schema table (default, type, range or allowed values) that also drives validation, data-attribute parsing and the README table. It must clamp out-of-range values (with `console.warn` once per key) and ignore unknown keys with a warning. Data attributes use kebab-case (for example `data-attraction`, `data-run-mean`) and are parsed as numbers or booleans where the schema type says so. Strings are kept for string or enum params. `data-fly` is the auto-init flag, not a param.

The engine and animator take a plain params object and do **not** re-validate it. This lets tests pass values outside the public ranges, such as `runMean = Infinity`.

### 4.3 Cursor influence

Let `d` be the distance from the fly to the cursor and `φ` the angle from the fly to the cursor.

- Weight: `w(d) = 1 / (1 + (d/R)²)`. If there is no cursor, `w = 0`.
- Effective signed strength: `s = attraction · w(d)`.

### 4.4 Step function

`step(fly, params, env, dt, rng) → fly'`

`env = { cursor: {x,y}|null, bounds: {w,h}, sizePx }`.

`step` is pure: it returns a new state object and never mutates its input. Each call runs the update for the fly's **current** mode only. A mode change made during a step takes effect from the next step; the fly does not, for example, finish reorienting and also move in the same step. `φ = atan2(cy − y, cx − x)`, which is 0 when `d = 0` and is never NaN.

1. Clamp `dt` to at most 0.05 s. A larger gap (for example, a tab returning from the background) runs as a single clamped step. It is not looped.
2. **mode `run`:**
   - Heading noise (rev 4): an Ornstein–Uhlenbeck angular velocity, updated exactly:
     `omega = omega · e^(−dt/τ) + sqrt((rotDiffusion/τ) · (1 − e^(−2dt/τ))) · N(0,1)`, with `τ = headingTau`.
     Its stationary SD is `sqrt(rotDiffusion/τ)` and the long-run heading diffusion coefficient is `rotDiffusion`. On entering `run`, draw `omega` from the stationary distribution, `sqrt(rotDiffusion/τ) · N(0,1)`, so a run starts statistically stationary.
   - Heading update: `θ += [steeringGain · s · sin(φ − θ) + wallSteer + omega] · dt`, using `omega` after its update.
   - *(Rev 3 and earlier used white noise, `θ += drift · dt + sqrt(2 · rotDiffusion · dt) · N(0,1)`. That is correct for diffusion but makes the body twitch every frame.)*
   - Position: `x += v cos θ · dt`, `y += v sin θ · dt`, where `v = speed · sizePx · speedMul`.
   - Run-ending hazard: `λ = (1/runMean) · clamp(1 − klinokinesis · s · cos(φ − θ), 0.1, 3)`. The run ends with probability `1 − exp(−λ·dt)`. When the fly is heading toward an attractive cursor, `cos > 0` lowers the hazard, so runs get longer. (With the public ranges the factor stays within [0.1, 1.9], so the clamp is only a safety net.)
   - **Arrival re-arming:** if `arrivalArmed` is false and the cursor is null or `d > 2 · arrivalRadius · sizePx`, set `arrivalArmed = true`.
   - **Arrival:** if `arrivalArmed`, `attraction > 0`, a cursor exists, `arrivalRadius > 0` and `d < arrivalRadius · sizePx`, switch to `stop`, sample a stop duration, and set `lingerTimer = 0`. Arrival takes priority over the hazard in the same step.
   - When a run ends: with probability `stopProbability` go to `stop` and sample the stop duration; otherwise go to `reorient`.
3. **mode `stop`:**
   - Decrement `stopTimer`.
   - Lingering: while `arrivalArmed`, attraction > 0 and the cursor is within the arrival radius, the timer does not expire, but `lingerTimer` accumulates. Once `lingerTimer ≥ lingerMax`, the timer may expire normally.
   - When the timer expires, go to `reorient`. If the stop ended because `lingerTimer ≥ lingerMax`, set `arrivalArmed = false` and draw `targetTheta` uniformly (κ = 0). This lets the fly actually walk away. Without it, the fly would aim at the cursor it is sitting on, run one step and immediately stop again, forever.
4. **Entering `reorient`:** sample `targetTheta` from a von Mises distribution with
   - `μ = φ` if attraction ≥ 0, else `φ + π`;
   - `κ = kappaMax · |attraction| · w(d)`;
   - `κ < 1e-6` (including `κ = 0`, with or without a cursor) gives a plain uniform draw on (−π, π] that **ignores μ** and uses exactly the same number of RNG draws in every case. This keeps `attraction = 0` bit-identical to "no cursor" and avoids Best–Fisher's instability at tiny κ.

   If the fly is inside the wall margin, instead draw around the inward normal with `κ = 2`. Near a corner, the normal is the direction of the sum of the nearby walls' inward unit normals, each weighted by `(1 − dist/margin)`.
5. **mode `reorient`:** rotate toward `targetTheta` along the shortest path by at most `turnRate · dt` (that is, by `clamp(angleDiff(targetTheta, θ), −turnRate·dt, turnRate·dt)`). When `|angleDiff| < 0.05 rad`, switch to `run`, draw a new `speedMul`, and reset `lingerTimer`. `arrivalArmed` is **not** reset here.
6. **Walls.** Use bounds inset by `sizePx/2`. All wall distances are measured from these inset bounds. If an inset dimension is ≤ 0 (the container is smaller than a fly), pin that coordinate to the centre of the box.
   - `wallSteer` applies only inside `wallMargin · sizePx`. It equals `wallGain · (1 − dist/margin) · sin(nAngle − θ)`, summed over the nearby walls, where `nAngle` is the inward normal.
   - If an update would move the fly outside the bounds, clamp the position and force `reorient` with the wall rule.
7. Keep `theta` wrapped. Update `thetaUnwrapped` with the same increments, without wrapping.
8. No NaN or Infinity may ever appear. Assert this in debug builds (`__DEBUG__`) and in tests.

### 4.5 Animator (`animator.js`)

`animate(fly, prevFly, meta, sizePx, dt, rng) → fly'` is pure, like `step`. The idle timer draws from the same injected PRNG.

- **run:** `phase += distanceTravelled / (strideBL · sizePx)`, then `phase −= floor(phase)` so it stays in [0, 1), and `frame = floor(phase · walk.frames)`.
- **reorient:** feet step in place. Use the `turn` clip if present, otherwise `walk`. Advance `phase += |Δθ| / (2π)`, which is one cycle per full turn. Tune this visually.
- **stop:** use the `idle` clip. Change frames on a slow random timer (`idleTimer`, uniform 0.5–2 s) if there is more than one idle frame.
- The procedural renderer consumes `phase` directly, as a continuous value, rather than `frame`.
- Until the real sheet exists (M4), the animator and procedural renderer use built-in placeholder metadata: walk with 12 frames and `strideBL` 0.42, and idle with 2 frames.

### 4.6 Input (`input.js`)

- Listen to `pointermove` and `pointerdown` on `window`, with passive listeners.
- Convert coordinates to container coordinates. In viewport mode these are client coordinates, because the canvas is fixed.
- Mouse: the cursor becomes `null` when a `mouseout` event on `document` has `relatedTarget === null`. This is the primary signal, because `pointerleave` on `document` is not reliable across browsers. Also handle `pointerleave` on `document.documentElement`, and `blur` on `window`.
- Touch or pen (`pointerType !== 'mouse'`): the tap position acts as the cursor for `touchTargetTimeout` seconds, then becomes `null`.
- Never call `preventDefault`. Never capture the pointer.

### 4.7 Overlay and lifecycle (`overlay.js`, `index.js`)

- **Viewport mode:** a single `<canvas>` with `position:fixed; inset:0; pointer-events:none; z-index:<zIndex>`.
- **Container mode:** the canvas is `position:absolute; inset:0` inside the container. If the container is `position: static`, set it to `relative` and warn.
- Size the canvas for `devicePixelRatio`: backing store = CSS size × DPR, then `ctx.setTransform(dpr,0,0,dpr,0,0)`. Use a `ResizeObserver`, or `resize` in viewport mode. On resize, clamp the flies into the new bounds.
- Run a single `requestAnimationFrame` loop shared by all flies, and only while visible.
  - Pause on `document.hidden`.
  - In container mode, also pause when the container is off-screen (`IntersectionObserver`).
- `prefers-reduced-motion`:
  - `'static'` draws the flies standing still and never updates positions.
  - `'hide'` draws nothing.
  - `'ignore'` animates normally.
  - Listen for live changes to the media query.
- `destroy()` removes the canvas and all listeners and observers, and cancels the animation frame. Calling it twice is a no-op.
- Auto-init: on load, find `document.currentScript`. If it has `data-fly`, create a swarm from its data attributes. Expose the swarm as `Fly.instances[0]`.
- Sprite URL resolution for `'auto'`:
  1. If the bundle has an inlined sheet, use it.
  2. Otherwise resolve `fly-sheet.webp` relative to the script's `src`.
  3. If WebP fails to decode, try `fly-sheet.png`.
  4. If that fails, fall back to `'procedural'` and emit a single `console.warn`.

  This matters for GitHub Pages project sites served under `/<repo>/`.

### 4.8 Public API

```ts
Fly.create(options?) → Swarm
Fly.version: string
Fly.instances: Swarm[]

Swarm.set(partialOptions)   // live update; count changes add/remove flies
Swarm.pause() / resume()
Swarm.destroy()
Swarm.debug() → { flies: FlyState[], cursor, bounds, fps }   // read-only snapshot, used by e2e tests
```

### 4.9 Procedural renderer (`render-procedural.js`)

*Rev 4: fallback only, used before the sheet loads or if it fails. The head must overlap the thorax (the M2 version left a 0.08 BL gap).*

- Draw a top-down fly facing up: ellipses for the head, thorax and abdomen (with 3–4 faint abdominal bands), two red eye ellipses, and two translucent folded wings over the abdomen.
- Legs: six legs, each a 2-segment polyline. Tripods are {L1, R2, L3} and {R1, L2, R3}, half a cycle apart.
  - Each foot's fore–aft offset follows a stance/swing waveform driven by `phase`, with a stance fraction of 0.6.
  - During stance, the foot moves backward relative to the body, linearly.
  - During swing, it moves forward with a slight lateral lift outward.
- Line width scales with `size`, with a minimum of 1 px.
- It must look acceptable on its own, since it is shipped as the fallback.

### 4.10 Page anchoring (`anchor: 'page'`, rev 6)

Applies in viewport mode only (`container` is `null`). With a container, `anchor: 'page'` is ignored and a single `console.warn` is emitted, because the canvas is already part of the content.

- **Canvas.** Unchanged: one fixed, viewport-sized canvas (backing store = viewport × DPR). Never size a canvas to the page.
- **Coordinates.** Fly positions, the cursor and `bounds` are page coordinates: origin at the top-left of the document, y down. `bounds = { w: viewport width, h: max(document scroll height, viewport height) }`. Horizontal scrolling is out of scope: the page width is the viewport width and `scrollX` is ignored.
- **Drawing.** Each frame, translate by `−scrollY` (read once per frame) and draw only the flies whose position is within one body length of the visible band `[scrollY, scrollY + viewport height]`. The debug overlay is drawn in the same translated frame.
- **Simulation.** Off-screen flies keep being simulated (the engine is unchanged; only `bounds` is larger). The loop still pauses on `document.hidden`.
- **Spawning.** New flies (at creation, on `set({ count })` increases, and on a new `seed`) spawn uniformly inside the visible band, inset by half a body length, so a visitor who never scrolls still sees them. Afterwards they roam the whole page, walls at the page edges.
- **Cursor.** A mouse cursor is its current client position plus the current `scrollY`, computed every frame, so scrolling with the wheel under a still pointer moves the cursor over the content. A touch or pen tap is converted to page coordinates at the moment of the tap and stays there for `touchTargetTimeout` seconds.
- **Page size changes.** Observe the document's size (`ResizeObserver` on `document.documentElement`, plus `resize`). When `bounds` change, clamp the flies into the new bounds within one frame, as in §4.7.
- **Scrolling without animation.** When the loop is not running (paused, or reduced motion `'static'`), listen for `scroll` (passive) and redraw, so static flies stay attached to the content. With `'hide'`, draw nothing as before.
- **Live switching.** `set({ anchor })` converts every fly between viewport and page coordinates by adding or subtracting the current `scrollY`, so nothing jumps on screen at the moment of switching.
- **`debug()`** also returns `scroll: { y }` and `anchor`; flies, cursor and bounds are in page coordinates in page mode.

---

## 5. Milestones

### M0 — Scaffolding

**Tasks**
- Run `git init` and add a `.gitignore`. Create `PROGRESS.md`.
- Set up `package.json` (`"type": "module"`) with scripts `build`, `test`, `test:sweep`, `test:e2e`, `lint` and `serve`. `serve` runs `scripts/serve.mjs`, which serves the repo root so `demo/index.html` can load `../dist/`, and can also mount the root under a prefix such as `/my-repo/` for M5.
- Add the esbuild config producing the bundles, with `__DEBUG__` defined as described in §0. `fly.inline.min.js` is produced only when `dist/fly-sheet.webp` exists. The build prints the gzip size of each output.
- Configure vitest (with `@vitest/coverage-v8`) and playwright (Chromium + Firefox + WebKit). Downloading the browser binaries (`npx playwright install`) is deferred to M2, when the first e2e test exists.

**Acceptance**
- `npm test` runs (empty suite passes).
- `npm run build` produces `dist/fly.js` from a stub `index.js`.

### M1 — Pure core: RNG, angles, params, engine, animator

**Tasks:** Implement `rng.js`, `angles.js`, `params.js`, `engine.js` and `animator.js` exactly as specified in §4. Use Best & Fisher (1979) for the von Mises sampler.

**Unit tests** (`test/unit`). Use fixed seeds and `dt = 1/60` unless stated. Tolerances are chosen to be flake-free with the given sample sizes (each is at least about 4σ). `npm run test:sweep` reruns the statistical tests under 20 different base seeds (via an environment variable). If any are flaky across those 20 seeds, report it rather than loosen silently. Comparisons against a baseline ("below baseline", "greater than baseline") must hold by at least 3 standard errors of the difference, not merely in the point estimate.

*RNG and angles*
1. **Determinism.** The same seed gives an identical sequence of 1000 draws. Different seeds give different sequences.
2. **Uniform.** Mean is 0.5 ± 0.01 over 100k draws.
3. **Normal.** Mean is 0 ± 0.02 and SD is 1 ± 0.02 over 100k draws.
4. **Exponential.** Mean is 1 ± 0.02, and the coefficient of variation is 1 ± 0.03.
5. **Lognormal.** Parameterised by mean, the sample mean is `stopMean` ± 3%.
6. **von Mises, κ = 0.** Mean resultant length R < 0.02 over 50k draws.
7. **von Mises, κ = 4, μ = 1.0.** Circular mean is within 0.03 rad of μ, and R = I₁(4)/I₀(4) ≈ 0.8635 ± 0.01.
8. **wrapToPi and angleDiff.** Table-driven cases, including `wrapToPi(π) = π`, `wrapToPi(−π) = π`, 3π, −3π, and `angleDiff(3.1, −3.1) ≈ −0.083` (shortest path, convention `wrapToPi(a − b)`).

*Params*

9. **Clamping.** `attraction: 2 → 1` and `count: 0 → 1`. Unknown keys warn. Data-attribute parsing works (`"0.4" → 0.4`, `"true" → true`).

*Engine statistics.* Use a large bounds box (1e6 × 1e6) and no walls in play unless stated.

10. **Run speed.** With `rotDiffusion = 0`, `speedJitter = 0` and `runMean = ∞`, displacement after 10 s equals `speed · size · 10` ± 0.1%.
11. **Rotational diffusion.** With no cursor and no run endings (`runMean = ∞`), the variance of `thetaUnwrapped(t) − thetaUnwrapped(0)` across 10,000 flies at t = 5 s is `2 · D_r · t` ± 8%. (The relative SE of a sample variance is √(2/n). At n = 2000 that is 3.2%, making ±8% only 2.5σ, which flakes across 20 seeds. At n = 10,000 it is 1.4%, so ±8% is about 5.7σ.)
12. **Run durations.** With no cursor and 20k runs, the mean is `runMean` ± 4% and the CV is 1 ± 0.06.
13. **Stop durations.** The mean matches `stopMean` ± 4% for both distributions. The fraction of run endings that lead to a stop is `stopProbability` ± 0.02.
14. **Reorientation.**
    - Per-step |Δθ| ≤ `turnRate · dt` + 1e-9.
    - The fly always takes the shortest direction.
    - It reaches the target and enters `run`.
    - With no cursor, target headings are uniform (R < 0.03 over 20k).

*Engine: cursor attraction.* Cursor fixed at the centre of a 2000 × 2000 box. Flies start on a ring of radius 600 with random headings.

15. **Neutral.** With `attraction = 0`, the cursor's presence changes nothing: the trajectories are bit-identical to the no-cursor case for the same seed. This tests that `w` is multiplied by zero correctly, and that the κ ≈ 0 von Mises branch ignores μ and consumes the same RNG draws.
16. **Attraction works.** With `attraction = 1`, ≥ 95% of 200 seeds reach the arrival radius within 60 s. During runs, the mean of `cos(φ − θ)` is > 0.5.
17. **Monotonic.** Median time-to-arrival is strictly decreasing over `attraction ∈ {0.25, 0.5, 1.0}`, with 200 seeds each. Each simulation is capped at 300 s, and a fly that hasn't arrived counts as arriving at the cap (right-censored), so the median is always defined.
18. **Repulsion.** With `attraction = −1`, the time-averaged distance to the cursor over 120 s is greater than the `attraction = 0` baseline by ≥ 20%. Use 200 seeds and the same box. (Known risk: repulsion is weak near the walls of a 2000 px box when R = 400. If this fails, report it with the measured ratio rather than tuning parameters to pass.)
19. **Falloff.** With the cursor at distance 50·R, the behaviour statistics (run-duration mean, heading R) are indistinguishable from no cursor, within the tolerances of tests 11–12.
20. **Lingering.** With `attraction = 1` and the cursor fixed inside the arrival radius, the fly remains in `stop` for ≥ `lingerMax − dt`, then leaves: within ~~30 s~~ **120 s** it reaches a distance > 2 · arrivalRadius · size, which re-arms arrival. Until then it stays disarmed and never lingers again (`lingerTimer` never increases). Afterwards it may return and linger again. A fly that keeps re-stopping without ever leaving the radius fails the test.
    *(Rev 3, user decision during M1: behaviour kept as specified, criterion relaxed from 30 s to 120 s. With `attraction = 1` the steering term curls a disarmed fly back toward the cursor, so 3–10 of 50 flies needed more than 30 s; median ≈ 7–12 s. Ordinary run-ending stops inside the radius still happen (about 2 per fly) and are allowed; only arrival stops and lingering are excluded.)*
21. **Each mechanism isolated.** Set `arrivalRadius = 0`, so arrival and lingering can't contribute. Then run the following, each with `attraction = 1`, 200 seeds and 600 s per seed (rev 3: at 120 s the klinokinesis-only effect is real but only ~2.7 SE on average, so it fails the 3 SE criterion on most seed bases):
    - **Control:** `steeringGain = 0`, `klinokinesis = 0`, `kappaMax = 0`. The time-averaged distance matches the `attraction = 0` baseline within 3 SE.
    - Only `kappaMax > 0`; only `steeringGain > 0`; only `klinokinesis > 0`. Each gives time-averaged distance below baseline by ≥ 3 SE.

    This guards against one term silently doing all the work.

*Engine: robustness*

22. **Bounds.** Box 800 × 600, the cursor moves on a random walk, 5 flies, 3600 s simulated. Every position stays within the inset bounds, with no NaN or Infinity.
23. **dt invariance.** Run-duration mean and diffusion variance at `dt = 1/30` and `dt = 1/144` agree with `dt = 1/60` within the tolerances of tests 11–12, using the same sample sizes. (Discrete-step run durations have mean ≈ `runMean + dt/2`, at most 0.7% at `dt = 1/30`, which is well inside tolerance.)
24. **Large dt.** A `step` with `dt = 5` behaves like `dt = 0.05`: no teleporting further than `0.05 · v · 1.01`, where `v` includes `speedMul`.

*Animator*

25. **Walk frames.** Starting at a phase in the middle of a frame (for example `0.5 / walk.frames`, so float rounding can't land on a frame boundary), travelling exactly `strideBL · size` in `dt` steps advances exactly `walk.frames` frame changes and returns to the starting frame. Half a stride advances half the frames (±1).
26. **Stillness.** Zero distance in `run` mode leaves the frame unchanged. `stop` mode shows idle frames only.
27. **Phase wrapping.** Phase stays in [0, 1) and, after 1e6 whole strides, is within 1e-6 of its starting value; check with a long loop.

**Acceptance:** all tests pass; engine and animator import nothing from the DOM; coverage ≥ 90% for `engine.js` and `animator.js`.

### M2 — Overlay, input, procedural renderer, demo page (first shippable version)

**Tasks**
- Implement `input.js`, `overlay.js`, `render-procedural.js`, `render-debug.js` and `index.js` (API + auto-init).
- `demo/index.html`:
  - a page with some dummy text and a clickable button under the fly layer;
  - a floating control panel with sliders for every numeric parameter, a sprite-mode select, a seed input and a debug toggle;
  - an fps readout.

**E2E tests** (`test/e2e`, Playwright, all three engines)
1. **Clean load.** The demo loads with zero console errors. Exactly one `<canvas>` is added, and its computed `pointer-events` is `none`.
2. **Click-through.** Clicking the button located under the canvas triggers its handler.
3. **Visible output.** After 500 ms, the canvas contains non-transparent pixels (`getImageData` on the fly's position from `swarm.debug()`).
4. **Attraction end-to-end.** Use `seed = 1` and `attraction = 1`. Move the mouse to a point 400 px from the fly. Within 20 s, `debug().flies[0]` is within the arrival radius.
5. **Reduced motion.** Emulate `prefers-reduced-motion: reduce`. With the default `'static'`, the position is unchanged over 2 s but the canvas is non-empty. With `'hide'`, the canvas is empty.
6. **Resize.** Resize the viewport from 1200×800 to 400×300. All flies end up inside the new inset bounds within one frame.
7. **High DPR.** At `deviceScaleFactor: 2`, `canvas.width === canvas.clientWidth * 2`.
8. **Destroy.** After `destroy()`, the canvas is removed, a rAF counter stops increasing, and a second `destroy()` does not throw.
9. **Live updates.** `set({ count: 5 })`, then `set({ count: 2 })`, gives correct fly counts and no errors.
10. **Container mode.** Flies stay inside the container's rect, and the canvas is a child of the container.
11. **Touch.** Emulate a mobile device. After a tap, the cursor is non-null; after `touchTargetTimeout` it is null.
12. **Performance (soft check, warn only).** With 20 flies, mean script time per frame is < 2 ms on CI hardware. Measure with `performance.mark` around the update+draw.

**Acceptance:** the demo works by opening it through `npm run serve`, and all e2e tests pass. 🚦 **Gate:** send the user the demo instructions and ask them to tune the default parameters by feel. Update the defaults table with their choices.

### M3 — 🚦 FlyGym feasibility and leg-readability test (Phase 0 of the art)

**Tasks**
- Create `pipeline/` with a pinned `requirements.txt`. Install it in a venv.
- Headless rendering may need `MUJOCO_GL=egl` (Linux GPU) or `osmesa`. Document what worked.
- Read the installed FlyGym's docs and examples. Identify:
  - how to run steady forward walking (a CPG / hybrid / turning controller from its locomotion examples, or kinematic replay of recorded walking);
  - how to add a custom camera;
  - how to get a segmentation render (MuJoCo can render geom IDs);
  - how to read thorax position and orientation per step.

  Record the findings in `pipeline/README.md`.
- Render about 1 s of steady walking from directly overhead at high resolution (≥ 512 px across the body). Save a handful of frames.
  *Rev 4 starting point (from the spike):* FlyGym 2.1.0 has no walking controller in the package. Use kinematic replay of the recorded walking snippet (`flygym_demo.spotlight_data.MotionSnippet`, 2 s at 330 Hz) through position actuators with leg adhesion, as in tutorial 2. On macOS MuJoCo renders headless with its default CGL backend. Compiled camera names are namespaced by the fly name (e.g. `nmf/topcam`); looking one up by its bare name returns −1, which silently renders MuJoCo's default free camera. The default wing colour (lavender) needs recolouring.
- Produce `contact_sheet.py` output: those frames downscaled to body lengths of **32, 48, 64, 96 and 128 px** (rev 4: 128 added; body length excludes the wings). Make three versions of each: plain area-averaged, area-averaged plus a 1 px dark outline, and with thickened leg geoms re-rendered. Show each at 1× and 4× zoom (nearest-neighbour for the zoomed view).

**Acceptance:** `pipeline/out/phase0_contact_sheet.png` exists. 🚦 **Gate:** show it to the user and ask them to choose:
- (a) proceed with 3D sprites at size X with treatment Y;
- (b) keep the procedural renderer only and skip M4–M5;
- (c) use the renders as reference for hand-cleaned pixel art. Hand-drawing is out of scope for you; prepare the scaffolding only.

### M4 — Sprite pipeline

Proceed only if option (a) was chosen.

**Tasks**
1. `render_walk.py`
   - Run a steady straight walk on flat terrain. Discard the warm-up (≥ 1 s, or until the stride period stabilises).
   - Save at a fixed control timestep: RGB frames, segmentation frames, thorax pose, and a gait-phase signal (controller oscillator phase if exposed, otherwise one leg's tarsus contact/height).
   - Choose camera option A first: a camera rigidly attached to the thorax, looking straight down, with the head pointing up in the image. If body pitch/roll wobble is objectionable, or the API makes this hard, use option B: a fixed overhead camera wide enough to keep the fly in view, followed by alignment in step 3.
   - Hide or exclude the floor from the segmentation mask.
   - Use flat, overhead lighting. Disable shadows if possible.
   - Optionally render a second run with asymmetric descending drive for a `turn` clip, and a standing still sequence for `idle`.
2. `extract_cycle.py`
   - Estimate the stride period from the phase signal (zero crossings, or autocorrelation peak).
   - Pick one complete cycle from the steady section. Resample it to N frames, where N is configurable (default 16, rev 4), evenly spaced in phase. The source is the recorded walking replay; if the loop-seam test (pipeline test 2) can't be met with recorded data, report it and offer the CPG controller as the alternative.
   - Compute `strideBL` as the body displacement over that cycle divided by body length. Get body length from the model geometry in mm.
3. `align_frames.py`
   - Build the alpha mask from the segmentation (all fly geoms), with soft alpha for the wings if feasible.
   - Compute the centroid of the thorax geom pixels, and the body axis via PCA on the head+thorax+abdomen pixels. Resolve the PCA sign using the head centroid.
   - Translate and rotate so the thorax sits at the anchor and the head points up.
   - Crop to a fixed square frame with padding so the legs never clip.
4. `build_sheet.py`
   - Downscale with area averaging to the chosen size, applying the chosen leg treatment from M3.
   - Premultiply alpha correctly. Avoid dark fringes: downscale premultiplied, then un-premultiply.
   - Pack the clips into rows. Quantise (pngquant-equivalent via Pillow or a CLI if available), write lossless WebP and PNG, and write `fly-sheet.json` (schema in §3).
   - Copy the outputs to `dist/`.

**Pipeline tests** (`pytest pipeline/tests`)
1. **Period detection.** On synthetic sinusoids and square waves with known period plus noise, the detected period is within 1%.
2. **Loop seam.** The difference between the last frame and frame 0 (mean absolute alpha diff) is ≤ 1.5 × the median diff between adjacent frames. This proves seamless looping.
3. **Alignment.** In every frame of every clip, the thorax centroid is within 1 px of `anchor` (at output resolution), and the body axis is within 3° of vertical, head up.
4. **Alpha.**
   - All four frame corners are fully transparent.
   - No frame is empty.
   - Opaque-pixel area varies < 15% across walk frames, so the body never vanishes.
   - Legs and feet never touch the frame border (a 1 px border ring is fully transparent).
5. **Metadata.**
   - The JSON validates against the schema.
   - `frameWidth × max(frames)` ≤ image width, and the rows match the image height.
   - `strideBL` is in (0.1, 1.5).
   - `bodyLengthPx` matches the measured mask extent ± 2 px.
6. **Budget.** `fly-sheet.webp` ≤ 30 KB and `fly-sheet.png` ≤ 40 KB. If over, reduce frames or colours and report the trade-off.
7. **Reproducibility.** Running the full pipeline twice with the same seed and config produces byte-identical JSON and pixel-identical sheets.

**Acceptance:** tests pass. `contact_sheet.py` produces a QA image of the final sheet, plus an animated GIF/WebP preview of each clip at 1× and 4×. 🚦 **Gate:** user visual approval.

### M5 — Sprite renderer integration

**Tasks**
- **Rev 4 runtime changes.** Update the §4.2 defaults (`size` 96, `speed` 1.2, new `headingTau`), implement the OU heading noise (§4.4), and fix the procedural head (§4.9). Update the unit tests: test 11 expects `Var(Δθ(t)) = 2·D·(t − τ·(1 − e^(−t/τ)))` for a stationary start (same tolerance); tests that relied on the old default speed or size pin those values explicitly, so their criteria are unchanged. Rerun `npm run test:sweep`.
- Implement `sheet.js`, which loads and validates the metadata and decodes the image with `img.decode()`, and `render-sprite.js`.
- Draw with `translate(x, y)` → `rotate(θ + π/2)` → `scale(size / bodyLengthPx)` → `drawImage(frame)`, offset by the anchor. Keep `imageSmoothingEnabled = true` and quality `'high'`.
- Draw the procedural fly until the sheet has loaded, then switch seamlessly.
- Embed the metadata in the bundles. Have `build` produce `fly.inline.min.js` with the WebP inlined as a base64 data URI.

**Tests**
- **Unit.** `sheet.js` metadata validation rejects malformed fixtures (missing clip, frame count mismatch, negative stride).
- **E2E.**
  1. With the sprite, the fly renders. Sample pixels at the anchor to confirm it is non-transparent.
  2. **Asset failure.** Serve a 404 for the sheet. The procedural fallback renders, exactly one `console.warn` is emitted, and there are no errors.
  3. **WebP fallback.** Block `.webp` (route abort). The PNG is used.
  4. **Subpath.** Serve the demo under `/my-repo/`. The `'auto'` sprite resolves relative to the script and loads.
  5. **Inline bundle.** A plain HTML file with only `<script src="fly.inline.min.js" data-fly>` and no other files present works with zero network requests besides the script.
  6. **Foot sliding (visual-numeric).** Over one stride of travel, the frame index advances exactly `walk.frames` times. This reuses the animator test through the real renderer path by spying on `drawImage` source rects.

**Acceptance:** all tests pass; the demo has a renderer toggle (sprite/procedural); bundle sizes are reported by the build script and within budget.

### M6 — Packaging, docs, GitHub Pages check

**Tasks**
- Write `README.md` with:
  - the four usage snippets;
  - a parameter table generated from `params.js` defaults (write a small script so it can't drift);
  - an accessibility note (reduced motion, `aria-hidden="true"` on the canvas);
  - browser support;
  - the pipeline regeneration instructions;
  - credits and licence notes for FlyGym/NeuroMechFly. Check their licence and cite appropriately.
- Set `aria-hidden="true"` and `role="presentation"` on the canvas.
- Add a GitHub Actions workflow that runs the unit and e2e tests on push. It must not run the Python pipeline, which is too heavy; the pipeline outputs are committed.
- Run a final size report: gzip sizes of each bundle and the sheet.

**Acceptance**
- A fresh `index.html` with one script tag works when served by `npx serve` from a subdirectory.
- All tests are green in CI.
- Sizes are within budget: `fly.min.js` ≤ 8 KB gz, `fly.inline.min.js` ≤ 45 KB gz.

### M8 — Page-anchored flies (rev 6; done before M7)

**Tasks**
- Add the `anchor` parameter (§4.2) and implement §4.10 in `overlay.js`, `input.js` and `index.js`. The engine and animator do not change.
- Demo: an `anchor` select in the panel, and enough page content below the fold to scroll through.
- README: document `anchor` with an example (`data-anchor="page"`), and the note that only the document's vertical scrolling is supported.
- Keep `fly.min.js` within 8 KB gz. It currently has ~30 B of headroom, so make room first, for example by stripping the debug overlay's text labels (or the whole overlay) from the minified builds, or by shortening warning texts. If the budget cannot be met without removing user-facing features, stop and ask the user (raise the budget, or which feature to drop).

**Unit tests**
- Params: `anchor` accepts `'viewport'` and `'page'`; anything else is ignored with a warning; `data-anchor="page"` parses.

**E2E tests** (`test/fixtures/long-page.html`: about 4000 px of content; all three engines)
1. **Spawn in view.** Scroll to y = 1500, then create a page-anchored swarm of 10. Every fly's page y is inside `[1500, 1500 + innerHeight]`, inset by half a body length.
2. **Anchoring.** Pause the swarm. Record a fly's page position and confirm the canvas is opaque at its screen position. Scroll down by 300 px. The fly's page position is unchanged, and the canvas is now opaque at the screen position 300 px higher (and transparent at the old one, unless another fly is there).
3. **Viewport mode is unchanged.** With the default `anchor`, the same scroll leaves the fly's screen position unchanged.
4. **Off-screen flies keep walking.** Scroll a fly out of view; its page position keeps changing; scroll back and it is drawn where `debug()` says it is.
5. **Cursor.** Move the mouse to client (x, y) at scroll offset s: `debug().cursor` is (x, y + s). Scroll by d with the mouse still: the cursor becomes (x, y + s + d). In touch emulation, a tap followed by a scroll keeps the cursor at the tap's page position.
6. **Bounds follow the page.** Append 1000 px of content: `bounds.h` grows by 1000 within one frame of the layout change. Remove 3000 px: every fly is inside the new inset bounds within one frame.
7. **No giant canvas.** In page mode on the long page, `canvas.height === round(innerHeight × DPR)`.
8. **Static reduced motion.** Emulate `prefers-reduced-motion: reduce` with `anchor: 'page'`: positions never change, and after a scroll the flies are drawn at their new screen positions.
9. **Live switching.** `set({ anchor: 'page' })` and back at a non-zero scroll offset: no fly's screen position moves by more than 1 px at the switch.
10. **Container mode.** `container` + `anchor: 'page'` emits exactly one warning and behaves exactly like container mode.
11. **Performance (soft, warn only).** 20 page-anchored flies on the long page: mean script time per frame under 2 ms in Chromium and WebKit; report Firefox.

**Acceptance:** all tests above and all existing unit and e2e tests pass; bundle sizes within budget; README and the generated option table updated. 🚦 **Gate:** ask the user to try `anchor: 'page'` in the demo and on their own page before the milestone is closed.

### M7 — Optional polish (only if the user asks)

- Grooming idle clip, if FlyGym or NeuroMechFly offers grooming kinematics.
- A short "startle" when the cursor moves fast near the fly: a brief burst of speed away from it.
- Fly–fly avoidance when `count > 1`.
- A pixel-art mode with 16 pre-rotated headings, snapped to the nearest one, to avoid rotation blur.

---

## 6. Out of scope

- Browser extensions, frameworks or framework wrappers, and server-side code.
- Running MuJoCo or any 3D engine in the browser.
- Hand-drawn pixel art. You may prepare scaffolding for it, but the drawing is the user's job.

## 7. Overall definition of done

- One `<script>` tag gives wandering flies on any static page, including GitHub Pages project subpaths.
- Behaviour matches §4 and is verified by the statistical unit tests.
- Attraction is tunable live from −1 to 1, and visibly monotonic in effect.
- No foot sliding, no layout shift, no blocked clicks, and reduced-motion is respected.
- Sizes are within budget and all tests pass in CI.
