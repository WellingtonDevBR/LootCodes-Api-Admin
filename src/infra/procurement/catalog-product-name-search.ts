/**
 * Builds ILIKE clauses for catalog title search. Multiple whitespace-separated terms are AND-ed
 * so `"Minecraft Java"` matches `"Minecraft: Java & Bedrock"` (vendor punctuation between tokens).
 */
export function catalogProductNameIlikeClauses(searchRaw: string | undefined): Array<[string, string]> {
  const trimmed = searchRaw?.trim();
  if (!trimmed) return [];
  const terms = trimmed.split(/\s+/).filter((t) => t.length > 0);
  return terms.map((t): [string, string] => ['product_name', `%${t}%`]);
}
