/**
 * Port: seller pricing service abstraction.
 *
 * Consumed by use cases and the cron scheduler. Implementations live in
 * infra/seller/pricing/.
 */
import type { CompetitorPrice, PricingContext, SellerPayoutResult } from './marketplace-adapter.port.js';
import type { SellerListingType, SellerPriceStrategy } from '../use-cases/seller/seller.types.js';

// ─── Payout ──────────────────────────────────────────────────────────

export interface PayoutRequest {
  listingId: string;
  priceCents: number;
  providerAccountId: string;
}

// ─── Suggest Price ───────────────────────────────────────────────────

export interface SuggestPriceRequest {
  listingId: string;
  externalProductId: string;
  costCents: number;
  listingType: SellerListingType;
  listingMinCents: number;
  listingCurrency?: string;
  externalListingId?: string;
  providerAccountId: string;
  /**
   * Optional override for the cost basis when the listing is `declared_stock`
   * and the credit-aware selector chose a different (more expensive) buyer
   * than the cheapest cached offer. The pricing strategy then prices off
   * what we will ACTUALLY pay, not the theoretical cheapest.
   *
   * Caller normalizes to the listing's native currency cents BEFORE
   * passing this in. Ignored when not a positive finite number.
   */
  procurementCostBasisCents?: number;
}

export interface PriceSuggestionResult {
  suggestedPriceCents: number;
  currency: string;
  strategy: SellerPriceStrategy;
  lowestCompetitorCents: number | null;
  estimatedPayoutCents: number;
  estimatedFeeCents: number;
  competitorsUnavailable?: boolean;
}

// ─── Refresh All (cron entry point) ─────────────────────────────────

export interface RefreshPricesResult {
  listingsProcessed: number;
  pricesUpdated: number;
  pricesSkippedRateLimit: number;
  pricesSkippedIntelligence: number;
  pricesSkippedOscillation: number;
  paidPriceChanges: number;
  estimatedFeeCents: number;
  costBasisUpdated: number;
  decisionsRecorded: number;
  errors: number;
  providers: number;
}

export interface RefreshCostBasesResult {
  listingsProcessed: number;
  costBasisUpdated: number;
  errors: number;
}

export interface RefreshStockResult {
  listingsProcessed: number;
  stockUpdated: number;
  errors: number;
}

// ─── Service Port ────────────────────────────────────────────────────

export interface ISellerPricingService {
  calculatePayout(ctx: PricingContext, providerCode: string, providerAccountId: string): Promise<SellerPayoutResult>;

  suggestPrice(req: SuggestPriceRequest): Promise<PriceSuggestionResult>;

  getCompetitors(providerCode: string, externalProductId: string): Promise<CompetitorPrice[]>;

  enforceMinPrice(priceCents: number, listingMinCents: number, providerMinFloorCents: number): number;

  reverseNetToGross(
    providerCode: string, providerAccountId: string,
    desiredNetCents: number, currency: string, listingType: SellerListingType,
    configCommissionPercent: number,
    externalListingId?: string, externalProductId?: string,
  ): Promise<number>;

  reverseGrossToSellerPrice(
    providerCode: string, providerAccountId: string,
    grossCents: number, currency: string, listingType: SellerListingType,
    configCommissionPercent: number,
    externalListingId?: string, externalProductId?: string,
  ): Promise<number>;
}

export interface ISellerAutoPricingService {
  refreshAllPrices(requestId: string): Promise<RefreshPricesResult>;
  refreshAllCostBases(requestId: string): Promise<RefreshCostBasesResult>;
}

export interface ISellerStockSyncService {
  refreshAllStock(requestId: string): Promise<RefreshStockResult>;
  /**
   * Sync a single seller listing's stock through the same pipeline used by
   * the cron (`refreshAllStock`). Backs the operator-driven "Sync Stock Now"
   * action in the CRM. Returns 0 listingsProcessed when the listing is
   * missing or has `auto_sync_stock=false`.
   */
  refreshOneListing(requestId: string, listingId: string): Promise<RefreshStockResult>;
}
