/**
 * Non-secret URL-oriented keys we expose to the CRM for editing connection endpoints.
 * (API keys and webhook secrets stay in Vault / other columns.)
 */
const PUBLIC_API_PROFILE_STRING_KEYS = [
  'base_url',
  'baseUrl',
  'api_base_url',
  'apiBaseUrl',
  'base_url_v2',
  'token_endpoint',
  'seller_base_url',
] as const;

export type PublicApiProfileFieldKey = (typeof PUBLIC_API_PROFILE_STRING_KEYS)[number];

export function extractPublicApiProfileFields(
  profile: Record<string, unknown> | null | undefined,
): Partial<Record<PublicApiProfileFieldKey, string>> {
  const raw = profile ?? {};
  const out: Partial<Record<PublicApiProfileFieldKey, string>> = {};
  for (const key of PUBLIC_API_PROFILE_STRING_KEYS) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim().length > 0) out[key] = v.trim();
  }
  return out;
}
