// Demo-only text wrapping around the flies (demo/textwrap.js): 'live' (reflow, settled) and 'off'.
import { test, expect } from '@playwright/test';

async function openDemo(page, query) {
  await page.goto(`/demo/?${query}`);
  await page.waitForFunction(() => window.textWrap && window.swarm);
  await page.evaluate(() => window.textWrap.ready);
}

const frames = (page, n = 3) => page.evaluate(async (n) => {
  for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
}, n);

/** For each fly (client coordinates) the line spans whose box comes inside radius r·k. */
function overlaps(page, k) {
  return page.evaluate((k) => {
    const d = window.swarm.debug();
    // A zone may lag its fly by up to `lag` px (re-layout only after that much movement).
    const { r, lag } = window.textWrap.clearance(d.params.size);
    const toClient = d.anchor === 'page' ? -window.scrollY : 0;
    const spans = [...document.querySelectorAll('.tw-line')].map((s) => s.getBoundingClientRect());
    const quote = document.querySelector('blockquote').getBoundingClientRect();
    const out = { checked: 0, hits: [] };
    for (const f of d.flies) {
      const cx = f.x;
      const cy = f.y + toClient;
      if (cy < quote.top - r || cy > quote.bottom + r || cx < quote.left - r || cx > quote.right + r) continue;
      out.checked++;
      for (const b of spans) {
        const dx = Math.max(b.left - cx, 0, cx - b.right);
        const dy = Math.max(b.top - cy, 0, cy - b.bottom);
        // 1.5 px tolerance for canvas vs DOM sub-pixel text widths.
        if (Math.hypot(dx, dy) < r * k - lag - 1.5) out.hits.push({ fly: [cx, cy], span: [b.left, b.top, b.right, b.bottom] });
      }
    }
    return out;
  }, k);
}

/** Each quote paragraph's words in order, whether laid out by textwrap.js or by the browser. */
const paragraphText = (page) => page.evaluate(() =>
  [...document.querySelectorAll('blockquote p:not(.elision)')].map((p) => {
    const lines = [...p.querySelectorAll('.tw-line')].map((s) => s.textContent);
    const cap = p.querySelector('.tw-cap');
    const text = lines.length ? (cap ? cap.textContent : '') + lines.join(' ') : p.textContent;
    return text.replace(/\s+/g, ' ').trim();
  }));

test('live: no line of text enters a fly\'s clear zone, and no words are lost', async ({ page }) => {
  await openDemo(page, 'wrap=live&count=6&size=60&seed=4');
  await page.waitForTimeout(500);
  await page.evaluate(() => window.swarm.pause());
  await frames(page);
  const res = await overlaps(page, 1);
  expect(res.checked).toBeGreaterThan(0); // at least one fly is over the quotation
  expect(res.hits).toEqual([]);

  const wrapped = await paragraphText(page);
  await page.evaluate(() => window.textWrap.setMode('off'));
  expect(await paragraphText(page)).toEqual(wrapped);
});

test('off: restores the browser-laid-out text exactly', async ({ page }) => {
  await openDemo(page, 'wrap=off&count=3');
  const original = await page.evaluate(() => document.querySelector('blockquote').innerHTML);
  await page.evaluate(() => window.textWrap.setMode('live'));
  await frames(page);
  expect(await page.locator('.tw-line').count()).toBeGreaterThan(20);
  await page.evaluate(() => window.textWrap.setMode('off'));
  expect(await page.evaluate(() => document.querySelector('blockquote').innerHTML)).toBe(original);
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('wrapping is off: the browser lays out the text', async ({ page }) => {
    await openDemo(page, 'wrap=live&count=3');
    await frames(page);
    expect(await page.locator('.tw-line').count()).toBe(0);
  });
});
