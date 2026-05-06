import type { SellerPriceStrategy } from './seller.types.js';

/**
 * Pure competitor-aware strategy resolver shared by seller pricing suggestion flows.
 */
export function applySellerPriceStrategy(
  strategy: SellerPriceStrategy,
  strategyValue: number,
  costCents: number,
  lowestCompetitorCents: number | null,
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
    case 'smart_compete':
      return lowestCompetitorCents ?? costCents;
    case 'fixed':
    default:
      return costCents;
  }
}
