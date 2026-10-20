// Builds the dist/ bundles and prints the gzip size of each.
//   fly.js            readable IIFE, __DEBUG__ = true
//   fly.min.js        minified IIFE, __DEBUG__ = false
//   fly.esm.js        ES module, __DEBUG__ = false
//   fly.inline.min.js minified IIFE with the sheet inlined (only if dist/fly-sheet.webp exists)
import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const entry = path.join(root, 'src/index.js');
const sheetPath = path.join(dist, 'fly-sheet.webp');

const common = { entryPoints: [entry], bundle: true, target: 'es2020', logLevel: 'warning' };

function defines(debug, inlineSheet = null) {
  return {
    __DEBUG__: String(debug),
    __INLINE_SHEET__: JSON.stringify(inlineSheet),
  };
}

const builds = [
  { outfile: 'fly.js', format: 'iife', globalName: 'Fly', minify: false, define: defines(true) },
  { outfile: 'fly.min.js', format: 'iife', globalName: 'Fly', minify: true, define: defines(false) },
  { outfile: 'fly.esm.js', format: 'esm', minify: false, define: defines(false) },
];

if (existsSync(sheetPath)) {
  const dataUri = 'data:image/webp;base64,' + readFileSync(sheetPath).toString('base64');
  builds.push({
    outfile: 'fly.inline.min.js', format: 'iife', globalName: 'Fly', minify: true,
    define: defines(false, dataUri),
  });
} else {
  console.log('dist/fly-sheet.webp not found: skipping fly.inline.min.js');
}

await Promise.all(builds.map(({ outfile, ...opts }) =>
  build({ ...common, ...opts, outfile: path.join(dist, outfile) })));

const rows = builds.map(({ outfile }) => {
  const buf = readFileSync(path.join(dist, outfile));
  return [outfile, buf.length, gzipSync(buf, { level: 9 }).length];
});
const kb = (n) => (n / 1024).toFixed(2).padStart(8) + ' KB';
console.log('bundle'.padEnd(20) + 'raw'.padStart(11) + 'gzip'.padStart(11));
for (const [name, raw, gz] of rows) console.log(name.padEnd(20) + kb(raw) + kb(gz));
