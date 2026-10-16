import { loadConfig } from './config';
import { blobStore } from './ratelimit';

export const cfg = () => loadConfig();
export const store = blobStore;
export const MAX_BODY = 200_000;

/** Read and parse a JSON body with a size cap. */
export async function readJson(req: Request, max = MAX_BODY): Promise<any | null> {
  const text = await req.text();
  if (text.length > max) return null;
  try { return JSON.parse(text); } catch { return null; }
}
