import { createHash } from 'node:crypto';
import type { Config } from './config';

/** Minimal counter storage so the limiter is testable without Netlify Blobs. */
export interface CounterStore {
  get(key: string): Promise<number>;
  set(key: string, value: number): Promise<void>;
}

export function memoryStore(): CounterStore & { data: Map<string, number> } {
  const data = new Map<string, number>();
  return { data, get: async (k) => data.get(k) ?? 0, set: async (k, v) => void data.set(k, v) };
}

/** Counters live in Netlify Blobs so they are shared across function instances. */
export async function blobStore(): Promise<CounterStore> {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: 'rate-limits', consistency: 'strong' });
  return {
    async get(key) {
      const v = (await store.get(key, { type: 'json' })) as number | null;
      return typeof v === 'number' ? v : 0;
    },
    async set(key, value) {
      await store.setJSON(key, value);
    },
  };
}

export const hashIp = (ip: string) => createHash('sha256').update('poker-lab:' + ip).digest('hex').slice(0, 24);

export type Tier = 'free' | 'code';

export type Verdict =
  | { ok: true; tier: Tier; remaining: number | null }
  | { ok: false; status: 429; reason: 'free_limit' | 'rate_limit' | 'daily_limit' | 'global_cap'; retryAfter: number; message: string };

const day = (now: number) => new Date(now).toISOString().slice(0, 10);
const secondsToMidnight = (now: number) => {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.ceil((next - now) / 1000);
};

/**
 * Check every limit, then count the request. `cost` lets expensive calls (screenshots) use more of the budget.
 * Read-then-write is not atomic across instances, so a burst can overshoot slightly; the global cap and the
 * spend limit on the OpenRouter key are the hard stops.
 */
export async function checkAndCount(
  store: CounterStore,
  cfg: Pick<Config, 'freePerDay' | 'perTenMin' | 'perDay' | 'globalDaily'>,
  ipHash: string,
  tier: Tier,
  now = Date.now(),
  cost = 1,
): Promise<Verdict> {
  const d = day(now);
  const bucket = Math.floor(now / 600000);
  const gKey = `global:${d}`;
  const dKey = `ip:${ipHash}:${tier}:${d}`;
  const tKey = `ip:${ipHash}:10m:${bucket}`;

  const [g, dayN, tenN] = await Promise.all([store.get(gKey), store.get(dKey), tier === 'code' ? store.get(tKey) : Promise.resolve(0)]);
  const toMidnight = secondsToMidnight(now);

  if (cfg.globalDaily > 0 && g + cost > cfg.globalDaily)
    return { ok: false, status: 429, reason: 'global_cap', retryAfter: toMidnight, message: 'The coach has hit its daily budget. Please try again tomorrow.' };

  if (tier === 'free') {
    if (dayN + cost > cfg.freePerDay)
      return { ok: false, status: 429, reason: 'free_limit', retryAfter: toMidnight, message: `You've used your ${cfg.freePerDay} free coach messages for today. Enter the access code to keep going, or come back tomorrow.` };
  } else {
    if (tenN + cost > cfg.perTenMin)
      return { ok: false, status: 429, reason: 'rate_limit', retryAfter: 600 - (Math.floor(now / 1000) % 600), message: 'You are sending messages too fast. Wait a few minutes.' };
    if (dayN + cost > cfg.perDay)
      return { ok: false, status: 429, reason: 'daily_limit', retryAfter: toMidnight, message: 'Daily limit reached. Try again tomorrow.' };
  }

  await Promise.all([
    store.set(gKey, g + cost),
    store.set(dKey, dayN + cost),
    ...(tier === 'code' ? [store.set(tKey, tenN + cost)] : []),
  ]);
  return { ok: true, tier, remaining: tier === 'free' ? Math.max(0, cfg.freePerDay - (dayN + cost)) : null };
}

/** Free messages left today, without counting anything. */
export async function peekFree(store: CounterStore, cfg: Pick<Config, 'freePerDay'>, ipHash: string, now = Date.now()) {
  const used = await store.get(`ip:${ipHash}:free:${day(now)}`);
  return Math.max(0, cfg.freePerDay - used);
}

/** Per-instance guard against rapid-fire requests (covers the read/write race within one instance). */
const lastSeen = new Map<string, number>();
export function tooFast(ipHash: string, now = Date.now(), minGapMs = 1200): boolean {
  const last = lastSeen.get(ipHash) ?? 0;
  if (lastSeen.size > 5000) lastSeen.clear();
  lastSeen.set(ipHash, now);
  return now - last < minGapMs;
}
