import { expect, test } from '@playwright/test';
import { PANELS, mockApi } from './helpers';

test.beforeEach(async ({ page }) => { await mockApi(page); });

test('@mobile no panel scrolls sideways at phone width', async ({ page }) => {
  await page.goto('/');
  for (const id of PANELS) {
    await page.goto('/#' + id);
    await expect(page.locator('#p-' + id)).toBeVisible();
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `panel ${id} overflows by ${over}px`).toBeLessThanOrEqual(1);
  }
});

test('@mobile tap targets are at least 40px tall', async ({ page }) => {
  await page.goto('/#practice');
  await expect(page.locator('#pr-opts button').first()).toBeVisible();
  const boxes = await page.locator('#pr-opts button, nav.tabs a').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  for (const h of boxes) expect(h).toBeGreaterThanOrEqual(40);
});
