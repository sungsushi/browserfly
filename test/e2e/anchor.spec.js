// M8 e2e tests 1–11: page-anchored flies (PLAN.md §4.10) on a ~4000 px page.
import { test, expect } from '@playwright/test';

const SIZE = 48;

async function openLongPage(page) {
  await page.goto('/test/fixtures/long-page.html');
  await page.waitForFunction(() => window.Fly);
}

/** Creates window.swarm (procedural renderer: no asynchronous switch during pixel checks). */
const create = (page, opts) => page.evaluate((o) => {
  window.swarm = window.Fly.create({ sprite: 'procedural', size: 48, ...o });
}, opts);

const snap = (page) => page.evaluate(() => window.swarm.debug());

/** Scrolls the window and waits until the scroll and the following frames have been handled. */
const scrollTo = (page, y) => page.evaluate(async (y) => {
  window.scrollTo(0, y);
  for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
}, y);

const frames = (page, n = 2) => page.evaluate(async (n) => {
  for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
}, n);

/** Canvas alpha at a viewport (screen) point in CSS px. */
const alphaAt = (page, x, y) => page.evaluate(([x, y]) => {
  const c = document.querySelector('canvas');
  const dpr = c.width / c.clientWidth;
  return c.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data[3];
}, [x, y]);

const viewportHeight = (page) => page.evaluate(() => document.querySelector('canvas').clientHeight);

test('1. spawn in view: page-anchored flies start inside the visible band', async ({ page }) => {
  await openLongPage(page);
  await scrollTo(page, 1500);
  await create(page, { anchor: 'page', count: 10, seed: 11 });
  const s = await snap(page);
  const vh = await viewportHeight(page);
  expect(s.anchor).toBe('page');
  expect(s.scroll.y).toBe(1500);
  for (const f of s.flies) {
    expect(f.y).toBeGreaterThanOrEqual(1500 + SIZE / 2 - 1e-6);
    expect(f.y).toBeLessThanOrEqual(1500 + vh - SIZE / 2 + 1e-6);
  }
  expect(s.bounds.h).toBeGreaterThan(3500); // the whole page is the walking area
});

test('2. anchoring: after scrolling, a fly is drawn where its page position now is on screen', async ({ page }) => {
  await openLongPage(page);
  await scrollTo(page, 1000);
  await create(page, { anchor: 'page', count: 10, seed: 12 });
  await page.evaluate(() => window.swarm.pause());
  const before = await snap(page);
  // A fly low enough on screen to stay visible after scrolling down by 300 px, with no other fly
  // near its old screen position.
  const others = (f) => before.flies.filter((g) => g !== f);
  const f = before.flies.find((g) => g.y - 1000 > 340 && others(g).every((h) => Math.hypot(h.x - g.x, h.y - g.y) > 2 * SIZE));
  expect(f).toBeTruthy();
  const screenY = f.y - 1000;
  expect(await alphaAt(page, f.x, screenY)).toBeGreaterThan(200);
  await scrollTo(page, 1300);
  const after = await snap(page);
  const g = after.flies[before.flies.indexOf(f)];
  expect([g.x, g.y]).toEqual([f.x, f.y]); // page position unchanged
  expect(await alphaAt(page, f.x, screenY - 300)).toBeGreaterThan(200);
  expect(await alphaAt(page, f.x, screenY)).toBe(0);
});

test('3. viewport mode is unchanged: the same scroll leaves the fly on screen where it was', async ({ page }) => {
  await openLongPage(page);
  await create(page, { count: 1, seed: 12 });
  await page.evaluate(() => window.swarm.pause());
  const f = (await snap(page)).flies[0];
  await scrollTo(page, 300);
  const s = await snap(page);
  expect(s.anchor).toBe('viewport');
  expect([s.flies[0].x, s.flies[0].y]).toEqual([f.x, f.y]);
  expect(await alphaAt(page, f.x, f.y)).toBeGreaterThan(200);
});

