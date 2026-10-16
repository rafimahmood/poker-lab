import { describe, expect, it } from 'vitest';
import { checkAndCount, hashIp, memoryStore, peekFree, tooFast } from '../../netlify/functions/_lib/ratelimit';

const cfg = { freePerDay: 3, perTenMin: 4, perDay: 6, globalDaily: 10 };
const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);

describe('free tier', () => {
  it('allows N free messages per day then blocks with a reset time', async () => {
    const s = memoryStore();
    const ip = hashIp('1.2.3.4');
    for (let i = 1; i <= 3; i++) {
      const v = await checkAndCount(s, cfg, ip, 'free', T0);
      expect(v).toMatchObject({ ok: true, remaining: 3 - i });
    }
    const v = await checkAndCount(s, cfg, ip, 'free', T0);
    expect(v).toMatchObject({ ok: false, reason: 'free_limit' });
    if (!v.ok) { expect(v.retryAfter).toBe(12 * 3600); expect(v.message).toMatch(/access code/); }
  });
  it('is per IP', async () => {
    const s = memoryStore();
    for (let i = 0; i < 3; i++) await checkAndCount(s, cfg, hashIp('a'), 'free', T0);
    expect((await checkAndCount(s, cfg, hashIp('b'), 'free', T0)).ok).toBe(true);
  });
  it('resets the next day', async () => {
    const s = memoryStore();
    for (let i = 0; i < 3; i++) await checkAndCount(s, cfg, hashIp('a'), 'free', T0);
    expect((await checkAndCount(s, cfg, hashIp('a'), 'free', T0 + 24 * 3600 * 1000)).ok).toBe(true);
  });
  it('peekFree reports what is left without counting', async () => {
    const s = memoryStore();
    await checkAndCount(s, cfg, hashIp('a'), 'free', T0);
    expect(await peekFree(s, cfg, hashIp('a'), T0)).toBe(2);
    expect(await peekFree(s, cfg, hashIp('a'), T0)).toBe(2);
  });
});

describe('access-code tier', () => {
  it('limits per 10 minutes, then recovers in the next window', async () => {
    const s = memoryStore();
    const ip = hashIp('c');
    for (let i = 0; i < 4; i++) expect((await checkAndCount(s, cfg, ip, 'code', T0)).ok).toBe(true);
    const v = await checkAndCount(s, cfg, ip, 'code', T0);
    expect(v).toMatchObject({ ok: false, reason: 'rate_limit' });
    expect((await checkAndCount(s, cfg, ip, 'code', T0 + 11 * 60 * 1000)).ok).toBe(true);
  });
  it('limits per day', async () => {
    const s = memoryStore();
    const ip = hashIp('d');
    let t = T0;
    for (let i = 0; i < 6; i++) { expect((await checkAndCount(s, cfg, ip, 'code', t)).ok).toBe(true); t += 11 * 60 * 1000; }
    expect(await checkAndCount(s, cfg, ip, 'code', t)).toMatchObject({ ok: false, reason: 'daily_limit' });
  });
});

describe('global cap and cost', () => {
  it('stops everyone once the global daily cap is hit', async () => {
    const s = memoryStore();
    for (let i = 0; i < 10; i++) await checkAndCount(s, { ...cfg, freePerDay: 99 }, hashIp('u' + i), 'free', T0);
    expect(await checkAndCount(s, { ...cfg, freePerDay: 99 }, hashIp('new'), 'free', T0)).toMatchObject({ ok: false, reason: 'global_cap' });
  });
  it('expensive calls use more budget and are refused when they do not fit', async () => {
    const s = memoryStore();
    expect(await checkAndCount(s, cfg, hashIp('e'), 'free', T0, 3)).toMatchObject({ ok: true, remaining: 0 });
    expect((await checkAndCount(s, cfg, hashIp('e'), 'free', T0, 1)).ok).toBe(false);
    expect((await checkAndCount(s, cfg, hashIp('f'), 'free', T0, 4)).ok).toBe(false);
  });
  it('a refused request does not consume budget', async () => {
    const s = memoryStore();
    await checkAndCount(s, cfg, hashIp('g'), 'free', T0, 3);
    await checkAndCount(s, cfg, hashIp('g'), 'free', T0, 1);
    expect(s.data.get(`global:2026-10-16`)).toBe(3);
  });
});

describe('misc', () => {
  it('hashes IPs (no raw IP stored)', () => {
    expect(hashIp('1.2.3.4')).toMatch(/^[0-9a-f]{24}$/);
    expect(hashIp('1.2.3.4')).not.toContain('1.2.3.4');
  });
  it('tooFast catches rapid-fire requests from one IP', () => {
    const ip = hashIp('rapid');
    expect(tooFast(ip, 1_000_000)).toBe(false);
    expect(tooFast(ip, 1_000_300)).toBe(true);
    expect(tooFast(ip, 1_005_000)).toBe(false);
  });
});
