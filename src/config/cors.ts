import type { Env } from './env.js';

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:8080',
];

export function buildCorsOrigins(env: Env): string[] {
  const prodOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  if (env.NODE_ENV === 'production') return prodOrigins;
  return [...prodOrigins, ...DEV_ORIGINS];
}

export function corsOriginValidator(allowedOrigins: string[]) {
  return async (origin: string | undefined): Promise<string | boolean> => {
    if (!origin) return true;
    return allowedOrigins.includes(origin) ? origin : false;
  };
}
