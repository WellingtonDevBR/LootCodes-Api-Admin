/**
 * Shared DTOs and result types for all seller webhook use cases.
 *
 * Provider-specific payload shapes are parsed in the route layer;
 * use cases receive these normalized types.
 */
import type { SellerListingType } from '../seller/seller.types.js';

// ─── Eneba Declared Stock ────────────────────────────────────────────

export interface EnebaMoneyField {
  amount: string | number;
  currency: string;
}

export interface EnebaAuctionPayload {
  auctionId: string;
  keyCount: number;
  price: EnebaMoneyField;
  originalPrice?: EnebaMoneyField;
  priceWithoutCommission?: EnebaMoneyField;
  campaignFee?: EnebaMoneyField;
  substituteAuctionFee?: EnebaMoneyField;
  extraInfo?: string;
}

export interface DeclaredStockReserveDto {
  orderId: string;
  originalOrderId: string | null;
  auctions: EnebaAuctionPayload[];
  wholesale?: boolean;
  providerCode: string;
}

export interface DeclaredStockReserveResult {
  success: boolean;
  orderId: string;
}

export interface DeclaredStockProvideDto {
  orderId: string;
  originalOrderId: string | null;
  providerCode: string;
}

export interface ProvisionedKeyResponse {
  type: string;
  value: string;
}

export interface AuctionKeysResponse {
  auctionId: string;
  keys: ProvisionedKeyResponse[];
}

export interface DeclaredStockProvideResult {
  success: boolean;
  orderId: string;
  auctions?: AuctionKeysResponse[];
}

export interface DeclaredStockCancelDto {
  orderId: string;
  originalOrderId: string | null;
  providerCode: string;
}

export interface DeclaredStockCancelResult {
  success: boolean;
  keysReleased?: number;
}

// ─── G2A / Gamivo Key-Upload Orders ──────────────────────────────────

export interface KeyUploadOrderDto {
  externalOrderId: string;
  externalListingId: string;
  quantity: number;
  providerCode: string;
  priceCents?: number;
  currency?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface KeyUploadOrderResult {
  success: boolean;
  keysDelivered?: number;
}

// ─── Marketplace Refund ──────────────────────────────────────────────

export interface MarketplaceRefundDto {
  externalOrderId: string;
  reservationId?: string;
  providerCode: string;
  reason: string;
  refundedKeysCount?: number;
  refundEventId?: string;
}

export interface MarketplaceRefundResult {
  success: boolean;
  keysRestocked: number;
}

// ─── Listing Deactivation ────────────────────────────────────────────

export interface ListingDeactivationDto {
  externalListingId: string;
  providerCode: string;
  reason?: string;
}

export interface ListingDeactivationResult {
  success: boolean;
  listingId?: string;
}

// ─── Digiseller Form Delivery ────────────────────────────────────────

export interface DigisellerDeliveryDto {
  uniqueCode: string;
  productId: string;
  quantity: number;
  providerAccountId: string;
  providerCode: string;
  buyerEmail?: string;
}

export interface DigisellerDeliveryResult {
  success: boolean;
  keys?: string[];
}

// ─── Inventory Callback (G2A check) ─────────────────────────────────

export interface InventoryCallbackDto {
  externalListingId: string;
  providerCode: string;
}

export interface InventoryCallbackResult {
  available: boolean;
  quantity: number;
}

// ─── Health Counter Update ───────────────────────────────────────────

export type HealthCounterType = 'reservation' | 'provision';

// ─── Reservation Lookup ──────────────────────────────────────────────

export interface ReservationRow {
  id: string;
  seller_listing_id: string;
  status: string;
  quantity: number;
  provider_metadata: Record<string, unknown>;
  external_order_id: string;
  created_at: string;
}

export interface ListingRow {
  id: string;
  variant_id: string;
  status: string;
  provider_account_id: string;
  price_cents: number;
  currency: string;
  min_jit_margin_cents: number | null;
  external_listing_id: string | null;
  listing_type: SellerListingType;
  variant?: { product_id?: string } | null;
}
