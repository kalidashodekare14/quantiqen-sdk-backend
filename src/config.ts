import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NESTJS_BASE_URL: z
    .string()
    .url()
    .transform((val) => val.replace(/\/$/, '')),

  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  MAX_BODY_SIZE: z.string().min(1).default('512kb'),

  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((val) =>
      val
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .transform((origins) =>
      origins && origins.length > 0 ? origins : undefined,
    ),

  INTERNAL_PROXY_SECRET: z.string().min(1).optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate process.env against the schema. Fails fast on boot —
 * same pattern as the platform `config/configuration.ts`.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'Invalid environment variables',
        errors: parsed.error.flatten().fieldErrors,
      }),
    );
    throw new Error('Invalid environment variables');
  }

  return parsed.data;
}
