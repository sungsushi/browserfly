# Progress

**Current milestone:** M1 — Pure core ✅ done (committed). Next: M2 — Overlay, input, procedural renderer, demo (not started; waiting for go-ahead).

## Done
- **M0** — scaffolding (git, package.json scripts, esbuild/vitest/playwright/eslint configs, serve + sweep scripts).
- **M1** — `src/rng.js`, `src/angles.js`, `src/params.js`, `src/engine.js`, `src/animator.js`; unit tests 1–27 plus edge cases (77 tests).
  - von Mises: Best & Fisher with a cancellation-free form of b; κ < 1e-6 is a single uniform draw ignoring μ.
  - Coverage: engine.js 100% lines / 99% branches; animator.js 100% / 100%. Lint clean. No DOM in the core (tested).
  - `npm test`: 77/77. `npm run test:sweep`: 19/20 seed bases (test 20 flake on base 16, see Open issues).
  - Measured (20 seed bases): test 16 200/200 arrive, mean cos ≈ 0.62; test 17 medians ≈ 26 / 13 / 8 s; test 18 repulsion ratio ≥ 1.396; test 21 kappa-only ≈ 57 SE, steering-only ≈ 135 SE, klinokinesis-only ≥ 4.9 SE.
  - PLAN.md rev 3 notes: test 20 cap relaxed 30 s → 120 s (user decision, behaviour unchanged); test 21 runs 600 s per seed.

## Open issues
- **Test 20 at 120 s is not flake-free.** Over 2000 flies the escape time is median 10 s, p99 69 s, max 114 s, with a roughly exponential tail (×~8 less likely per extra 30 s). Estimated failure rate: ~1.5% per run, ~1 in 4 sweeps (seen on base 16). 180 s would be ~0.02% per run.
- Test 20 does not assert "no stops inside the radius": ordinary run-ending stops (≈2 per fly) happen there under the specified behaviour. It asserts no arrival stop / no lingering (disarmed, `lingerTimer` never increases) until re-armed.
- vitest `testTimeout` is 120 s (statistical tests exceed the default under coverage).
- `fly.esm.js` is built with `__DEBUG__`=false; flip if a debug ESM build is wanted.
- Playwright browser binaries not installed yet (deferred to M2).
