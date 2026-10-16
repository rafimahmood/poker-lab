import type { Config } from './config';
import { type ToolContext, TOOL_DEFS, runTool } from './tools';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type Role = 'system' | 'user' | 'assistant' | 'tool';
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface Msg {
  role: Role;
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type AgentEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_start'; id: string; name: string; args: unknown }
  | { type: 'tool'; id: string; name: string; args: unknown; result: unknown }
  | { type: 'done'; rounds: number; truncated?: boolean }
  | { type: 'error'; message: string };

export class UpstreamError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Plain-English message for an upstream failure; never includes keys or raw bodies. */
export function friendlyUpstream(status: number): string {
  if (status === 401 || status === 403) return 'The AI service rejected the server key. The site owner needs to check the API key.';
  if (status === 402) return 'The AI service is out of credits. The site owner needs to top up.';
  if (status === 429) return 'The AI service is busy. Try again in a moment.';
  if (status >= 500) return 'The AI service had a problem. Try again in a moment.';
  return 'The AI request failed. Try again.';
}

type Fetch = typeof fetch;

interface RoundOpts {
  cfg: Config;
  model: string;
  messages: Msg[];
  tools?: boolean;
  maxTokens: number;
  temperature?: number;
  json?: boolean;
  signal?: AbortSignal;
  fetchImpl?: Fetch;
}

/** One streaming completion. Yields text deltas, returns any tool calls and the finish reason. */
export async function* streamRound(o: RoundOpts): AsyncGenerator<{ text: string }, { toolCalls: ToolCall[]; finish: string | null }> {
  const f = o.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    model: o.model, messages: o.messages, stream: true, max_tokens: o.maxTokens, temperature: o.temperature ?? 0.3,
  };
  if (o.tools) { body.tools = TOOL_DEFS; body.tool_choice = 'auto'; }
  if (o.json) body.response_format = { type: 'json_object' };
  const res = await f(OPENROUTER_URL, {
    method: 'POST',
    signal: o.signal,
    headers: {
      authorization: `Bearer ${o.cfg.apiKey}`,
      'content-type': 'application/json',
      'http-referer': 'https://pokerlab12.netlify.app',
      'x-title': 'Poker Lab',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    await res.text().catch(() => '');
    throw new UpstreamError(res.status, friendlyUpstream(res.status));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', finish: string | null = null;
  const calls: ToolCall[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j: any;
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new UpstreamError(Number(j.error.code) || 502, friendlyUpstream(Number(j.error.code) || 502));
      const ch = j.choices?.[0];
      if (!ch) continue;
      if (ch.finish_reason) finish = ch.finish_reason;
      const d = ch.delta ?? {};
      if (typeof d.content === 'string' && d.content) yield { text: d.content };
      for (const tc of d.tool_calls ?? []) {
        const i = tc.index ?? 0;
        const cur = (calls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      }
    }
  }
  return { toolCalls: calls.filter((c) => c && c.function.name), finish };
}

export interface AgentOpts {
  cfg: Config;
  system: string;
  messages: Msg[];
  toolCtx?: ToolContext;
  maxRounds?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  fetchImpl?: Fetch;
}

const safeParse = (s: string): unknown => { try { return s.trim() ? JSON.parse(s) : {}; } catch { return { _raw: s.slice(0, 200) }; } };

/** The coach loop: stream a reply; if the model calls tools, run them here and continue (bounded rounds). */
export async function* runAgent(o: AgentOpts): AsyncGenerator<AgentEvent> {
  const maxRounds = o.maxRounds ?? 6;
  const messages: Msg[] = [{ role: 'system', content: o.system }, ...o.messages];
  let totalCalls = 0;
  for (let round = 1; round <= maxRounds; round++) {
    const useTools = round < maxRounds; // last round must answer in text
    const gen = streamRound({ cfg: o.cfg, model: o.cfg.model, messages, tools: useTools, maxTokens: o.maxTokens ?? 1200, signal: o.signal, fetchImpl: o.fetchImpl });
    let step = await gen.next();
    while (!step.done) { yield { type: 'delta', text: step.value.text }; step = await gen.next(); }
    const { toolCalls, finish } = step.value;
    if (!toolCalls.length) { yield { type: 'done', rounds: round, truncated: finish === 'length' }; return; }
    // cap parallel calls per round and in total
    const calls = toolCalls.slice(0, 4).filter(() => totalCalls++ < 12);
    messages.push({ role: 'assistant', content: null, tool_calls: calls.map((c, i) => ({ ...c, id: c.id || `call_${round}_${i}` })) });
    for (const [i, c] of calls.entries()) {
      const id = c.id || `call_${round}_${i}`;
      const args = safeParse(c.function.arguments);
      yield { type: 'tool_start', id, name: c.function.name, args };
      const raw = runTool(c.function.name, c.function.arguments, o.toolCtx);
      let result: unknown; try { result = JSON.parse(raw.replace(/…\(truncated\)$/, '')); } catch { result = raw; }
      yield { type: 'tool', id, name: c.function.name, args, result };
      messages.push({ role: 'tool', tool_call_id: id, content: raw });
    }
  }
  yield { type: 'done', rounds: maxRounds, truncated: true };
}
