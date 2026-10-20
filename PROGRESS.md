# Progress

**Current milestone:** M6 — Packaging, docs, GitHub Pages check — ✅ done locally (committed). CI not yet run: the repo has no remote. M7 (optional polish) only if asked.

## Done
- **M0** — scaffolding (git, package.json scripts, esbuild/vitest/playwright/eslint configs, serve + sweep scripts).
- **M1** — `src/rng.js`, `src/angles.js`, `src/params.js`, `src/engine.js`, `src/animator.js`; unit tests 1–27 plus edge cases (77 tests).
  - von Mises: Best & Fisher with a cancellation-free form of b; κ < 1e-6 is a single uniform draw ignoring μ.
  - Coverage: engine.js 100% lines / 99% branches; animator.js 100% / 100%. Lint clean. No DOM in the core (tested).
  - `npm test`: 77/77. `npm run test:sweep`: 19/20 seed bases (test 20 flake on base 16, see Open issues).
  - Measured (20 seed bases): test 16 200/200 arrive, mean cos ≈ 0.62; test 17 medians ≈ 26 / 13 / 8 s; test 18 repulsion ratio ≥ 1.396; test 21 kappa-only ≈ 57 SE, steering-only ≈ 135 SE, klinokinesis-only ≥ 4.9 SE.
  - PLAN.md rev 3 notes: test 20 cap relaxed 30 s → 120 s (user decision, behaviour unchanged); test 21 runs 600 s per seed.

- **M2** — `src/input.js`, `src/overlay.js`, `src/render-procedural.js`, `src/render-debug.js`, `src/index.js` (API + auto-init), `demo/index.html`, fixtures `test/fixtures/{container,autoinit}.html`, e2e specs `test/e2e/{demo,environment}.spec.js` (tests 1–12 plus auto-init, mouse-leave, pause/resume, container off-screen pause, live reduced-motion change).
  - Lint clean; unit tests 77/77; build OK (`fly.min.js` 6.99 KB gz, budget 8 KB).
  - `npm run test:e2e`: 54/54 (18 tests × Chromium, Firefox, WebKit); `--repeat-each=3`: 162/162, no flakes.
  - Test 12 perf (soft): mean script ms/frame with 20 flies — Chromium ≈ 0.25, WebKit ≈ 0.32, **Firefox ≈ 2.1–4.0 (over the 2 ms soft budget; warn only)**.
  - Changes beyond the spec: `Fly.schema` exported (demo builds its sliders from it); `debug()` also returns `params` and `running`; the demo reads options from the query string; a `seed` change in `set()` restarts the swarm; flies spawned into a 0×0 overlay are re-spawned on the first real size; viewport resize is handled by both `window.resize` (fires before rAF) and `ResizeObserver`.
  - Fixed M0 config: playwright `webServer.url` pointed at `/` (404) → `/demo/`. `test:e2e` now builds first. Package version 0.1.0.
  - `sprite: 'auto'` currently always renders procedurally (sheet loading is M5), with no warning.

- **PLAN rev 4** (2026-10-20, after the user rejected the procedural look): sprite-first, defaults `size` 96 / `speed` 1.2, OU heading noise with new `headingTau`, recorded walking data, 16-frame sheets. Runtime changes are scheduled in M5. Based on a scratchpad feasibility spike.
- **M3** — `pipeline/requirements.txt` (flygym 2.1.0, mujoco 3.9.0, numpy, pillow, scipy, pytest pinned), `pipeline/render_walk.py` (kinematic replay of the recorded Spotlight walk, overhead tracking camera, two-background exact alpha, part-label maps, optional thickened legs), `pipeline/contact_sheet.py` (contact sheet + animated HTML preview + stats), `pipeline/README.md` (API findings, gotchas, measurements, credits), `pipeline/tests/test_render_helpers.py`.
  - `pytest pipeline/tests`: 3/3. Gate artefacts (not committed, `pipeline/out/` is ignored): `phase0_contact_sheet.png`, `phase0_preview.html`, `phase0_stats.json`.
  - Measured: stepping 10.8 Hz, 5.1 BL/s real speed, body 2.64 mm, strideBL 0.47. 16-frame 128-colour PNG sheets: 48 px ≈ 11 KB, 96 px ≈ 33 KB, 128 px ≈ 55 KB.

  - **M3 gate (2026-10-20):** user chose (a) 3D sprites, default size 96 px, plain treatment.
- **M4** — `pipeline/extract_cycle.py`, `align_frames.py`, `build_sheet.py`, `build_all.py`; `render_walk.py` gained orthographic camera, `--poses-only` and `--plan` modes, wings-hidden labels, idle clip; `contact_sheet.py final` (QA image, animated WebP per clip at 1×/4×, HTML preview). Sheet in `dist/fly-sheet.{png,webp,json}`.
  - `pytest pipeline/tests`: 19/19 (tests 1–7 + dist-matches-pipeline + 3 helper tests), 84 s.
  - Sheet: 16-frame walk + 2-frame idle, 143×163 frames, anchor [72, 67], 96 px body, strideBL 0.64, 64 colours. PNG 31.1 KB (≤ 40), WebP 26.7 KB (≤ 30). Seam ratio 1.16 (≤ 1.5).
  - Decisions: camera option B, orthographic; body length = visible length (2.59 mm) rather than mesh-vertex span (2.76 mm); cycle chosen by an image-based seam check; 64 colours to meet the WebP budget; no turn clip.
  - Test 5's body-length check compares every frame (stricter than the plan's single comparison); it passes.

  - **M4 gate (2026-10-20):** user approved the sheet.
