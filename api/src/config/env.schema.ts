import { z } from 'zod';

// One source of truth for the shape of process.env in this service. Every var
// listed here must be present or the api refuses to boot — silent fallbacks
// on secret-shaped values are how staging config leaks into production.

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');

const durationString = z
  .string()
  .regex(/^\d+(ms|s|m|h|d)$/, 'must be a number followed by ms|s|m|h|d, e.g. "12h"');

export const envSchema = z.object({
  NODE_ENV: nodeEnv,
  API_PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url().startsWith('postgresql://'),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 chars — generate with `openssl rand -base64 48`'),
  JWT_TTL: durationString.default('12h'),
  COOKIE_NAME: z.string().min(1).default('cx_session'),

  // Business timezone. In P1 this is the source of truth for
  // common/period.ts; from P2-02 the settings row wins and this becomes the
  // fallback used by tests booting without the row (D-012).
  BUSINESS_TZ: z.string().min(1).default('Africa/Nouakchott'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
