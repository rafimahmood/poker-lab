import type { Context, NfConfig } from './_lib/nf';
import { guard, json } from './_lib/guard';
import { type Msg, runAgent } from './_lib/openrouter';
import { COACH_SYSTEM, REVIEW_SYSTEM } from './_lib/prompts';
import { cfg, readJson, store } from './_lib/runtime';
import { sseResponse } from './_lib/sse';

const MAX_MSGS = 20, MAX_CHARS = 8000;

export default async (req: Request, context: Context) => {
  const c = cfg();
  const g = await guard(c, req, context.ip, store);
  if (!g.ok) return g.response;
  const body = await readJson(req);
  if (!body || !Array.isArray(body.messages) || !body.messages.length) return json({ error: 'bad_request', message: 'Send a list of messages.' }, 400);
  const messages: Msg[] = [];
  for (const m of body.messages.slice(-MAX_MSGS)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return json({ error: 'bad_request', message: 'Invalid message.' }, 400);
    messages.push({ role: m.role, content: m.content.slice(0, MAX_CHARS) });
  }
  if (messages[messages.length - 1].role !== 'user') return json({ error: 'bad_request', message: 'The last message must be from the user.' }, 400);
  const stats = body.stats && JSON.stringify(body.stats).length <= 8000 ? body.stats : undefined;
  const system = body.mode === 'review' ? REVIEW_SYSTEM : COACH_SYSTEM;
  const events = runAgent({ cfg: c, system, messages, toolCtx: { stats }, maxTokens: body.mode === 'review' ? 1500 : 1000, signal: req.signal });
  return sseResponse(events, { tier: g.tier, remaining: g.remaining });
};

export const config: NfConfig = { path: '/api/chat' };
