// Shared helpers for the e2e tests.
import { expect } from '@playwright/test';

/** Collects console errors and uncaught page errors. */
export function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Counts rAF callbacks that actually run (installed before any page script). */
export async function countRaf(page) {
  await page.addInitScript(() => {
    window.__rafCount = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => {
      window.__rafCount++;
      cb(t);
    });
  });
}

/** Opens the demo with the given options as query parameters. */
export async function openDemo(page, options = {}) {
  const q = new URLSearchParams(Object.entries(options).map(([k, v]) => [k, String(v)]));
  await page.goto(`/demo/?${q}`);
  await page.waitForFunction(() => window.swarm && window.swarm.debug().flies.length > 0);
}

export const snapshot = (page) => page.evaluate(() => window.swarm.debug());

/** Resolves after the next animation frame has run. */
export const nextFrame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

/** Alpha values of the canvas in a CSS-pixel rectangle (or the whole canvas). */
export function canvasAlpha(page, rect = null) {
  return page.evaluate((rect) => {
    const c = document.querySelector('canvas');
    const ctx = c.getContext('2d');
    const dpr = c.width / c.clientWidth;
    const r = rect
      ? [Math.round(rect.x * dpr), Math.round(rect.y * dpr), Math.max(1, Math.round(rect.w * dpr)), Math.max(1, Math.round(rect.h * dpr))]
      : [0, 0, c.width, c.height];
    const data = ctx.getImageData(...r).data;
    let max = 0;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) count++;
      if (data[i] > max) max = data[i];
    }
    return { max, count };
  }, rect);
}

/** Asserts every fly is inside the bounds inset by half a body length. */
export function expectInsideInset(snap) {
  const half = snap.params.size / 2;
  for (const f of snap.flies) {
    expect(f.x).toBeGreaterThanOrEqual(half - 1e-6);
    expect(f.x).toBeLessThanOrEqual(snap.bounds.w - half + 1e-6);
    expect(f.y).toBeGreaterThanOrEqual(half - 1e-6);
    expect(f.y).toBeLessThanOrEqual(snap.bounds.h - half + 1e-6);
  }
}
