import type { SellerPriceStrategy } from './seller.types.js';

/**
 * Pure competitor-aware strategy resolver shared by seller pricing suggestion flows.
 *
 * @param strategy          Configured pricing strategy.
 * @param strategyValue     Numeric parameter whose meaning depends on strategy.
 * @param costCents         Our minimum acceptable price (floor). Result is never below this.
 * @param lowestCompetitorCents   P1 — cheapest non-own in-stock competitor (gross cents).
 * @param secondLowestCompetitorCents  P2 — second cheapest non-own in-stock competitor.
 *                                     Required for `smart_compete` gap-exploit logic.
 */
export function applySellerPriceStrategy(
  strategy: SellerPriceStrategy,
  strategyValue: number,
  costCents: number,
  lowestCompetitorCents: number | null,
  secondLowestCompetitorCents?: number | null,
): number {
  switch (strategy) {
    case 'match_lowest':
      return lowestCompetitorCents ?? costCents;

    case 'undercut_fixed': {
      if (!lowestCompetitorCents) return costCents;
      const deltaCents = Math.max(0, Math.round(strategyValue));
      return Math.max(lowestCompetitorCents - deltaCents, 1);
    }

    case 'undercut_percent': {
      if (!lowestCompetitorCents) return costCents;
      const discount = Math.round(lowestCompetitorCents * (strategyValue / 100));
      return Math.max(lowestCompetitorCents - discount, 1);
    }

    case 'margin_target': {
      const margin = Math.max(0, strategyValue) / 100;
      return Math.round(costCents / (1 - margin));
    }

    /**
     * Smart compete — maximise revenue by positioning 1 cent below the next price
     * tier above our floor:
     *
     *   • Two competitors (P1, P2): target = max(costCents, P2 − 1)
     *     → stays below P2, taking the most profitable slot above P1.
     *   • One competitor (P1 only): target = max(costCents, P1 − 1)
     *     → undercut the sole leader by 1 cent.
     *   • No competitors: fall back to costCents (floor).
     *
     * Example: floor = €14.05, P1 = €15.55, P2 = €16.00
     *   → target = max(14.05, 15.99) = €15.99  ✓
     */
    case 'smart_compete': {
      if (!lowestCompetitorCents) return costCents;
      if (secondLowestCompetitorCents != null && secondLowestCompetitorCents > lowestCompetitorCents) {
        return Math.max(costCents, secondLowestCompetitorCents - 1);
      }
      return Math.max(costCents, lowestCompetitorCents - 1);
    }

    case 'fixed':
    default:
      return costCents;
  }
}