- **M5** — rev 4 runtime changes and sprite integration.
  - Rev 4: defaults `size` 96, `speed` 1.2, new `headingTau` 0.3; OU heading noise (`omega` state, exact update, stationary draw on entering run and at spawn); procedural head now overlaps the thorax. Unit tests: test 11/23 use 2·D·(t − τ(1 − e^(−t/τ))) for a stationary start (same ±8%); `P()` pins speed 2.5 (rev 3 criteria unchanged); new smoothness test. `npm test`: 87/87. `npm run test:sweep`: **20/20** seed bases (test 20 did not flake this time).
  - `src/sheet.js` (validation, URL resolution: inline → script-relative WebP → PNG; custom image or `.json` sheet URL; decode to ImageBitmap), `src/render-sprite.js`; `index.js` draws procedurally until the sheet loads, warns once on failure; `debug()` reports `renderer` and `sheetUrl`. Metadata embedded as `__SHEET_META__` (runtime fields only); `fly.inline.min.js` built.
  - Parameter descriptions moved to `src/param-docs.js` (debug build's `Fly.schema` only) to fit the min budget.
  - E2E: new `test/e2e/sprite.spec.js` (tests 1–6) + second test server under `/my-repo/`. `npm run test:e2e` ×2: **144/144** (24 tests × 3 browsers × 2). One earlier Firefox run of test 6 failed in 6 ms (launch-level, not reproduced in 24 + 144 further runs).
  - Bundles: `fly.min.js` 7.94 KB gz (budget 8, ~60 B headroom), `fly.inline.min.js` 36.2 KB gz (budget 45). The build now prints budgets.
  - Demo: renderer toggle (sprite / procedural).

- **M6** — `README.md` (usage snippets, files, generated option table, API, behaviour, accessibility, browser support, development, pipeline regeneration, credits with the NeuroMechFly citations FlyGym asks for); `scripts/params-table.mjs` + `npm run docs` / `docs:check` + `test/unit/readme.test.js` (table can't drift); canvas `aria-hidden="true"` + `role="presentation"` (e2e test 1 checks); `.github/workflows/test.yml` (lint, docs check, unit, committed-bundles-match-source, e2e on 3 browsers; no pipeline).
  - Local run of every CI step: lint ✓, docs check ✓, `npm test` 89/89, build matches committed `dist/`, `npm run test:e2e` 72/72.
  - Acceptance check: a fresh page with one script tag in a subdirectory, served by `npx serve@14.2.4`: `/sub/` (fly.min.js + sheets) → sprite from `/sub/fly-sheet.webp`, no console messages; `/single/` (fly.inline.min.js only) → sprite, one request.
  - Final sizes: `fly.min.js` 7.97 KB gz (≤ 8), `fly.inline.min.js` 36.25 KB gz (≤ 45), `fly-sheet.webp` 26.7 KB (≤ 30), `fly-sheet.png` 31.1 KB (≤ 40).

- **Rev 5 defaults (2026-10-20, user's tuning):** `size` 25, `stopProbability` 0.09, `rotDiffusion` 0.5, `attraction` 0.1, `attractionRange` 219, `touchTargetTimeout` 5. PLAN §4.2 and the README table updated. Unit tests pin the statistical baseline (`STATS_BASE`), so the criteria and the 20/20 sweep still apply unchanged; e2e test 4 pins `size: 96`. `npm test` 89/89, `npm run test:e2e` 72/72.

## Open issues
- **CI not verified on GitHub:** no git remote is configured, so the workflow has only been validated (YAML) and its steps run locally.
- **No licence for this repository's own code** (README says so). FlyGym/NeuroMechFly are Apache-2.0 and credited.
- Sheet budget: met at 64 colours with ~3 KB WebP headroom. Re-rendering at other settings may need 48 colours (18 KB) or fewer frames.
- Real speed in the chosen stride is 6.9 BL/s with strideBL 0.64; at the rev 4 default of 1.2 BL/s the legs step at ~1.9 Hz (≈ 32 display frames per stride).
- **`fly.min.js` has ~30 B of headroom under 8 KB gz.** Any further runtime addition must be paid for (candidates: shorter warning texts, dropping the debug overlay's labels in min builds).
- E2E filters Chromium's "Failed to load resource" console errors in the 404 test: they come from the network layer, not script.
- Firefox exceeds the 2 ms soft perf budget with 20 flies (headless Firefox canvas is slower; Chromium/WebKit are ~8× under). Candidate optimisations if it matters: cache the static body as an offscreen bitmap per size and only draw legs per frame.
- **Test 20 at 120 s is not flake-free — accepted by the user (2026-10-20); a lone test 20 failure is a known flake, rerun.** Over 2000 flies the escape time is median 10 s, p99 69 s, max 114 s, with a roughly exponential tail (×~8 less likely per extra 30 s). Estimated failure rate: ~1.5% per run, ~1 in 4 sweeps (seen on base 16). 180 s would be ~0.02% per run.
- Test 20 does not assert "no stops inside the radius": ordinary run-ending stops (≈2 per fly) happen there under the specified behaviour. It asserts no arrival stop / no lingering (disarmed, `lingerTimer` never increases) until re-armed.
- vitest `testTimeout` is 120 s (statistical tests exceed the default under coverage).
- `fly.esm.js` is built with `__DEBUG__`=false; flip if a debug ESM build is wanted.
