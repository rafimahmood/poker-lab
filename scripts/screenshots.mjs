// Usage: npm run shots [-- --out screenshots/after] [--only practice,coach]
// Starts the dev server, seeds realistic sample data, and screenshots every panel at desktop and phone size,
// in light and dark mode. Output goes to ./screenshots (git-ignored).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = opt('out', 'screenshots');
const only = opt('only', '') ? opt('only', '').split(',') : null;
const PORT = 4174, BASE = `http://localhost:${PORT}`;
mkdirSync(out, { recursive: true });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(1); });
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* waiting */ } await new Promise((r) => setTimeout(r, 500)); }

const PANELS = ['practice', 'live', 'ranges', 'lessons', 'hands', 'theory', 'stars', 'review', 'results', 'data', 'equity', 'icm', 'coach'];
const HH = readFileSync('tests/unit/fixtures/pokerstars.txt', 'utf8') + '\n\n' + readFileSync('tests/unit/fixtures/ggpoker.txt', 'utf8');

async function mock(page) {
  await page.route('**/api/status', (r) => r.fulfill({ json: { configured: true, accessCodeEnabled: true, codeValid: false, freePerDay: 5, freeRemaining: 4 } }));
  await page.route('**/api/chat', (r) => {
    const ev = (n, d) => `event: ${n}\ndata: ${JSON.stringify(d)}\n\n`;
    r.fulfill({ status: 200, contentType: 'text/event-stream', body:
      ev('meta', { tier: 'free', remaining: 4 }) +
      ev('tool', { type: 'tool', id: '1', name: 'lookup_range', args: { position: 'BTN', situation: 'vs_open', raiser: 'UTG' }, result: { chart_action: 'Call' } }) +
      ev('tool', { type: 'tool', id: '2', name: 'calc_equity', args: { hero: 'AhJd', villain_range: 'TT+,AQs+,AKo' }, result: { equity: 0.34 } }) +
      ev('delta', { text: '## Verdict\n\nThe chart says **fold** AJo to an UTG open from the button at 25 BB.\n\n- The calculator gives **34%** against a strong early-position range.\n- You need about 27% to call, but you will be out of position to the blinds and dominated by AQ+.\n\n## Takeaway\n\nFold AJo to early-position raises; save the calls for suited broadways and pairs.' }) +
      ev('done', { type: 'done' }) });
  });
}

async function seed(page) {
  await page.goto(BASE + '/#stars');
  await page.waitForSelector('html[data-ready="1"]', { state: 'attached' });
  await page.locator('#ps-paste').fill(HH);
  await page.locator('#ps-pastebtn').click();
  await page.goto(BASE + '/#results');
  for (const [name, buy, prize, fmt] of [['Sunday £30 freezeout', 30, 0, 'Live'], ['Tuesday online turbo', 11, 48, 'Online'], ['Home game final', 20, 95, 'Home game'], ['Friday £50 deepstack', 50, 0, 'Live']]) {
    await page.locator('#r-name').fill(name); await page.locator('#r-buy').fill(String(buy)); await page.locator('#r-prize').fill(String(prize));
    await page.locator('#r-fmt').selectOption(fmt); await page.locator('#r-entries').fill('40'); await page.locator('#r-add').click();
    await page.waitForTimeout(80);
  }
  await page.goto(BASE + '/#practice');
  for (let h = 0; h < 4; h++) {
    for (let i = 0; i < 12 && !(await page.locator('#pr-next').isVisible()); i++) await page.locator('#pr-opts button').nth(i % 2).click();
    if (await page.locator('#pr-next').isVisible()) await page.locator('#pr-next').click();
  }
  await page.goto(BASE + '/#coach');
  await page.locator('#chat-input').fill('I have AJo on the button, 25 BB, UTG opens to 2.5 BB. Call or fold?');
  await page.locator('#chat-send').click();
  await page.waitForSelector('.msg.bot .md h3');
}

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' });
const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, dsf: 1 },
  { name: 'mobile', viewport: { width: 390, height: 844 }, dsf: 2, mobile: true },
];
for (const p of profiles) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: p.viewport, deviceScaleFactor: p.dsf, isMobile: !!p.mobile, hasTouch: !!p.mobile, colorScheme: scheme });
    const page = await ctx.newPage();
    await mock(page);
    await seed(page);
    for (const id of PANELS) {
      if (only && !only.includes(id)) continue;
      await page.goto(BASE + '/#' + id);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/${p.name}-${scheme}-${id}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();
stop();
console.log('Saved screenshots to', out);
