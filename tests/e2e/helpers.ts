import type { Page } from '@playwright/test';

export const PANELS = ['practice', 'live', 'ranges', 'lessons', 'hands', 'theory', 'stars', 'review', 'results', 'data', 'equity', 'icm', 'coach'];

/** Collect console errors and uncaught exceptions. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|fonts\.g/.test(m.text())) errors.push('console: ' + m.text()); });
  return errors;
}

/** The AI backend does not exist under `vite`; stub it. */
export async function mockApi(page: Page, opts: { configured?: boolean; remaining?: number; chat?: 'ok' | 'limit' } = {}) {
  await page.route('**/api/status', (r) => r.fulfill({ json: { configured: opts.configured ?? true, accessCodeEnabled: true, codeValid: false, freePerDay: 5, freeRemaining: opts.remaining ?? 5 } }));
  await page.route('**/api/chat', async (r) => {
    if (opts.chat === 'limit') {
      return r.fulfill({ status: 429, json: { error: 'free_limit', message: "You've used your 5 free coach messages for today. Enter the access code to keep going, or come back tomorrow." } });
    }
    const ev = (name: string, d: unknown) => `event: ${name}\ndata: ${JSON.stringify(d)}\n\n`;
    const body = ev('meta', { tier: 'free', remaining: 4 }) +
      ev('tool_start', { type: 'tool_start', id: 't1', name: 'calc_equity', args: { hero: 'AhKh', villain: 'QsQd' } }) +
      ev('tool', { type: 'tool', id: 't1', name: 'calc_equity', args: { hero: 'AhKh', villain: 'QsQd' }, result: { equity: 0.46 } }) +
      ev('delta', { type: 'delta', text: 'The calculator gives **46%**, ' }) + ev('delta', { type: 'delta', text: 'so it is a coin flip.' }) +
      ev('done', { type: 'done', rounds: 2 });
    await r.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
}
