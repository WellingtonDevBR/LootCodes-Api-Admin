/** Normalize vendor docs / CRM paste variants into one outbound HTTP origin (+ optional path). */
export function resolveAppRouteBaseUrlFromApiProfile(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const p = raw as Record<string, unknown>;
  const pick = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  };
  return (
    pick(p.base_url)
    ?? pick(p.baseUrl)
    ?? pick(p.api_base_url)
    ?? pick(p.apiBaseUrl)
  );
}
