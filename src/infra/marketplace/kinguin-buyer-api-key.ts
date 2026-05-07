/**
 * Resolves Kinguin buyer marketplace API key with Edge-compatible naming:
 * Edge bootstrap reads `KINGUIN_API_KEY`; Api-Admin historically used `KINGUIN_BUYER_API_KEY`.
 */
export function kinguinBuyerApiKeyFromSecrets(secrets: Record<string, string>): string | undefined {
  const primary = secrets['KINGUIN_BUYER_API_KEY']?.trim();
  if (primary) return primary;
  const edgeAlias = secrets['KINGUIN_API_KEY']?.trim();
  return edgeAlias || undefined;
}
