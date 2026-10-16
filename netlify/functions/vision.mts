import type { Context, NfConfig } from './_lib/nf';
import { guard, json } from './_lib/guard';
import { streamRound } from './_lib/openrouter';
import { VISION_SYSTEM } from './_lib/prompts';
import { cfg, readJson, store } from './_lib/runtime';
import { sseResponse } from './_lib/sse';

// Netlify caps request bodies at ~6 MB, so the browser downsizes images first.
export default async (req: Request, context: Context) => {
  const c = cfg();
  const g = await guard(c, req, context.ip, store, 3);
  if (!g.ok) return g.response;
  const body = await readJson(req, 5_500_000);
  const images: unknown = body?.images;
  if (!body || typeof body.prompt !== 'string' || body.prompt.length > 4000 || !Array.isArray(images) || !images.length || images.length > 4
    || images.some((i) => typeof i !== 'string' || !/^data:image\/(png|jpe?g|webp);base64,/.test(i)))
    return json({ error: 'bad_request', message: 'Send up to 4 PNG, JPEG or WebP screenshots.' }, 400);
  async function* events() {
    const content = [{ type: 'text' as const, text: body.prompt }, ...(images as string[]).map((url) => ({ type: 'image_url' as const, image_url: { url } }))];
    const gen = streamRound({ cfg: c, model: c.visionModel, messages: [{ role: 'system', content: VISION_SYSTEM }, { role: 'user', content }], maxTokens: 4000, json: true, temperature: 0, signal: req.signal });
    let s = await gen.next();
    while (!s.done) { yield { type: 'delta', text: s.value.text }; s = await gen.next(); }
    yield { type: 'done', truncated: s.value.finish === 'length' };
  }
  return sseResponse(events(), { tier: g.tier, remaining: g.remaining });
};

export const config: NfConfig = { path: '/api/vision' };
