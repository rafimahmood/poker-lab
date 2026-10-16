import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../netlify/functions/_lib/config';
import { type AgentEvent, runAgent, streamRound } from '../../netlify/functions/_lib/openrouter';
import { sseResponse } from '../../netlify/functions/_lib/sse';

const cfg = loadConfig({ OPENROUTER_API_KEY: 'sk-secret' });

/** Build an OpenRouter-style SSE body from chunks. */
const sse = (chunks: unknown[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200 });
const text = (t: string, finish: string | null = null) => ({ choices: [{ delta: { content: t }, finish_reason: finish }] });
const toolCall = (id: string, name: string, args: string) => [
  { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args.slice(0, 5) } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] }, finish_reason: 'tool_calls' }] },
];

const collect = async (g: AsyncIterable<AgentEvent>) => { const out: AgentEvent[] = []; for await (const e of g) out.push(e); return out; };

describe('runAgent', () => {
  it('streams a plain answer', async () => {
    const f = (async () => sse([text('Hello '), text('there', 'stop')])) as typeof fetch;
    const ev = await collect(runAgent({ cfg, system: 's', messages: [{ role: 'user', content: 'hi' }], fetchImpl: f }));
    expect(ev.filter((e) => e.type === 'delta').map((e: any) => e.text).join('')).toBe('Hello there');
    expect(ev.at(-1)).toMatchObject({ type: 'done', rounds: 1 });
  });

  it('runs a tool call on the server, feeds the result back, then answers', async () => {
    const bodies: any[] = [];
    let n = 0;
    const f = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return n++ === 0
        ? sse(toolCall('call_1', 'calc_equity', '{"hero":"AhAd","villain":"KsKc"}'))
        : sse([text('AA is about 82%.', 'stop')]);
    }) as unknown as typeof fetch;
    const ev = await collect(runAgent({ cfg, system: 's', messages: [{ role: 'user', content: 'AA vs KK?' }], fetchImpl: f }));
    const tool = ev.find((e) => e.type === 'tool') as Extract<AgentEvent, { type: 'tool' }>;
    expect(tool.name).toBe('calc_equity');
    expect((tool.result as any).equity).toBeGreaterThan(0.78);
    expect(ev.some((e) => e.type === 'tool_start')).toBe(true);
    expect(ev.at(-1)).toMatchObject({ type: 'done', rounds: 2 });
    // second request carries the assistant tool call and the tool result
    const msgs = bodies[1].messages;
    expect(msgs.at(-2)).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_1' }] });
    expect(msgs.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
    expect(bodies[0].tools.length).toBeGreaterThan(3);
  });

  it('bounds the number of tool rounds and forces a text answer on the last round', async () => {
    const bodies: any[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      bodies.push(b);
      return b.tools ? sse(toolCall('c', 'pot_odds', '{"pot":100,"to_call":50}')) : sse([text('Done.', 'stop')]);
    }) as unknown as typeof fetch;
    const ev = await collect(runAgent({ cfg, system: 's', messages: [{ role: 'user', content: 'x' }], maxRounds: 3, fetchImpl: f }));
    expect(bodies).toHaveLength(3);
    expect(bodies[2].tools).toBeUndefined();
    expect(ev.at(-1)).toMatchObject({ type: 'done', rounds: 3 });
  });

  it('survives a tool error and reports it to the model', async () => {
    let n = 0;
    const seen: any[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      seen.push(JSON.parse(init.body as string));
      return n++ === 0 ? sse(toolCall('c', 'calc_equity', '{"hero":"Zz"}')) : sse([text('Fixing input.', 'stop')]);
    }) as unknown as typeof fetch;
    const ev = await collect(runAgent({ cfg, system: 's', messages: [{ role: 'user', content: 'x' }], fetchImpl: f }));
    const tool = ev.find((e) => e.type === 'tool') as any;
    expect(tool.result.error).toBeTruthy();
    expect(ev.at(-1)?.type).toBe('done');
  });

  it('sends the key only in the Authorization header and the configured model', async () => {
    let init: any;
    const f = (async (_u: string, i: RequestInit) => { init = i; return sse([text('ok', 'stop')]); }) as unknown as typeof fetch;
    await collect(runAgent({ cfg: loadConfig({ OPENROUTER_API_KEY: 'sk-secret', OPENROUTER_MODEL: 'qwen/qwen3.7-flash' }), system: 's', messages: [{ role: 'user', content: 'x' }], fetchImpl: f }));
    expect(init.headers.authorization).toBe('Bearer sk-secret');
    expect(init.body).not.toContain('sk-secret');
    expect(JSON.parse(init.body).model).toBe('qwen/qwen3.7-flash');
  });

  it('maps upstream failures to friendly messages without leaking details', async () => {
    const f = (async () => new Response('{"error":"key sk-secret invalid"}', { status: 402 })) as typeof fetch;
    await expect(collect(runAgent({ cfg, system: 's', messages: [{ role: 'user', content: 'x' }], fetchImpl: f }))).rejects.toThrow(/out of credits/);
    const f2 = (async () => new Response('boom sk-secret', { status: 500 })) as typeof fetch;
    const err = await collect(runAgent({ cfg, system: 's', messages: [{ role: 'user', content: 'x' }], fetchImpl: f2 })).catch((e) => e as Error);
    expect((err as Error).message).not.toContain('sk-secret');
  });

  it('flags truncated replies', async () => {
    const f = (async () => sse([text('partial', 'length')])) as typeof fetch;
    const ev = await collect(runAgent({ cfg, system: 's', messages: [{ role: 'user', content: 'x' }], fetchImpl: f }));
    expect(ev.at(-1)).toMatchObject({ type: 'done', truncated: true });
  });
});

describe('streamRound json mode', () => {
  it('requests a JSON object when asked', async () => {
    let body: any;
    const f = (async (_u: string, i: RequestInit) => { body = JSON.parse(i.body as string); return sse([text('{}', 'stop')]); }) as unknown as typeof fetch;
    const g = streamRound({ cfg, model: 'm', messages: [], maxTokens: 10, json: true, fetchImpl: f });
    for await (const _ of g) { /* drain */ }
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.tools).toBeUndefined();
  });
});

describe('sseResponse', () => {
  it('encodes events and turns thrown errors into an error event', async () => {
    async function* ev() { yield { type: 'delta', text: 'a' }; throw new Error('upstream down'); }
    const res = sseResponse(ev(), { tier: 'free', remaining: 2 });
    const body = await res.text();
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('event: meta');
    expect(body).toContain('event: delta');
    expect(body).toContain('event: error');
    expect(body).toContain('upstream down');
  });
});
