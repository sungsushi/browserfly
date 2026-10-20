// M2 e2e tests 5–7, 10, 11 and auto-init: reduced motion, resize, DPR, container, touch.
import { test, expect } from '@playwright/test';
import { trackErrors, openDemo, snapshot, nextFrame, canvasAlpha, expectInsideInset } from './helpers.js';

test.describe('5. reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test("'static' keeps flies still but drawn", async ({ page }) => {
    await openDemo(page, { seed: 2, count: 3 });
    const a = (await snapshot(page)).flies;
    await page.waitForTimeout(2000);
    const b = (await snapshot(page)).flies;
    expect(b.map((f) => [f.x, f.y, f.theta])).toEqual(a.map((f) => [f.x, f.y, f.theta]));
    expect((await canvasAlpha(page)).count).toBeGreaterThan(0);
  });

  test("'hide' draws nothing", async ({ page }) => {
    await openDemo(page, { seed: 2, count: 3, reducedMotion: 'hide' });
    await page.waitForTimeout(300);
    expect((await canvasAlpha(page)).max).toBe(0);
  });

  test('live media-query changes are followed', async ({ page }) => {
    await openDemo(page, { seed: 2, stopProbability: 0 });
    const a = (await snapshot(page)).flies[0];
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(500);
    const b = (await snapshot(page)).flies[0];
    expect([b.x, b.y, b.theta]).not.toEqual([a.x, a.y, a.theta]);
  });
});

test('6. resize: flies are inside the new inset bounds within one frame', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await openDemo(page, { seed: 4, count: 10 });
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 400, height: 300 });
  await nextFrame(page);
  const snap = await snapshot(page);
  expect(snap.bounds.w).toBeLessThanOrEqual(400);
  expect(snap.bounds.h).toBeLessThanOrEqual(300);
  expect(snap.bounds.w).toBeGreaterThan(300);
  expect(snap.flies).toHaveLength(10);
  expectInsideInset(snap);
});

test.describe('7. high DPR', () => {
  test.use({ deviceScaleFactor: 2 });

  test('the backing store is twice the CSS size', async ({ page }) => {
    await openDemo(page);
    const size = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, dpr: devicePixelRatio };
    });
    expect(size.dpr).toBe(2);
    expect(size.w).toBe(size.cw * 2);
    expect(size.h).toBe(size.ch * 2);
  });
});

test.describe('10. container mode', () => {
  test('flies stay inside the container and the canvas is its child', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/test/fixtures/container.html');
    expect(await page.evaluate(() => document.querySelector('canvas').parentElement.id)).toBe('box');
    const box = await page.locator('#box').boundingBox();
    for (let i = 0; i < 10; i++) {
      const snap = await snapshot(page);
      expect(snap.bounds).toEqual({ w: 500, h: 300 });
      expectInsideInset(snap);
      await page.waitForTimeout(200);
    }
    // The cursor is reported in container coordinates. Firefox snaps pointer coordinates to
    // 1/60 px layout units and the box sits at a fractional offset, so allow half a pixel.
    await page.mouse.move(box.x + 100, box.y + 50);
    await expect.poll(async () => {
      const c = (await snapshot(page)).cursor;
      return c ? Math.max(Math.abs(c.x - 100), Math.abs(c.y - 50)) : Infinity;
    }).toBeLessThan(0.5);
    // A static container was made relative (with a warning, not an error).
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#box')).position)).toBe('relative');
    expect(errors).toEqual([]);
  });

  test('the loop pauses while the container is off-screen', async ({ page }) => {
    await page.goto('/test/fixtures/container.html');
    await expect.poll(async () => (await snapshot(page)).running).toBe(true);
    await page.evaluate(() => {
      document.body.style.paddingBottom = '3000px';
      window.scrollTo(0, 2000);
    });
    await expect.poll(async () => (await snapshot(page)).running).toBe(false);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await snapshot(page)).running).toBe(true);
  });
});

test.describe('11. touch', () => {
  test.use({
    hasTouch: true,
    // Firefox does not support isMobile; touch events still work with hasTouch.
    isMobile: async ({ browserName }, use) => use(browserName !== 'firefox'),
    viewport: { width: 390, height: 844 },
  });

  test('a tap is the cursor until touchTargetTimeout', async ({ page }) => {
    await openDemo(page, { touchTargetTimeout: 1 });
    await page.touchscreen.tap(150, 200);
    const cursor = (await snapshot(page)).cursor;
    expect(cursor).not.toBeNull();
    expect(cursor.x).toBeCloseTo(150, 0);
    expect(cursor.y).toBeCloseTo(200, 0);
    await page.waitForTimeout(1300);
    expect((await snapshot(page)).cursor).toBeNull();
  });
});

test('auto-init from <script data-fly> data attributes', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/test/fixtures/autoinit.html');
  await page.waitForFunction(() => window.Fly && window.Fly.instances.length === 1);
  const snap = await page.evaluate(() => window.Fly.instances[0].debug());
  expect(snap.flies).toHaveLength(2);
  expect(snap.params).toMatchObject({ count: 2, attraction: 0.4, runMean: 3, debug: true });
  expect(await page.locator('canvas').count()).toBe(1);
  expect(errors).toEqual([]);
});
