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

// ─── Declared Stock Cap ────────────────────────────────────────────────

/** Kinguin allows at most 20 declared units per offer update. */
export const KINGUIN_MAX_DECLARED_STOCK = 20;
