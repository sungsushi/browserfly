# Progress

**Current milestone:** M2 — Overlay, input, procedural renderer, demo ✅ done (committed; gate closed 2026-10-20, user kept the defaults). Next: M3 — 🚦 FlyGym feasibility and leg-readability test (not started; waiting for go-ahead).

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

## Open issues
- Firefox exceeds the 2 ms soft perf budget with 20 flies (headless Firefox canvas is slower; Chromium/WebKit are ~8× under). Candidate optimisations if it matters: cache the static body as an offscreen bitmap per size and only draw legs per frame.
- **Test 20 at 120 s is not flake-free — accepted by the user (2026-10-20); a lone test 20 failure is a known flake, rerun.** Over 2000 flies the escape time is median 10 s, p99 69 s, max 114 s, with a roughly exponential tail (×~8 less likely per extra 30 s). Estimated failure rate: ~1.5% per run, ~1 in 4 sweeps (seen on base 16). 180 s would be ~0.02% per run.
- Test 20 does not assert "no stops inside the radius": ordinary run-ending stops (≈2 per fly) happen there under the specified behaviour. It asserts no arrival stop / no lingering (disarmed, `lingerTimer` never increases) until re-armed.
- vitest `testTimeout` is 120 s (statistical tests exceed the default under coverage).
- `fly.esm.js` is built with `__DEBUG__`=false; flip if a debug ESM build is wanted.
