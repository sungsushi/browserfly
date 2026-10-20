// M5 e2e tests 1–6: sprite renderer, fallbacks, subpath, inline bundle, foot sliding.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openDemo, snapshot, nextFrame } from './helpers.js';
import { SUBPATH_PORT } from '../../playwright.config.js';

const META = JSON.parse(readFileSync(new URL('../../dist/fly-sheet.json', import.meta.url), 'utf8'));

// Chromium logs failed resource loads (e.g. a 404) to the console as errors; those come from the
// browser's network layer, not from script, so they are not counted as page errors.
function trackConsole(page) {
  const log = { errors: [], warnings: [] };
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) log.errors.push(m.text());
    if (m.type() === 'warning') log.warnings.push(m.text());
  });
  page.on('pageerror', (e) => log.errors.push(String(e)));
  return log;
}

const waitForRenderer = (page, renderer, get = 'window.swarm') =>
  page.waitForFunction(([r, g]) => {
    const s = eval(g);
    return s && s.debug().renderer === r;
  }, [renderer, get]);

/** Alpha at a fly's position (the anchor), read in the same task as the position. */
const alphaAtFly = (page, get = 'window.swarm') => page.evaluate((g) => {
  const f = eval(g).debug().flies[0];
  const c = document.querySelector('canvas');
  const dpr = c.width / c.clientWidth;
  return c.getContext('2d').getImageData(Math.round(f.x * dpr), Math.round(f.y * dpr), 1, 1).data[3];
}, get);

test('1. the sprite renders: opaque pixels at the anchor', async ({ page }) => {
  const log = trackConsole(page);
  await openDemo(page, { seed: 3 });
  await waitForRenderer(page, 'sprite');
  expect((await snapshot(page)).sheetUrl).toMatch(/\/dist\/fly-sheet\.webp$/);
  // Seamless switch: the very next frame already shows the sprite (WebKit used to draw nothing
  // for ~100 ms after an <img> decoded).
  await nextFrame(page);
  expect(await alphaAtFly(page)).toBeGreaterThan(200);
  expect(log.errors).toEqual([]);
  expect(log.warnings).toEqual([]);
});

test('2. asset failure: procedural fallback, exactly one warning, no errors', async ({ page }) => {
  const log = trackConsole(page);
  await page.route('**/fly-sheet.*', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await openDemo(page, { seed: 3 });
  await expect.poll(() => log.warnings.length, { timeout: 5000 }).toBe(1);
  await page.waitForTimeout(500); // no second warning arrives late
  expect(log.warnings).toHaveLength(1);
  expect(log.warnings[0]).toMatch(/sprite sheet could not be loaded/);
  expect((await snapshot(page)).renderer).toBe('procedural');
  expect(await alphaAtFly(page)).toBeGreaterThan(200);
  expect(log.errors).toEqual([]);
});

test('3. WebP blocked: the PNG is used', async ({ page }) => {
  const log = trackConsole(page);
  await page.route('**/*.webp', (route) => route.abort());
  await openDemo(page, { seed: 3 });
  await waitForRenderer(page, 'sprite');
  expect((await snapshot(page)).sheetUrl).toMatch(/\/dist\/fly-sheet\.png$/);
  expect(log.warnings).toEqual([]);
  expect(log.errors).toEqual([]);
});

test('4. subpath: under /my-repo/ the sheet resolves relative to the script', async ({ page }) => {
  const log = trackConsole(page);
  await page.goto(`http://localhost:${SUBPATH_PORT}/my-repo/demo/?seed=3`);
  await waitForRenderer(page, 'sprite');
  expect((await snapshot(page)).sheetUrl).toBe(`http://localhost:${SUBPATH_PORT}/my-repo/dist/fly-sheet.webp`);
  expect(log.errors).toEqual([]);
});

test('5. inline bundle: works with no requests besides the page and the script', async ({ page }) => {
  const log = trackConsole(page);
  const requests = [];
  // Simulate a folder holding only the HTML file and the inline bundle.
  await page.route('**/*', (route) => {
    const url = route.request().url();
    requests.push(url);
    if (/\/inline\.html$|\/fly\.inline\.min\.js$/.test(url)) return route.continue();
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('/test/fixtures/inline.html');
  const get = 'window.Fly && window.Fly.instances[0]';
  await waitForRenderer(page, 'sprite', get);
  expect(await page.evaluate((g) => eval(g).debug().sheetUrl, get)).toBe('inline');
  await page.waitForTimeout(300);
  expect(await alphaAtFly(page, get)).toBeGreaterThan(200);
  expect(requests.filter((u) => !/favicon\.ico$/.test(u))).toHaveLength(2);
  expect(log.errors).toEqual([]);
  expect(log.warnings).toEqual([]);
});

test('6. no foot sliding: over one stride of travel the frame advances exactly walk.frames times', async ({ page }) => {
  // Record the source rect of every sprite draw together with the fly state drawn.
  await page.addInitScript(() => {
    window.__draws = [];
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...a) {
      if (a.length === 9 && window.swarm && window.__record) {
        const f = window.swarm.debug().flies[0];
        window.__draws.push({ sx: a[1], sy: a[2], x: f.x, y: f.y, mode: f.mode });
      }
      return draw.apply(this, a);
    };
  });
  await openDemo(page, { seed: 5, count: 1, stopProbability: 0, runMean: 60 });
  await waitForRenderer(page, 'sprite');
  await page.evaluate(() => { window.__record = true; });
  await page.waitForTimeout(4000);
  const draws = await page.evaluate(() => window.__draws);

  const walk = META.clips.walk;
  const stride = walk.strideBL * (await snapshot(page)).params.size;
  // Split into uninterrupted stretches of walking (row 0 drawn while in run mode).
  const segments = [];
  let cur = [];
  for (const d of draws) {
    if (d.mode === 'run' && d.sy === walk.row * META.frameHeight) cur.push(d);
    else if (cur.length) segments.push(cur), (cur = []);
  }
  if (cur.length) segments.push(cur);

  let windows = 0;
  for (const seg of segments) {
    const dist = [0];
    for (let i = 1; i < seg.length; i++) dist.push(dist[i - 1] + Math.hypot(seg[i].x - seg[i - 1].x, seg[i].y - seg[i - 1].y));
    const maxStep = Math.max(0, ...dist.slice(1).map((d, i) => d - dist[i]));
    // Cumulative frame advance. A long display frame (a dropped frame) may skip a frame index;
    // the index still follows distance, so count advances rather than requiring single steps.
    const advance = [0];
    for (let i = 1; i < seg.length; i++) {
      const step = (seg[i].sx - seg[i - 1].sx) / META.frameWidth;
      const inc = (step + walk.frames) % walk.frames;
      expect(inc).toBeLessThan(walk.frames / 2); // always forward, never jumping back
      advance.push(advance[i - 1] + inc);
    }
    // From a frame change to the draw where the advance reaches walk.frames more, the fly has
    // travelled one stride, give or take a display frame's movement at each end.
    for (let i = 1; i < seg.length; i++) {
      if (advance[i] === advance[i - 1]) continue;
      const j = advance.findIndex((a, k) => k > i && a >= advance[i] + walk.frames);
      if (j < 0) break;
      if (advance[j] !== advance[i] + walk.frames) continue; // the end was skipped over
      expect(Math.abs((dist[j] - dist[i]) - stride)).toBeLessThanOrEqual(2 * maxStep + 1e-6);
      windows++;
    }
  }
  expect(windows).toBeGreaterThan(0);
});
