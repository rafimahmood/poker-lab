import type { Context, NfConfig } from './_lib/nf';
import { guard, json } from './_lib/guard';
import { streamRound } from './_lib/openrouter';
import { LESSON_SYSTEM } from './_lib/prompts';
import { cfg, readJson, store } from './_lib/runtime';
import { sseResponse } from './_lib/sse';

export default async (req: Request, context: Context) => {
  const c = cfg();
  const g = await guard(c, req, context.ip, store, 3);
  if (!g.ok) return g.response;
  const body = await readJson(req, 60_000);
  if (!body || typeof body.prompt !== 'string' || body.prompt.length < 20 || body.prompt.length > 40_000) return json({ error: 'bad_request', message: 'Invalid lesson request.' }, 400);
  async function* events() {
    const gen = streamRound({ cfg: c, model: c.model, messages: [{ role: 'system', content: LESSON_SYSTEM }, { role: 'user', content: body.prompt }], maxTokens: 4500, json: true, temperature: 0.4, signal: req.signal });
    let s = await gen.next();
    while (!s.done) { yield { type: 'delta', text: s.value.text }; s = await gen.next(); }
    yield { type: 'done', truncated: s.value.finish === 'length' };
  }
  return sseResponse(events(), { tier: g.tier, remaining: g.remaining });
};

export const config: NfConfig = { path: '/api/lesson' };
