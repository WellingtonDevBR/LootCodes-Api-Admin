/** Kinguin allows at most 20 declared units per offer update. */
export const KINGUIN_MAX_DECLARED_STOCK = 20;

export function capKinguinDeclaredStock(quantity: number): number {
  return Math.min(Math.max(0, Math.trunc(quantity)), KINGUIN_MAX_DECLARED_STOCK);
}
