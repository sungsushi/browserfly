# Progress

**Current milestone:** M0 — Scaffolding ✅ done. Next: M1 — Pure core (not started; waiting for go-ahead).

## Done
- **M0** — git repo, `.gitignore`, `package.json` (scripts: build, test, test:sweep, test:e2e, lint, serve).
  - `esbuild.config.mjs`: `fly.js` (IIFE, `__DEBUG__`=true), `fly.min.js` (minified, false), `fly.esm.js` (false); `fly.inline.min.js` only when `dist/fly-sheet.webp` exists (sheet injected via `__INLINE_SHEET__`). Prints raw + gzip sizes.
  - `scripts/serve.mjs`: zero-dep static server, `--port`, `--prefix /my-repo/`.
  - `scripts/sweep.mjs`: reruns `test/unit` under `FLY_SEED_BASE=1..20`.
  - vitest (+ coverage-v8, `__DEBUG__`=true), playwright (chromium/firefox/webkit, webServer on :4173), eslint flat config.
  - Stub `src/index.js`.
  - Verified: `npm test` (empty suite passes), `npm run build`, `npm run lint`, serve prefix/404/traversal checks.

## Open issues
- `fly.esm.js` is built with `__DEBUG__`=false (spec only says "true in fly.js, false in the minified bundles"); flip if a debug ESM build is wanted.
- Playwright browser binaries not installed yet (deferred to M2 per plan); `npm run test:e2e` will report "no tests found" until then.
- Statistical tests must read `process.env.FLY_SEED_BASE` and offset their seeds for `test:sweep` to be meaningful (M1).