test('4. off-screen flies keep walking and are drawn where debug() says when scrolled back', async ({ page }) => {
  await openLongPage(page);
  await create(page, { anchor: 'page', count: 1, seed: 13, stopProbability: 0 });
  const f0 = (await snap(page)).flies[0];
  await scrollTo(page, 2600); // the fly spawned in the first screen, so it is now out of view
  await page.waitForTimeout(1000);
  const f1 = (await snap(page)).flies[0];
  expect(Math.hypot(f1.x - f0.x, f1.y - f0.y)).toBeGreaterThan(5);
  await page.evaluate(() => window.swarm.pause());
  const f = (await snap(page)).flies[0];
  const vh = await viewportHeight(page);
  await scrollTo(page, Math.max(0, f.y - vh / 2));
  const s = await snap(page);
  expect(await alphaAt(page, f.x, f.y - s.scroll.y)).toBeGreaterThan(200);
});

test('5. cursor: page coordinates that follow the scroll under a still mouse', async ({ page }) => {
  await openLongPage(page);
  await scrollTo(page, 800);
  await create(page, { anchor: 'page', count: 1 });
  await page.mouse.move(300, 200);
  await expect.poll(async () => (await snap(page)).cursor).toEqual({ x: 300, y: 1000 });
  await scrollTo(page, 1050); // scroll without moving the mouse
  expect((await snap(page)).cursor).toEqual({ x: 300, y: 1250 });
});

test.describe('5b. cursor with touch', () => {
  test.use({
    hasTouch: true,
    isMobile: async ({ browserName }, use) => use(browserName !== 'firefox'),
    viewport: { width: 390, height: 844 },
  });

  test('a tap stays at its page position when the page scrolls', async ({ page }) => {
    await openLongPage(page);
    await scrollTo(page, 600);
    await create(page, { anchor: 'page', count: 1 });
    await page.touchscreen.tap(150, 200);
    const c0 = (await snap(page)).cursor;
    expect(c0.x).toBeCloseTo(150, 0);
    expect(c0.y).toBeCloseTo(800, 0);
    await scrollTo(page, 900);
    const c1 = (await snap(page)).cursor;
    expect(c1.x).toBeCloseTo(150, 0);
    expect(c1.y).toBeCloseTo(800, 0);
  });
});

test('6. bounds follow the page height; flies are clamped when the page shrinks', async ({ page }) => {
  await openLongPage(page);
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  await scrollTo(page, docH); // the bottom of the page
  await create(page, { anchor: 'page', count: 10, seed: 16 });
  const b0 = (await snap(page)).bounds.h;
  expect(b0).toBe(docH);

  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'extra';
    div.style.height = '1000px';
    document.getElementById('content').appendChild(div);
  });
  await frames(page);
  expect((await snap(page)).bounds.h).toBe(b0 + 1000);

  await page.evaluate(() => {
    document.getElementById('extra').remove();
    document.querySelectorAll('section').forEach((el, i) => { if (i >= 5) el.style.display = 'none'; });
  });
  await frames(page);
  const s = await snap(page);
  expect(s.bounds.h).toBeLessThan(b0 - 2500);
  for (const f of s.flies) {
    expect(f.y).toBeGreaterThanOrEqual(SIZE / 2 - 1e-6);
    expect(f.y).toBeLessThanOrEqual(s.bounds.h - SIZE / 2 + 1e-6);
  }
});

test.describe('7. no giant canvas', () => {
  test.use({ deviceScaleFactor: 2 });

  test('in page mode the canvas stays viewport-sized', async ({ page }) => {
    await openLongPage(page);
    await create(page, { anchor: 'page', count: 3 });
    const c = await page.evaluate(() => {
      const el = document.querySelector('canvas');
      return { h: el.height, ch: el.clientHeight, ih: innerHeight, dpr: devicePixelRatio, docH: document.documentElement.scrollHeight };
    });
    expect(c.docH).toBeGreaterThan(3500);
    expect(c.ch).toBeLessThanOrEqual(c.ih);
    expect(c.h).toBe(Math.round(c.ch * c.dpr));
  });
});

