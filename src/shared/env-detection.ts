const NON_PRODUCTION_TOKENS = new Set([
  'development',
  'dev',
  'test',
  'local',
  'preview',
  'staging',
]);

function readEnvToken(): string {
  const candidates = [
    process.env.ENVIRONMENT,
    process.env.ENV,
    process.env.NODE_ENV,
  ];
  for (const raw of candidates) {
    if (raw && raw.trim()) return raw.trim().toLowerCase();
  }
  return '';
}

export function isProductionEnvironment(): boolean {
  return !NON_PRODUCTION_TOKENS.has(readEnvToken());
}

export function isNonProductionEnvironment(): boolean {
  return !isProductionEnvironment();
}
