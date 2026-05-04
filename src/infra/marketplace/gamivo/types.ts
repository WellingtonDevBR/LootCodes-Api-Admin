/**
 * Gamivo REST API response types (seller-side only).
 *
 * Prices are floats (EUR) in Gamivo's API — adapters convert to cents.
 * Pricing model: 'seller_price' (net price, not gross).
 */

// ─── Offer ─────────────────────────────────────────────────────────────

export interface GamivoOfferDetail {
  id: number;
  product_id: number;
  product_name: string;
  seller_name: string;
  completed_orders: number;
  rating: number;
  retail_price: number;
  wholesale_price_tier_one: number;
  wholesale_price_tier_two: number;
  stock_available: number;
  invoicable: boolean;
  status: number;
  wholesale_mode: number;
  is_preorder: boolean;
  public_api_prices: {
    retail_price: number;
    wholesale_tier_one_price: number;
    wholesale_tier_two_price: number;
  };
  seller_price: number;
  wholesale_seller_price_tier_one: number;
  wholesale_seller_price_tier_two: number;
  provider_product_id: string;
}

export interface GamivoCalculatePriceResponse {
  customer_price: number;
  seller_price: number;
  wholesale_price_tier_one: number;
  wholesale_seller_price_tier_one: number;
  wholesale_price_tier_two: number;
  wholesale_seller_price_tier_two: number;
}

export interface GamivoCreateOfferRequest {
  product: number;
  seller_price: number;
  tier_one_seller_price?: number;
  tier_two_seller_price?: number;
  wholesale_mode?: number;
  status?: number;
  keys?: number;
  is_preorder?: boolean;
  external_id?: string;
}

export type GamivoCreateOfferResponse = number;

export interface GamivoEditOfferRequest {
  seller_price?: number;
  tier_one_seller_price?: number;
  tier_two_seller_price?: number;
  wholesale_mode?: number;
  status?: number;
  keys?: number;
  is_preorder?: boolean;
}

// ─── Callbacks ─────────────────────────────────────────────────────────

export interface GamivoCallbackRegistration {
  id: string;
  type: string;
  url: string;
}

// ─── Constants ─────────────────────────────────────────────────────────

export const GAMIVO_OFFER_STATUS_ACTIVE = 1;
export const GAMIVO_OFFER_STATUS_INACTIVE = 0;