test.describe('8. static reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('positions never change and flies follow the content when scrolled', async ({ page }) => {
    await openLongPage(page);
    await scrollTo(page, 1000);
    await create(page, { anchor: 'page', count: 10, seed: 18 });
    const a = (await snap(page)).flies;
    await page.waitForTimeout(1000);
    const b = (await snap(page)).flies;
    expect(b.map((f) => [f.x, f.y])).toEqual(a.map((f) => [f.x, f.y]));
    const f = a.find((g) => g.y - 1000 > 260 && a.every((h) => h === g || Math.hypot(h.x - g.x, h.y - g.y) > 2 * SIZE));
    expect(f).toBeTruthy();
    await scrollTo(page, 1200);
    expect(await alphaAt(page, f.x, f.y - 1200)).toBeGreaterThan(200);
    expect(await alphaAt(page, f.x, f.y - 1000)).toBe(0);
  });
});

test('9. live switching: no fly moves on screen when the anchor changes', async ({ page }) => {
  await openLongPage(page);
  await scrollTo(page, 700);
  await create(page, { count: 10, seed: 19 });
  await page.evaluate(() => window.swarm.pause());
  const vh = await viewportHeight(page);
  const screen = (s) => s.flies.map((f) => ({ x: f.x, y: f.y - s.scroll.y }));
  const s0 = await snap(page);
  const inside = (p) => p.y >= SIZE / 2 && p.y <= vh - SIZE / 2;

  await page.evaluate(() => window.swarm.set({ anchor: 'page' }));
  const s1 = await snap(page);
  expect(s1.anchor).toBe('page');
  screen(s0).forEach((p, i) => {
    if (!inside(p)) return;
    const q = screen(s1)[i];
    expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThanOrEqual(1);
  });

  await page.evaluate(() => window.swarm.set({ anchor: 'viewport' }));
  const s2 = await snap(page);
  expect(s2.anchor).toBe('viewport');
  screen(s1).forEach((p, i) => {
    if (!inside(p)) return;
    const q = screen(s2)[i];
    expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThanOrEqual(1);
  });
});

test('10. container mode: anchor page warns once and behaves like container mode', async ({ page }) => {
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  await openLongPage(page);
  await page.evaluate(() => { document.getElementById('box').style.position = 'relative'; });
  await create(page, { container: '#box', anchor: 'page', count: 3, size: 24 });
  await page.evaluate(() => window.swarm.set({ count: 4 }));
  const s = await snap(page);
  expect(s.anchor).toBe('viewport');
  expect(s.bounds).toEqual({ w: 400, h: 240 });
  expect(await page.evaluate(() => document.querySelector('canvas').parentElement.id)).toBe('box');
  expect(warnings.filter((w) => /anchor/.test(w))).toHaveLength(1);
});

test('11. performance (soft): 20 page-anchored flies on a long page', async ({ page }, info) => {
  await page.addInitScript(() => {
    window.__frameMs = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === 'fly:frame') window.__frameMs.push(e.duration);
    }).observe({ type: 'measure' });
  });
  await openLongPage(page);
  await create(page, { anchor: 'page', count: 20, sprite: 'auto', size: 25 });
  await page.waitForTimeout(3000);
  const ms = await page.evaluate(() => window.__frameMs);
  expect(ms.length).toBeGreaterThan(30);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  const note = `20 page-anchored flies: mean ${mean.toFixed(3)} ms/frame over ${ms.length} frames`;
  console.log(`[perf ${info.project.name}] ${note}`);
  info.annotations.push({ type: 'perf', description: note });
  if (mean >= 2) console.warn(`[perf ${info.project.name}] WARNING over 2 ms soft budget`);
});
