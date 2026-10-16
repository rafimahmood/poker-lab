import type { Context, NfConfig } from './_lib/nf';
import { clientIp, hasValidCode, json } from './_lib/guard';
import { hashIp, peekFree } from './_lib/ratelimit';
import { cfg, store } from './_lib/runtime';

/** Lets the UI show whether the coach is available and how many free messages remain. No secrets. */
export default async (req: Request, context: Context) => {
  const c = cfg();
  const code = hasValidCode(c, req);
  let remaining: number | null = null;
  if (!code) { try { remaining = await peekFree(await store(), c, hashIp(clientIp(req, context.ip))); } catch { remaining = null; } }
  return json({ configured: !!c.apiKey, accessCodeEnabled: !!c.accessCode, codeValid: code, freePerDay: c.freePerDay, freeRemaining: remaining });
};

export const config: NfConfig = { path: '/api/status' };
