/**
 * Resolves the cost basis the seller pricing strategy should price off.
 *
 * For `declared_stock` listings the credit-aware reconcile may pick a more
 * expensive (but credited) buyer than the cheapest cached offer. The
 * caller passes the credited buyer's cost via `procurementCostBasisCents`
 * (already normalized to listing currency); this helper validates the
 * override and falls back to the listing's persisted cost basis when the
 * override is missing or invalid.
 *
 * The override only applies to `declared_stock` listings — `key_upload`
 * listings always price off internal cost basis.
 */
import type { SellerListingType } from './seller.types.js';

export interface ResolveEffectiveCostBasisInput {
  readonly listingType: SellerListingType;
  readonly costCents: number;
  readonly procurementCostBasisCents?: number;
}

export function resolveEffectiveCostBasisCents(input: ResolveEffectiveCostBasisInput): number {
  if (input.listingType !== 'declared_stock') return input.costCents;
  const override = input.procurementCostBasisCents;
  if (typeof override !== 'number') return input.costCents;
  if (!Number.isFinite(override)) return input.costCents;
  if (override <= 0) return input.costCents;
  return override;
}
