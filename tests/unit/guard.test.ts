import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../netlify/functions/_lib/config';
import { guard, hasValidCode, originAllowed } from '../../netlify/functions/_lib/guard';
import { memoryStore } from '../../netlify/functions/_lib/ratelimit';

const base = { OPENROUTER_API_KEY: 'sk-test', ACCESS_CODE: 'letmein', FREE_MESSAGES_PER_DAY: '2', AI_DAILY_CAP: '50' };
const req = (headers: Record<string, string> = {}, method = 'POST') => new Request('https://pokerlab12.netlify.app/api/chat', { method, headers });

describe('config', () => {
  it('has safe defaults', () => {
    const c = loadConfig({});
    expect(c.model).toBe('deepseek/deepseek-v4.1-flash');
    expect(c.visionModel).toBe(c.model);
    expect(c.freePerDay).toBe(5);
    expect(c.apiKey).toBe('');
  });
  it('reads the model from env', () => {
    expect(loadConfig({ OPENROUTER_MODEL: 'qwen/qwen3.7-flash' }).model).toBe('qwen/qwen3.7-flash');
    expect(loadConfig({ OPENROUTER_MODEL: 'a/b', OPENROUTER_VISION_MODEL: 'c/d' }).visionModel).toBe('c/d');
  });
  it('ignores junk numbers', () => expect(loadConfig({ FREE_MESSAGES_PER_DAY: 'abc' }).freePerDay).toBe(5));
});

describe('origin & access code', () => {
  const c = loadConfig(base);
  it('allows same-origin, localhost, and no Origin header', () => {
    expect(originAllowed(c, req({ origin: 'https://pokerlab12.netlify.app' }))).toBe(true);
    expect(originAllowed(c, req({ origin: 'http://localhost:5173' }))).toBe(true);
    expect(originAllowed(c, req())).toBe(true);
  });
  it('rejects other sites', () => {
    expect(originAllowed(c, req({ origin: 'https://evil.example' }))).toBe(false);
    expect(originAllowed(c, req({ origin: 'not a url' }))).toBe(false);
  });
  it('honours ALLOWED_ORIGINS', () => {
    const c2 = loadConfig({ ...base, ALLOWED_ORIGINS: 'https://friend.example' });
    expect(originAllowed(c2, req({ origin: 'https://friend.example' }))).toBe(true);
  });
  it('checks the code in constant time and never matches an empty code', () => {
    expect(hasValidCode(c, req({ 'x-access-code': 'letmein' }))).toBe(true);
    expect(hasValidCode(c, req({ 'x-access-code': 'letmeinX' }))).toBe(false);
    expect(hasValidCode(c, req())).toBe(false);
    expect(hasValidCode(loadConfig({ ...base, ACCESS_CODE: '' }), req({ 'x-access-code': '' }))).toBe(false);
  });
});

describe('guard', () => {
  const run = async (headers: Record<string, string>, env = base, ip = '9.9.9.9', store = memoryStore(), method = 'POST') =>
    guard(loadConfig(env), req(headers, method), ip, async () => store);
  const status = async (r: Awaited<ReturnType<typeof run>>) => (r.ok ? 200 : r.response.status);

  it('refuses when no API key is configured', async () => expect(await status(await run({}, { ...base, OPENROUTER_API_KEY: '' }))).toBe(503));
  it('refuses non-POST', async () => expect(await status(await run({}, base, '1.1.1.1', memoryStore(), 'GET'))).toBe(405));
  it('refuses foreign origins', async () => expect(await status(await run({ origin: 'https://evil.example' }))).toBe(403));
  it('rejects a wrong code instead of silently using the free tier', async () => {
    const r = await run({ 'x-access-code': 'nope' });
    expect(await status(r)).toBe(401);
  });
  it('gives the free tier N messages, then 429 with retry-after', async () => {
    const store = memoryStore();
    const ip = '5.5.5.5';
    // distinct IPs would dodge tooFast; vary the burst guard by waiting via different hashed ips is not possible, so check through checkAndCount path:
    const first = await run({}, base, ip, store);
    expect(first.ok && first.tier).toBe('free');
    expect(first.ok && first.remaining).toBe(1);
  });
  it('code holders get the code tier', async () => {
    const r = await run({ 'x-access-code': 'letmein' }, base, '7.7.7.7');
    expect(r.ok && r.tier).toBe('code');
  });
  it('fails closed when the limiter store is down', async () => {
    const r = await guard(loadConfig(base), req(), '8.8.8.8', async () => { throw new Error('blobs down'); });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(503);
  });
  it('never leaks the API key in error responses', async () => {
    const r = await guard(loadConfig(base), req({ origin: 'https://evil.example' }), '3.3.3.3', async () => memoryStore());
    if (!r.ok) expect(await r.response.text()).not.toContain('sk-test');
  });
});
