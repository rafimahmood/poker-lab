/** Turn an async stream of events into a Server-Sent Events response. */
export function sseResponse(events: AsyncIterable<unknown>, meta?: unknown, headers: Record<string, string> = {}): Response {
  const enc = new TextEncoder();
  const send = (c: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) =>
    c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      try {
        if (meta !== undefined) send(c, 'meta', meta);
        for await (const e of events) send(c, (e as { type: string }).type, e);
      } catch (e) {
        const message = e instanceof Error && e.message ? e.message : 'Something went wrong.';
        send(c, 'error', { type: 'error', message });
      } finally {
        c.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no', ...headers },
  });
}
