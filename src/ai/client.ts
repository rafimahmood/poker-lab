/** Browser client for the Netlify Functions AI backend. The API key never leaves the server. */

export class AiError extends Error {
  constructor(public code: string, message: string, public retryAfter?: number) { super(message); }
}

const CODE_KEY = 'pl-access-code';
export const getAccessCode = (): string => { try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; } };
export const setAccessCode = (c: string) => { try { c ? localStorage.setItem(CODE_KEY, c) : localStorage.removeItem(CODE_KEY); } catch { /* ignore */ } };

export interface Status { configured: boolean; accessCodeEnabled: boolean; codeValid: boolean; freePerDay: number; freeRemaining: number | null }

export async function getStatus(): Promise<Status | null> {
  try {
    const r = await fetch('/api/status', { headers: codeHeader() });
    if (!r.ok) return null;
    return (await r.json()) as Status;
  } catch { return null; }
}

const codeHeader = (): Record<string, string> => { const c = getAccessCode(); return c ? { 'x-access-code': c } : {}; };

const MESSAGES: Record<string, string> = {
  not_configured: 'The AI coach is not set up on this site yet.',
  forbidden_origin: 'This page is not allowed to use the coach.',
  slow_down: 'One message at a time, please.',
  unavailable: 'The coach is temporarily unavailable. Try again shortly.',
};

async function failure(r: Response): Promise<AiError> {
  let j: any = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  const code = j?.error || 'http_' + r.status;
  return new AiError(code, j?.message || MESSAGES[code] || `Request failed (${r.status}).`, j?.retryAfter);
}

export interface Handlers {
  onMeta?(m: { tier: 'free' | 'code'; remaining: number | null }): void;
  onDelta?(text: string): void;
  onToolStart?(t: { id: string; name: string; args: unknown }): void;
  onTool?(t: { id: string; name: string; args: unknown; result: unknown }): void;
  onDone?(d: { truncated?: boolean }): void;
}

/** POST and consume a Server-Sent Events response. */
export async function stream(url: string, body: unknown, h: Handlers, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...codeHeader() }, body: JSON.stringify(body) });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiError('cancelled', 'Stopped.');
    throw new AiError('network', 'Could not reach the coach. Check your connection.');
  }
  if (!res.ok) throw await failure(res);
  if (!res.body) throw new AiError('network', 'The coach sent an empty response.');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let ev = 'message', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        const d = JSON.parse(data);
        if (ev === 'meta') h.onMeta?.(d);
        else if (ev === 'delta') h.onDelta?.(d.text);
        else if (ev === 'tool_start') h.onToolStart?.(d);
        else if (ev === 'tool') h.onTool?.(d);
        else if (ev === 'done') h.onDone?.(d);
        else if (ev === 'error') throw new AiError('upstream', d.message || 'The coach had a problem.');
      }
    }
  } catch (e) {
    if (e instanceof AiError) throw e;
    if ((e as Error).name === 'AbortError') throw new AiError('cancelled', 'Stopped.');
    throw new AiError('network', 'The connection dropped. Try again.');
  }
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export function chat(
  body: { messages: ChatMessage[]; mode?: 'chat' | 'review'; stats?: unknown },
  h: Handlers,
  signal?: AbortSignal,
) { return stream('/api/chat', body, h, signal); }

/** Run a streaming request and return the accumulated text. */
export async function text(url: string, body: unknown, h: Handlers = {}, signal?: AbortSignal): Promise<{ text: string; truncated: boolean }> {
  let out = '', truncated = false;
  await stream(url, body, { ...h, onDelta: (t) => { out += t; h.onDelta?.(t); }, onDone: (d) => { truncated = !!d.truncated; h.onDone?.(d); } }, signal);
  return { text: out, truncated };
}

/** Pull a JSON object out of model text (tolerates ``` fences and chatter around it). */
export function extractJson<T = any>(s: string): T {
  const t = s.replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new AiError('invalid_json', 'The reply was not valid JSON.');
  try { return JSON.parse(t.slice(a, b + 1)) as T; } catch { throw new AiError('invalid_json', 'The reply was not valid JSON.'); }
}

export async function json<T = any>(url: string, body: unknown, h: Handlers = {}, signal?: AbortSignal): Promise<T> {
  const r = await text(url, body, h, signal);
  return extractJson<T>(r.text);
}

/** Friendly one-liner for any error thrown above. */
export function explain(e: unknown): string {
  if (e instanceof AiError) {
    if (e.code === 'cancelled') return 'Stopped.';
    return e.message;
  }
  return 'Something went wrong. Try again.';
}
