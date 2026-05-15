/**
 * Kinguin Sales Manager API response types (seller-side).
 *
 * Pricing: EUR cents (integer) — no float conversion needed for seller API.
 * Pricing model: 'gross' (customer-visible price includes commission).
 */

// ─── Shared ─────────────────────────────────────────────────────────────

export interface KinguinPrice {
  amount: number;
  currency: 'EUR';
}

export interface KinguinCommissionRule {
  id: string;
  ruleName: string;
  fixedAmount: number;
  percentValue: number;
}

// ─── Offers ─────────────────────────────────────────────────────────────

export interface KinguinOffer {
  id: string;
  productId: string;
  name: string | null;
  sellerId: number;
  status: string;
  block: string | null;
  priceIWTR: KinguinPrice;
  price: KinguinPrice;
  commissionRule: KinguinCommissionRule | null;
  declaredStock: number;
  declaredTextStock: number | null;
  reservedStock: number;
  availableStock: number;
  buyableStock: number;
  updatedAt: string;
  createdAt: string;
  sold: number;
  preOrder: boolean | null;
}

export interface KinguinOfferPage {
  content: KinguinOffer[];
  metadata?: {
    page: number;
    size: number;
    totalElements: number;
    totalPages: number;
  };
}

export interface KinguinCreateOfferRequest {
  productId: string;
  price: KinguinPrice;
  status?: 'ACTIVE' | 'INACTIVE';
  declaredStock?: number;
  declaredTextStock?: number;
}

export interface KinguinUpdateOfferRequest {
  status?: 'ACTIVE' | 'INACTIVE';
  price?: KinguinPrice;
  declaredStock?: number;
  declaredTextStock?: number;
}

// ─── Commission ─────────────────────────────────────────────────────────

export interface KinguinPriceAndCommission {
  rule: string;
  priceIWTR: number;
  price: number;
  fixedAmount: number;
  percentValue: number;
}

// ─── Stock ──────────────────────────────────────────────────────────────

export interface KinguinStockItem {
  id: string;
  productId: string;
  offerId: string;
  sellerId: number;
  status: string;
  createdAt: string;
  dispatchedAt: string | null;
  reservationId: string | null;
}

// ─── Webhook Subscription (Envoy API) ──────────────────────────────────

export interface KinguinSubscriptionRequest {
  endpoints: Record<string, string>;
  headers: Array<{ name: string; value: string }>;
}

export interface KinguinSubscription {
  id: string;
  endpoints: Record<string, string>;
  subscriberId: string;
  headers: Array<{ name: string; value: string }>;
  version: string;
  blockedEndpoints: string[];
}

// ─── Buyer Product Search & Detail (ESA v1/v2) ─────────────────────────
// Buyer prices are floats (EUR).

/**
 * Single offer row inside `KinguinBuyerProduct.offers[]` from `GET /v2/products/{id}`.
 * Each row is one merchant's listing for that product — `merchantName === 'Kinguin'`
 * and the row whose `offerId` matches our own Sales Manager offer id is our offer.
 */
export interface KinguinBuyerOffer {
  name: string;
  offerId: string;
  price: number;
  qty: number;
  textQty?: number;
  merchantName: string;
  isPreorder: boolean;
  releaseDate?: string;
}

export interface KinguinBuyerProduct {
  kinguinId: number;
  productId: string;
  name: string;
  platform: string;
  price: number;
  qty: number;
  isPreorder: boolean;
  regionId: number | null;
  regionalLimitations?: string;
  /** Aggregate offers list returned only by `GET /v2/products/{id}`. */
  offers?: KinguinBuyerOffer[];
  offersCount?: number;
}

export interface KinguinBuyerSearchResponse {
  results: KinguinBuyerProduct[];
  item_count: number;
}

// ─── Declared Stock Cap ────────────────────────────────────────────────

export { KINGUIN_MAX_DECLARED_STOCK } from '../../../core/shared/kinguin.constants.js';
