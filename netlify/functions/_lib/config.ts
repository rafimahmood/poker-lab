/** Server configuration, read from environment variables. Nothing here is ever sent to the browser. */
const int = (v: string | undefined, d: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

export interface Config {
  apiKey: string;
  model: string;
  visionModel: string;
  accessCode: string;
  freePerDay: number;
  perTenMin: number;
  perDay: number;
  globalDaily: number;
  allowedOrigins: string[];
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const model = env.OPENROUTER_MODEL?.trim() || 'deepseek/deepseek-v4.1-flash';
  return {
    apiKey: env.OPENROUTER_API_KEY?.trim() || '',
    model,
    visionModel: env.OPENROUTER_VISION_MODEL?.trim() || model,
    accessCode: env.ACCESS_CODE?.trim() || '',
    freePerDay: int(env.FREE_MESSAGES_PER_DAY, 5),
    perTenMin: int(env.RATE_LIMIT_PER_10MIN, 20),
    perDay: int(env.RATE_LIMIT_PER_DAY, 100),
    globalDaily: int(env.AI_DAILY_CAP, 300),
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
