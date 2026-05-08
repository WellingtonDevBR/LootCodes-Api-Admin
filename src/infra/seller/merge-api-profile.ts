/** Shallow merge for `provider_accounts.api_profile` PATCH updates. */
export function mergeApiProfilePatch(
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(existing ?? {}), ...patch };
}
