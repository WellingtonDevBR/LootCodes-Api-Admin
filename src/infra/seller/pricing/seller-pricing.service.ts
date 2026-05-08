/**
 * Seller pricing service — stateless business logic.
 *
 * Depends on abstract adapter capabilities (Dependency Inversion).
 * Every provider implements calculateNetPayout using its own real API.
 *
 * Ported from supabase/functions/provider-procurement/services/seller-pricing.service.ts
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../../core/ports/database.port.js';
import type {
  IMarketplaceAdapterRegistry,
  ISellerListingAdapter,
  CompetitorPrice,
  PricingContext,
  SellerPayoutResult,
  BatchPriceUpdate,
  BatchPriceUpdateResult,
} from '../../../core/ports/marketplace-adapter.port.js';
import type { ISellerPricingService, PriceSuggestionResult, SuggestPriceRequest } from '../../../core/ports/seller-pricing.port.js';
import type { SellerListingType, SellerPriceStrategy, SellerProviderConfig } from '../../../core/use-cases/seller/seller.types.js';
import { parseSellerConfig } from '../../../core/use-cases/seller/seller.types.js';
import { applySellerPriceStrategy } from '../../../core/use-cases/seller/apply-seller-price-strategy.js';
import { stampCompetitorOwnership } from './seller-price-intelligence.service.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('seller-pricing-service');

function isListingAdapter(adapter: unknown): adapter is ISellerListingAdapter & { pricingModel?: string } {
  return adapter != null && typeof (adapter as ISellerListingAdapter).createListing === 'function';
}

@injectable()
export class SellerPricingService implements ISellerPricingService {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
  ) {}

  // ─── Payout Calculation ────────────────────────────────────────────

  async calculatePayout(
    ctx: PricingContext,
    providerCode: string,
    providerAccountId: string,
  ): Promise<SellerPayoutResult> {
    const adapter = this.registry.getPricingAdapter(providerCode);
    if (!adapter) {
      throw new Error(`SellerPricingProvider not available for provider ${providerCode}`);
    }

    logger.info('Calculating payout via provider API', {
      providerAccountId,
      priceCents: ctx.priceCents,
      externalListingId: ctx.externalListingId,
    });

    return adapter.calculateNetPayout(ctx);
  }

  // ─── Reverse Net → Gross ──────────────────────────────────────────

  async reverseNetToGross(
    providerCode: string,
    providerAccountId: string,
    desiredNetCents: number,
    currency: string,
    listingType: SellerListingType,
    configCommissionPercent: number,
    externalListingId?: string,
    externalProductId?: string,
  ): Promise<number> {
    const adapter = this.registry.getPricingAdapter(providerCode);
    if (adapter) {
      try {
        const roughGross = Math.round(desiredNetCents / (1 - configCommissionPercent / 100));
        const ctx: PricingContext = {
          priceCents: roughGross,
          currency,
          listingType,
          externalListingId,
          externalProductId,
        };
        const payout = await adapter.calculateNetPayout(ctx);

        if (payout.netPayoutCents > 0) {
          const ratio = roughGross / payout.netPayoutCents;
          return Math.round(desiredNetCents * ratio);
        }
      } catch (err) {
        logger.warn('Adapter-based reverse pricing failed', {
          providerCode,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const rate = Math.max(0, configCommissionPercent) / 100;
    return Math.round(desiredNetCents / (1 - rate));
  }

  // ─── Reverse Gross → Seller Price ─────────────────────────────────

  async reverseGrossToSellerPrice(
    providerCode: string,
    providerAccountId: string,
    grossCents: number,
    currency: string,
    listingType: SellerListingType,
    configCommissionPercent: number,
    externalListingId?: string,
    externalProductId?: string,
  ): Promise<number> {
    const adapter = this.registry.getPricingAdapter(providerCode);
    if (adapter && externalListingId) {
      try {
        const ctx: PricingContext = {
          priceCents: grossCents,
          currency,
          listingType,
          externalListingId,
          externalProductId,
        };
        const payout = await adapter.calculateNetPayout(ctx);
        if (payout.netPayoutCents > 0) {
          return payout.netPayoutCents;
        }
      } catch (err) {
        logger.warn('Adapter-based gross→net pricing failed', {
          providerCode,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const rate = Math.max(0, configCommissionPercent) / 100;
    return Math.round(grossCents * (1 - rate));
  }

  // ─── Min Price Enforcement ────────────────────────────────────────

  enforceMinPrice(priceCents: number, listingMinCents: number, providerMinFloorCents: number): number {
    const floor = Math.max(listingMinCents, providerMinFloorCents);
    if (floor <= 0) return priceCents;
    return Math.max(priceCents, floor);
  }

  // ─── Price Suggestion ─────────────────────────────────────────────

  async suggestPrice(req: SuggestPriceRequest): Promise<PriceSuggestionResult> {
    const config = await this.getProviderConfig(req.providerAccountId);
    const currency = req.listingCurrency || config.default_currency;

    const competitionAdapter = this.registry.getCompetitionAdapter(
      await this.getProviderCode(req.providerAccountId),
    );

    let competitors: CompetitorPrice[] = [];
    let competitorsUnavailable = false;
    if (competitionAdapter) {
      try {
        competitors = await competitionAdapter.getCompetitorPrices(req.externalProductId);
        competitors = stampCompetitorOwnership(competitors, req.externalListingId ?? null);
      } catch (err) {
        competitorsUnavailable = true;
        const errMsg = err instanceof Error ? err.message : String(err);
        const errName = err instanceof Error ? err.name : '';
        const isTransient =
          errName === 'CircuitOpenError' ||
          errName === 'RateLimitExceededError' ||
          /^Circuit breaker open for /.test(errMsg) ||
          /^Rate limit exceeded for /.test(errMsg);
        const logFn = isTransient ? logger.info.bind(logger) : logger.error.bind(logger);
        logFn('Failed to fetch competitor prices', {
          externalProductId: req.externalProductId,
          error: errMsg,
          transient: isTransient,
        });
      }
    }

    const lowestInStock = competitors
      .filter((c) => c.isOwnOffer === false && c.inStock)
      .sort((a, b) => a.priceCents - b.priceCents)[0];

    const lowestCompetitorCents = lowestInStock?.priceCents ?? null;

    let rawPrice = this.applyStrategy(
      config.price_strategy,
      config.price_strategy_value,
      req.costCents,
      lowestCompetitorCents,
    );

    rawPrice = this.enforceMinPrice(rawPrice, req.listingMinCents, config.min_price_floor_cents);

    const providerCode = await this.getProviderCode(req.providerAccountId);
    const pricingAdapter = this.registry.getPricingAdapter(providerCode);

    let estimatedPayoutCents = rawPrice;
    let estimatedFeeCents = 0;
    if (pricingAdapter) {
      try {
        const payout = await pricingAdapter.calculateNetPayout({
          priceCents: rawPrice,
          currency,
          listingType: req.listingType,
          externalListingId: req.externalListingId,
          externalProductId: req.externalProductId,
        });
        estimatedPayoutCents = payout.netPayoutCents;
        estimatedFeeCents = payout.feeCents;
      } catch {
        estimatedFeeCents = Math.round(rawPrice * config.commission_rate_percent / 100);
        estimatedPayoutCents = rawPrice - estimatedFeeCents;
      }
    } else {
      estimatedFeeCents = Math.round(rawPrice * config.commission_rate_percent / 100);
      estimatedPayoutCents = rawPrice - estimatedFeeCents;
    }

    const listingAdapter = this.registry.getListingAdapter(providerCode);
    let suggestedPriceCents = rawPrice;
    if (
      isListingAdapter(listingAdapter) &&
      listingAdapter.pricingModel === 'seller_price' &&
      req.externalListingId
    ) {
      suggestedPriceCents = await this.reverseGrossToSellerPrice(
        providerCode, req.providerAccountId,
        rawPrice, currency, req.listingType,
        config.commission_rate_percent,
        req.externalListingId, req.externalProductId,
      );
    }

    return {
      suggestedPriceCents,
      currency,
      strategy: config.price_strategy,
      lowestCompetitorCents,
      estimatedPayoutCents,
      estimatedFeeCents,
      ...(competitorsUnavailable && { competitorsUnavailable }),
    };
  }

  // ─── Competitor Prices ────────────────────────────────────────────

  async getCompetitors(providerCode: string, externalProductId: string): Promise<CompetitorPrice[]> {
    const adapter = this.registry.getCompetitionAdapter(providerCode);
    if (!adapter) return [];
    return adapter.getCompetitorPrices(externalProductId);
  }

  // ─── Batch Price Updates ──────────────────────────────────────────

  async batchUpdateListingPrices(
    providerCode: string,
    providerAccountId: string,
    updates: BatchPriceUpdate[],
  ): Promise<BatchPriceUpdateResult> {
    const adapter = this.registry.getBatchPriceAdapter(providerCode);
    if (!adapter) {
      return { updated: 0, failed: updates.length, errors: updates.map((u) => ({ externalListingId: u.externalListingId, error: 'No batch price adapter' })) };
    }

    const config = await this.getProviderConfig(providerAccountId);
    const providerFloor = config.min_price_floor_cents;

    const enforced = updates.map((u) => {
      if (u.priceCents != null && providerFloor > 0) {
        return { ...u, priceCents: Math.max(u.priceCents, providerFloor) };
      }
      return u;
    });

    return adapter.batchUpdatePrices(enforced);
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private applyStrategy(
    strategy: SellerPriceStrategy,
    strategyValue: number,
    costCents: number,
    lowestCompetitorCents: number | null,
  ): number {
    return applySellerPriceStrategy(strategy, strategyValue, costCents, lowestCompetitorCents);
  }

  async getProviderConfig(providerAccountId: string): Promise<SellerProviderConfig> {
    const account = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
      filter: { id: providerAccountId },
    });
    return parseSellerConfig((account?.seller_config as Record<string, unknown>) ?? {});
  }

  private async getProviderCode(providerAccountId: string): Promise<string> {
    const account = await this.db.queryOne<{ provider_code: string }>('provider_accounts', {
      filter: { id: providerAccountId },
    });
    if (!account) throw new Error(`Provider account ${providerAccountId} not found`);
    return account.provider_code;
  }
}
