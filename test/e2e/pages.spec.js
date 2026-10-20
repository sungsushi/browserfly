// GitHub Pages: the site root forwards to the demo, which works under a project subpath.
import { test, expect } from '@playwright/test';
import { SUBPATH_PORT } from '../../playwright.config.js';

for (const query of ['', '?size=60&count=4']) {
  test(`site root${query || ' (no options)'} forwards to the demo under /my-repo/`, async ({ page }) => {
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });

    // The root page redirects immediately, so don't wait for it to finish loading.
    await page.goto(`http://localhost:${SUBPATH_PORT}/my-repo/${query}`, { waitUntil: 'commit' }).catch(() => {});
    await page.waitForURL(`http://localhost:${SUBPATH_PORT}/my-repo/demo/${query}`);
    await page.waitForFunction(() => window.swarm && window.textWrap);
    await page.evaluate(() => window.textWrap.ready);
    await page.waitForFunction(() => window.swarm.debug().renderer === 'sprite');

    const s = await page.evaluate(() => window.swarm.debug());
    expect(s.sheetUrl).toBe(`http://localhost:${SUBPATH_PORT}/my-repo/dist/fly-sheet.webp`);
    if (query) expect([s.params.size, s.flies.length]).toEqual([60, 4]);
    expect(await page.locator('.tw-line').count()).toBeGreaterThan(20); // text wrapping is on
    expect(problems).toEqual([]);
  });
}
