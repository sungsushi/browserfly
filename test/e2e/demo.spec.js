// M2 e2e tests 1–4, 8, 9 and 12 against the demo page.
import { test, expect } from '@playwright/test';
import { trackErrors, countRaf, openDemo, snapshot, canvasAlpha } from './helpers.js';

test('1. clean load: no console errors, one click-through canvas', async ({ page }) => {
  const errors = trackErrors(page);
  await openDemo(page);
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const canvases = document.querySelectorAll('canvas');
    const c = canvases[0];
    return { n: canvases.length, pe: c && getComputedStyle(c).pointerEvents,
             hidden: c && c.getAttribute('aria-hidden'), role: c && c.getAttribute('role') };
  });
  expect(info.n).toBe(1);
  expect(info.pe).toBe('none');
  expect(info.hidden).toBe('true'); // decorative: hidden from assistive technology (M6)
  expect(info.role).toBe('presentation');
  expect(errors).toEqual([]);
});

test('2. click-through: the button under the canvas receives clicks', async ({ page }) => {
  await openDemo(page, { count: 10, size: 120 });
  await page.click('#target');
  await page.click('#target');
  await expect(page.locator('#clicks')).toHaveText('2 clicks');
});

test('3. visible output: the canvas has opaque pixels at the fly', async ({ page }) => {
  await openDemo(page, { seed: 3 });
  await page.waitForTimeout(500);
  // Read the position and the pixels in one task so no frame runs in between.
  const alpha = await page.evaluate(() => {
    const f = window.swarm.debug().flies[0];
    const c = document.querySelector('canvas');
    const dpr = c.width / c.clientWidth;
    return c.getContext('2d').getImageData(Math.round(f.x * dpr) - 1, Math.round(f.y * dpr) - 1, 3, 3).data[3 + 4 * 4];
  });
  expect(alpha).toBeGreaterThan(200);
});

test('4. attraction end-to-end: the fly reaches the arrival radius within 20 s', async ({ page }) => {
  test.setTimeout(40000);
  await openDemo(page, { seed: 1, attraction: 1 });
  const snap = await snapshot(page);
  const f = snap.flies[0];
  const { w, h } = snap.bounds;
  // A point 400 px from the fly, inside the page, preferring the direction of the centre.
  const toCentre = Math.atan2(h / 2 - f.y, w / 2 - f.x);
  let target = null;
  for (let k = 0; k < 72 && !target; k++) {
    const a = toCentre + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 36);
    const p = { x: f.x + 400 * Math.cos(a), y: f.y + 400 * Math.sin(a) };
    if (p.x > 40 && p.x < w - 40 && p.y > 40 && p.y < h - 40) target = p;
  }
  expect(target).not.toBeNull();
  await page.mouse.move(target.x, target.y);

  const radius = snap.params.arrivalRadius * snap.params.size;
  await expect.poll(async () => {
    const s = await snapshot(page);
    const fly = s.flies[0];
    return s.cursor ? Math.hypot(fly.x - s.cursor.x, fly.y - s.cursor.y) : Infinity;
  }, { timeout: 20000, intervals: [100] }).toBeLessThan(radius);
});

test('8. destroy removes the canvas, stops the loop and is idempotent', async ({ page }) => {
  await countRaf(page);
  const errors = trackErrors(page);
  await openDemo(page);
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.__rafCount);
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => window.swarm.destroy());
  expect(await page.locator('canvas').count()).toBe(0);
  const atDestroy = await page.evaluate(() => window.__rafCount);
  await page.waitForTimeout(400);
  // At most one already-queued callback may still run (and bail out).
  expect(await page.evaluate(() => window.__rafCount)).toBeLessThanOrEqual(atDestroy + 1);
  await page.evaluate(() => window.swarm.destroy());
  expect(await page.evaluate(() => window.Fly.instances.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('9. live updates: count changes add and remove flies', async ({ page }) => {
  const errors = trackErrors(page);
  await openDemo(page);
  await page.evaluate(() => window.swarm.set({ count: 5 }));
  await page.waitForTimeout(200);
  expect((await snapshot(page)).flies.length).toBe(5);
  await page.evaluate(() => window.swarm.set({ count: 2 }));
  await page.waitForTimeout(200);
  expect((await snapshot(page)).flies.length).toBe(2);
  expect(errors).toEqual([]);
});

test('mouse leaving the page clears the cursor', async ({ page }) => {
  await openDemo(page);
  await page.mouse.move(300, 300);
  await expect.poll(async () => (await snapshot(page)).cursor).toEqual({ x: 300, y: 300 });
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: null })));
  expect((await snapshot(page)).cursor).toBeNull();
});

test('pause and resume stop and restart the loop', async ({ page }) => {
  await openDemo(page, { seed: 5, stopProbability: 0, speed: 5 });
  await page.evaluate(() => window.swarm.pause());
  const a = (await snapshot(page)).flies[0];
  await page.waitForTimeout(500);
  const b = (await snapshot(page)).flies[0];
  expect([b.x, b.y]).toEqual([a.x, a.y]);
  expect(await canvasAlpha(page).then((r) => r.count)).toBeGreaterThan(0);
  await page.evaluate(() => window.swarm.resume());
  await page.waitForTimeout(500);
  const c = (await snapshot(page)).flies[0];
  expect([c.x, c.y, c.theta]).not.toEqual([b.x, b.y, b.theta]);
});

test('12. performance (soft): 20 flies, mean script time per frame', async ({ page }, info) => {
  await page.addInitScript(() => {
    window.__frameMs = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'fly:frame') window.__frameMs.push(e.duration);
    }).observe({ type: 'measure' });
  });
  await openDemo(page, { count: 20 });
  await page.waitForTimeout(3000);
  const ms = await page.evaluate(() => window.__frameMs);
  expect(ms.length).toBeGreaterThan(30);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  const note = `20 flies: mean ${mean.toFixed(3)} ms/frame over ${ms.length} frames`;
  console.log(`[perf ${info.project.name}] ${note}`);
  info.annotations.push({ type: 'perf', description: note });
  if (mean >= 2) {
    info.annotations.push({ type: 'warning', description: `over the 2 ms soft budget: ${note}` });
    console.warn(`[perf ${info.project.name}] WARNING over 2 ms soft budget`);
  }
});
