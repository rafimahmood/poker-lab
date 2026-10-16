import { expect, test } from '@playwright/test';
import { mockApi, watchErrors } from './helpers';

test('coach chat streams an answer and shows the tool it ran', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page);
  await page.goto('/#coach');
  await expect(page.locator('#ai-status')).toContainText('5 free messages left');
  await page.locator('#chat-input').fill('AKs vs QQ?');
  await page.locator('#chat-send').click();
  await expect(page.locator('.toolchip')).toContainText('Equity AhKh vs QsQd → 46%');
  await expect(page.locator('.msg.coach')).toContainText('The calculator gives 46%, so it is a coin flip.');
  await expect(page.locator('#ai-status')).toContainText('4 free messages left');
  await expect(page.locator('.msg.user')).toContainText('AKs vs QQ?');
  expect(errors).toEqual([]);
  // history survives reload; New chat clears it
  await page.reload();
  await expect(page.locator('.msg.coach')).toContainText('coin flip');
  await page.locator('#chat-new').click();
  await expect(page.locator('.msg')).toHaveCount(0);
});

test('starter prompts send a message', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#coach');
  await page.locator('.chip').first().click();
  await expect(page.locator('.msg.coach')).toContainText('coin flip');
});

test('shows the free-limit message when rate limited', async ({ page }) => {
  await mockApi(page, { chat: 'limit', remaining: 0 });
  await page.goto('/#coach');
  await page.locator('#chat-input').fill('hello');
  await page.locator('#chat-send').click();
  await expect(page.locator('.msg.coach.err')).toContainText('5 free coach messages');
  await expect(page.locator('#chat-send')).toBeEnabled();
});

test('says so when the server has no API key', async ({ page }) => {
  await mockApi(page, { configured: false });
  await page.goto('/#coach');
  await expect(page.locator('#ai-status')).toContainText('Coach offline');
});

test('hand review uses the coach and keeps the review', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#review');
  await page.locator('#hr-cards').fill('Th Tc');
  await page.locator('#hr-a-pre').fill('Folds to me, I raise, BB calls.');
  await page.locator('#hr-reviewbtn').click();
  await expect(page.locator('#hr-out')).toContainText('coin flip');
  await expect(page.locator('#hr-out .toolchip')).toBeVisible();
  await page.reload();
  await expect(page.locator('#hr-list')).toContainText('Reviewed');
});
