/**
 * Seller cost-basis service — key acquisition cost computation.
 *
 * Computes median purchase_cost from available product_keys via RPCs,
 * loads FX rates from currency_rates, and resolves effective min price
 * floors per listing.
 *
 * Ported from supabase/functions/provider-procurement/services/seller-cost-basis.service.ts
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../../core/ports/database.port.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('seller-cost-basis');

// ─── Single variant ──────────────────────────────────────────────────

export interface VariantCostEntry {
  variant_id: string;
  median_cost_cents: number;
  key_count: number;
}

@injectable()
export class SellerCostBasisService {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async computeCostBasis(variantId: string): Promise<number> {
    try {
      const data = await this.db.rpc<number>('get_variant_median_key_cost', {
        p_variant_id: variantId,
      });
      return typeof data === 'number' ? data : 0;
    } catch (err) {
      logger.error('Failed to compute median key cost', {
        variantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  /**
   * Returns the cheapest active buyer-offer price per variant (in USD cents)
   * from `provider_variant_offers`. Used as a cost-basis fallback for
   * declared-stock / JIT listings where no physical `product_keys` exist
   * (so `get_batch_variant_median_key_costs` would return 0).
   *
   * Only includes rows whose `currency` is `'USD'`. Offers priced in other
   * currencies are skipped to avoid needing live FX conversion here.
   */
  async computeBatchProviderOfferCosts(variantIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (variantIds.length === 0) return result;

    try {
      const rows = await this.db.query<{
        variant_id: string;
        last_price_cents: number | null;
        currency: string | null;
      }>('provider_variant_offers', {
        select: 'variant_id, last_price_cents, currency',
        in: [['variant_id', variantIds]],
        eq: [['is_active', true]],
      });

      for (const row of rows) {
        const priceCents = row.last_price_cents;
        if (
          typeof priceCents !== 'number'
          || priceCents <= 0
          || (row.currency ?? '').toUpperCase() !== 'USD'
        ) {
          continue;
        }
        const existing = result.get(row.variant_id);
        if (existing == null || priceCents < existing) {
          result.set(row.variant_id, priceCents);
        }
      }
    } catch (err) {
      logger.warn('Failed to load provider offer costs', {
        variantCount: variantIds.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return result;
  }

  async computeBatchCostBasis(variantIds: string[]): Promise<Map<string, VariantCostEntry>> {
    if (variantIds.length === 0) return new Map();

    try {
      const data = await this.db.rpc<VariantCostEntry[]>('get_batch_variant_median_key_costs', {
        p_variant_ids: variantIds,
      });

      const result = new Map<string, VariantCostEntry>();
      for (const row of data ?? []) {
        result.set(row.variant_id, row);
      }
      return result;
    } catch (err) {
      logger.error('Failed to compute batch median key costs', {
        variantCount: variantIds.length,
        error: err instanceof Error ? err.message : String(err),
      });
      return new Map();
    }
  }

  // ─── Currency conversion ───────────────────────────────────────────

  async convertCostToListingCurrency(costUsdCents: number, targetCurrency: string): Promise<number> {
    if (costUsdCents <= 0) return 0;
    const target = targetCurrency.toUpperCase();
    if (target === 'USD') return costUsdCents;

    try {
      const row = await this.db.queryOne<{
        to_currency: string;
        rate: number;
        margin_pct: number | null;
      }>('currency_rates', {
        eq: [
          ['from_currency', 'USD'],
          ['to_currency', target],
          ['is_active', true],
        ],
      });

      if (!row) {
        logger.warn('No currency rate found for USD→target — using 1:1 fallback', { targetCurrency: target });
        return costUsdCents;
      }

      const effectiveRate = row.rate * (1 + (row.margin_pct ?? 0) / 100);
      return Math.round((costUsdCents / 100) * effectiveRate * 100);
    } catch (err) {
      logger.warn('Currency rate lookup failed', {
        targetCurrency: target,
        error: err instanceof Error ? err.message : String(err),
      });
      return costUsdCents;
    }
  }

  async loadCurrencyRates(targetCurrencies: string[]): Promise<Map<string, number>> {
    const unique = [...new Set(targetCurrencies.map((c) => c.toUpperCase()))].filter((c) => c !== 'USD');
    const rateMap = new Map<string, number>();
    rateMap.set('USD', 1);

    if (unique.length === 0) return rateMap;

    try {
      const rows = await this.db.query<{
        to_currency: string;
        rate: number;
        margin_pct: number | null;
      }>('currency_rates', {
        eq: [
          ['from_currency', 'USD'],
          ['is_active', true],
        ],
        in: [['to_currency', unique]],
      });

      for (const row of rows) {
        const effectiveRate = row.rate * (1 + (row.margin_pct ?? 0) / 100);
        rateMap.set(row.to_currency, effectiveRate);
      }
    } catch (err) {
      logger.warn('Failed to load currency rates batch', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return rateMap;
  }

  convertWithRate(costUsdCents: number, rate: number): number {
    if (costUsdCents <= 0 || rate <= 0) return 0;
    return Math.round((costUsdCents / 100) * rate * 100);
  }

  // ─── Effective min price resolution ────────────────────────────────

  getEffectiveMinPrice(
    listing: {
      min_price_mode: string;
      cost_basis_cents: number;
      min_price_override_cents: number;
      min_price_cents: number;
    },
    providerMinFloorCents: number,
    commissionRatePercent?: number,
    profitabilityFloorCents?: number | null,
    fixedFeeCents?: number,
  ): number {
    let floor: number;
    if (listing.min_price_mode === 'manual' && listing.min_price_override_cents > 0) {
      floor = listing.min_price_override_cents;
    } else {
      const rawCost = listing.cost_basis_cents > 0 ? listing.cost_basis_cents : listing.min_price_cents;
      const fee = Math.max(0, fixedFeeCents ?? 0);
      if (rawCost > 0 && commissionRatePercent != null && commissionRatePercent > 0) {
        // Include fixed fee in the floor so that (price * (1 - commission) - fee) >= cost.
        // Without this, a marketplace fixed fee (e.g. Eneba's €0.25) silently erodes margin
        // and the declared-stock selector correctly rejects the offer as uneconomic.
        floor = Math.ceil((rawCost + fee) / (1 - commissionRatePercent / 100));
      } else {
        floor = rawCost + fee;
      }
    }

    return Math.max(floor, providerMinFloorCents, profitabilityFloorCents ?? 0);
  }
}
