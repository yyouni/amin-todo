import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
});
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  return {
    ...parsed,
    COOKIE_SECURE: parsed.COOKIE_SECURE === 'true',
    TRUST_PROXY: parsed.TRUST_PROXY === 'true',
    APP_ORIGIN: new URL(parsed.APP_ORIGIN).origin,
  };
}
export type Config = ReturnType<typeof readConfig>;
