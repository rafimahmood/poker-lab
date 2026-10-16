import { expect, test } from '@playwright/test';
import { PANELS, mockApi, watchErrors } from './helpers';

test.beforeEach(async ({ page }) => { await mockApi(page); });

test('every panel opens without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('html[data-ready="1"]')).toBeAttached();
  for (const id of PANELS) {
    await page.goto('/#' + id);
    await expect(page.locator('#p-' + id)).toBeVisible();
    for (const other of PANELS.filter((p) => p !== id)) await expect(page.locator('#p-' + other)).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test('top-level navigation and sub-tabs work', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Study' }).click();
  await expect(page.locator('#p-ranges')).toBeVisible();
  await page.getByRole('link', { name: 'Bet sizing' }).click();
  await expect(page.locator('#p-theory')).toBeVisible();
  await page.getByRole('tab', { name: 'Coach' }).click();
  await expect(page.locator('#p-coach')).toBeVisible();
  await page.getByRole('tab', { name: 'Study' }).click();
  await expect(page.locator('#p-theory')).toBeVisible(); // remembers last sub-tab
});

test('equity calculator: AKs vs QQ is a coin flip', async ({ page }) => {
  await page.goto('/#equity');
  await page.locator('#e-hero').fill('Ah Kh');
  await page.locator('#e-vill').fill('Qs Qd');
  await page.locator('#e-board').fill('');
  await page.locator('#e-run').click();
  await expect(page.locator('#e-run')).toBeEnabled({ timeout: 15_000 });
  const eq = parseFloat((await page.locator('#e-eq').textContent())!);
  expect(eq).toBeGreaterThan(43);
  expect(eq).toBeLessThan(49);
});

test('equity calculator validates input', async ({ page }) => {
  await page.goto('/#equity');
  await page.locator('#e-hero').fill('Ah');
  await page.locator('#e-run').click();
  await expect(page.locator('#e-err')).toContainText(/rank and a suit|exactly 2/);
});

test('ICM calculator prices a call above 50%', async ({ page }) => {
  await page.goto('/#icm');
  await page.locator('#i-run').click();
  const need = parseFloat((await page.locator('#i-req').textContent())!);
  expect(need).toBeGreaterThan(50);
});

test('preflop ranges: chart, modes and drill', async ({ page }) => {
  await page.goto('/#ranges');
  await expect(page.locator('#rg-grid > div')).toHaveCount(169);
  await expect(page.locator('#rg-pct')).toContainText('Play');
  await page.getByRole('button', { name: 'Facing a raise (2-bet)' }).click();
  await expect(page.locator('#rg-title')).toContainText('raise');
  await page.getByRole('button', { name: 'Facing an all-in' }).click();
  await expect(page.locator('#rg-stacks')).toBeVisible();
  await page.locator('#rgd-fold').click();
  await expect(page.locator('#rgd-out .verdict')).toBeVisible();
});

test('practice hands: make a decision and see scored feedback; record persists', async ({ page }) => {
  await page.goto('/#practice');
  await expect(page.locator('#pr-opts button').first()).toBeVisible();
  await page.locator('#pr-opts button').first().click();
  await expect(page.locator('#pr-fb .verdict')).toBeVisible();
  await expect(page.locator('#pr-fb .pill')).toContainText(/Best play|Fine, mixed play|Mistake/);
  // play to the end of the hand
  for (let i = 0; i < 12 && !(await page.locator('#pr-next').isVisible()); i++) {
    await page.locator('#pr-opts button').last().click();
  }
  await expect(page.locator('#pr-next')).toBeVisible();
  await expect(page.locator('#pr-score')).toContainText('1 hand');
  await page.reload();
  await expect(page.locator('#pr-score')).toContainText('1 hand');
});

test('results: add an event, see ROI, survive reload, delete', async ({ page }) => {
  await page.goto('/#results');
  await page.locator('#r-name').fill('Friday freezeout');
  await page.locator('#r-buy').fill('30');
  await page.locator('#r-prize').fill('90');
  await page.locator('#r-add').click();
  await expect(page.locator('#r-msg')).toHaveText('Saved.');
  await expect(page.locator('#r-list')).toContainText('Friday freezeout');
  await expect(page.locator('#r-stats')).toContainText('200%');
  await page.reload();
  await expect(page.locator('#r-list')).toContainText('Friday freezeout');
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.locator('#r-list')).toContainText('No results yet');
});

test('tracker: paste a hand history and get stats, then back up and restore', async ({ page }) => {
  const hh = `PokerStars Hand #250000000001: Tournament #3000000001, $1.00+$0.10 USD Hold'em No Limit - Level I (10/20) - 2025/03/01 20:15:00 ET
Table '3000000001 1' 6-max Seat #3 is the button
Seat 1: Alice (1500 in chips)
Seat 2: Hero (1500 in chips)
Seat 3: Bob (1500 in chips)
Seat 4: Carol (1500 in chips)
Carol: posts small blind 10
Alice: posts big blind 20
*** HOLE CARDS ***
Dealt to Hero [Ah Kd]
Hero: raises 40 to 60
Bob: folds
Carol: folds
Alice: folds
Uncalled bet (40) returned to Hero
Hero collected 50 from pot
*** SUMMARY ***`;
  await page.goto('/#stars');
  await page.locator('#ps-paste').fill(hh);
  await page.locator('#ps-pastebtn').click();
  await expect(page.locator('#ps-msg')).toContainText('Imported 1 new hand');
  await expect(page.locator('#ps-stats')).toContainText('VPIP');
  await expect(page.locator('#ps-stats')).toContainText('100%');
  // importing again skips the duplicate
  await page.locator('#ps-paste').fill(hh);
  await page.locator('#ps-pastebtn').click();
  await expect(page.locator('#ps-msg')).toContainText('already imported');
  // backup
  await page.goto('/#data');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#data-export').click()]);
  expect(dl.suggestedFilename()).toMatch(/^poker-lab-backup-\d{4}-\d{2}-\d{2}\.json$/);
});

test('hand review: validation and saving without AI', async ({ page }) => {
  await page.goto('/#review');
  await page.locator('#hr-savebtn').click();
  await expect(page.locator('#hr-msg')).toHaveText('Add your two cards.');
  await page.locator('#hr-cards').fill('Th Tc');
  await page.locator('#hr-a-pre').fill('Folds to me, I raise, BB calls.');
  await page.locator('#hr-savebtn').click();
  await expect(page.locator('#hr-msg')).toHaveText('Saved.');
  await expect(page.locator('#hr-list')).toContainText('BTN');
});

test('live session: start a heads-up game and record a hand', async ({ page }) => {
  await page.goto('/#live');
  await page.locator('#lv-me').fill('Rafi');
  await page.locator('#lv-opp').fill('Sam');
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(page.locator('#lv-play')).toBeVisible();
  await page.locator('#lv-cards').fill('Ah Kd');
  await expect(page.locator('#lv-coachout .sugg')).toBeVisible({ timeout: 10_000 });
  await page.locator('#lv-actions button[data-lv="fold"]').click();
  await expect(page.locator('#lv-actions')).toContainText('wins');
});

test('theory slider updates the numbers', async ({ page }) => {
  await page.goto('/#theory');
  await page.locator('#t-size').fill('100');
  await expect(page.locator('#t-sizeval')).toHaveText('100%');
  await expect(page.locator('#t-stats')).toContainText('33.3%');
});
