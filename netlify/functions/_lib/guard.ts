import { timingSafeEqual } from 'node:crypto';
import type { Config } from './config';
import { type CounterStore, type Tier, type Verdict, checkAndCount, hashIp, tooFast } from './ratelimit';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

export function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export function hasValidCode(cfg: Pick<Config, 'accessCode'>, req: Request): boolean {
  const given = req.headers.get('x-access-code') || '';
  return !!cfg.accessCode && !!given && safeEqual(given, cfg.accessCode);
}

/** Only our own site (and configured origins / localhost) may call the API from a browser. */
export function originAllowed(cfg: Pick<Config, 'allowedOrigins'>, req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin GET / non-browser clients: still subject to rate limits
  try {
    const o = new URL(origin);
    if (o.host === new URL(req.url).host) return true;
    if (o.hostname === 'localhost' || o.hostname === '127.0.0.1') return true;
    return cfg.allowedOrigins.includes(o.origin);
  } catch {
    return false;
  }
}

export function clientIp(req: Request, ctxIp?: string): string {
  return ctxIp || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}

export type GuardResult = { ok: true; tier: Tier; remaining: number | null; ipHash: string } | { ok: false; response: Response };

/** Common checks for every AI endpoint: configured, origin, burst, access tier, rate limits. */
export async function guard(
  cfg: Config,
  req: Request,
  ctxIp: string | undefined,
  store: () => Promise<CounterStore>,
  cost = 1,
): Promise<GuardResult> {
  if (req.method !== 'POST') return { ok: false, response: json({ error: 'method_not_allowed' }, 405, { allow: 'POST' }) };
  if (!cfg.apiKey) return { ok: false, response: json({ error: 'not_configured', message: 'The AI coach is not set up on this server yet.' }, 503) };
  if (!originAllowed(cfg, req)) return { ok: false, response: json({ error: 'forbidden_origin' }, 403) };
  const ipHash = hashIp(clientIp(req, ctxIp));
  if (tooFast(ipHash)) return { ok: false, response: json({ error: 'slow_down', message: 'One message at a time, please.' }, 429, { 'retry-after': '2' }) };
  const tier: Tier = hasValidCode(cfg, req) ? 'code' : 'free';
  if (tier === 'free' && req.headers.get('x-access-code')) {
    // wrong code supplied: tell the user instead of silently using the free tier
    return { ok: false, response: json({ error: 'bad_code', message: 'That access code is not right.' }, 401) };
  }
  let v: Verdict;
  try {
    v = await checkAndCount(await store(), cfg, ipHash, tier, Date.now(), cost);
  } catch (e) {
    console.error('rate limiter unavailable', e);
    return { ok: false, response: json({ error: 'unavailable', message: 'The coach is temporarily unavailable.' }, 503) }; // fail closed
  }
  if (!v.ok) return { ok: false, response: json({ error: v.reason, message: v.message, retryAfter: v.retryAfter }, 429, { 'retry-after': String(v.retryAfter) }) };
  return { ok: true, tier, remaining: v.remaining, ipHash };
}
