import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),

  INTERNAL_SERVICE_SECRET: z.string().min(1),
  INTERNAL_SERVICE_SECRET_PREVIOUS: z.string().optional().default(''),

  CORS_ORIGINS: z.string().default('https://lootcodes.com,https://www.lootcodes.com'),

  SITE_URL: z.string().url().default('https://lootcodes.com'),
  SITE_NAME: z.string().default('LootCodes'),

  ENCRYPTION_MASTER_KEY: z.string().min(1).optional(),
  ENCRYPTION_MASTER_KEY_ID: z.string().optional(),
  ENCRYPTION_MASTER_KEY_LEGACY: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),

  ALGOLIA_APP_ID: z.string().optional(),
  ALGOLIA_ADMIN_KEY: z.string().optional(),
  ALGOLIA_INDEX_NAME: z.string().default('products'),

  SENTRY_DSN: z.string().url().optional().or(z.literal('')),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),

  /** When set, overrides `provider_accounts.api_profile.base_url` for Eneba GraphQL (e.g. force https://api.eneba.com). */
  ENEBA_GRAPHQL_BASE_URL: z.preprocess(
    (val) => (val === '' || val === undefined ? undefined : val),
    z.string().url().optional(),
  ),
  /** When set, overrides `provider_accounts.api_profile.token_endpoint` for Eneba OAuth (e.g. https://user.eneba.com/oauth/token). */
  ENEBA_OAUTH_TOKEN_URL: z.preprocess(
    (val) => (val === '' || val === undefined ? undefined : val),
    z.string().url().optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function loadEnv(): Env {
  if (_env) return _env;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }
  _env = result.data;
  return _env;
}

export function getEnv(): Env {
  if (!_env) throw new Error('Environment not loaded. Call loadEnv() at startup.');
  return _env;
}

/**
 * Read dynamic env keys (e.g. provider secret names from `provider_secrets_ref`).
 * Centralized `process.env` access for infra that cannot enumerate all keys in zod.
 */
export function getOptionalEnvVar(name: string): string | undefined {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
