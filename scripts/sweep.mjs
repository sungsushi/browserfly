// Reruns the statistical unit tests under 20 different base seeds.
// Tests read the base seed from process.env.FLY_SEED_BASE (default 0) and offset their fixed seeds by it.
import { spawnSync } from 'node:child_process';

const SEEDS = 20;
const failed = [];
for (let base = 1; base <= SEEDS; base++) {
  console.log(`\n=== FLY_SEED_BASE=${base} ===`);
  const r = spawnSync('npx', ['vitest', 'run', 'test/unit'], {
    stdio: 'inherit',
    env: { ...process.env, FLY_SEED_BASE: String(base) },
  });
  if (r.status !== 0) failed.push(base);
}
console.log(`\nSweep: ${SEEDS - failed.length}/${SEEDS} seed bases passed`);
if (failed.length) {
  console.log(`Failing seed bases: ${failed.join(', ')}`);
  process.exit(1);
}
