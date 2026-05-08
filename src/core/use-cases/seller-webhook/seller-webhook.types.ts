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
  marketplaceFinancials?: MarketplaceFinancialsSnapshot;
}

export interface MarketplaceFinancialsSnapshot {
  provider: 'eneba';
  wholesale: boolean;
  currency: string;
  key_count: number;
  gross_cents_per_unit: number;
  original_price_cents_per_unit: number | null;
  price_without_commission_cents_per_unit: number;
  campaign_fee_cents_per_unit: number;
  substitute_auction_fee_cents_per_unit: number | null;
  seller_profit_cents_per_unit: number;
  extra_info: string | null;
  /** Buyer's IP address extracted from Eneba extraInfo array, if present. */
  buyer_ip: string | null;
  total_gross_cents: number;
  total_seller_profit_cents: number;
  total_provider_fee_aggregate_cents: number;
  raw: MarketplaceFinancialsRawWire;
}

export interface MarketplaceFinancialsRawWire {
  price_amount: string;
  price_currency: string;
  original_price_amount?: string;
  original_price_currency?: string;
  price_without_commission_amount?: string;
  price_without_commission_currency?: string;
  campaign_fee_amount?: string;
  campaign_fee_currency?: string;
  substitute_auction_fee_amount?: string;
  substitute_auction_fee_currency?: string;
}

export interface DeclaredStockReserveDto {
  orderId: string;
  originalOrderId: string | null;
  auctions: EnebaAuctionPayload[];
  wholesale?: boolean;
  providerCode: string;
  feesCents?: number;
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

// ─── Gamivo Import API ──────────────────────────────────────────────

export interface GamivoReservationDto {
  productId: number;
  quantity: number;
  unitPrice: number;
  providerAccountId: string;
}

export type GamivoReservationResult = {
  ok: true;
  reservationId: string;
} | {
  ok: false;
  code: string;
  message: string;
  status: number;
};

export interface GamivoOrderDto {
  reservationId: string;
  gamivoOrderId: string;
  createdTime: string;
  providerAccountId: string;
}

export interface GamivoKeyResponse {
  id: string;
  value: string;
  type: 'text';
}

export type GamivoOrderResult = {
  ok: true;
  providerOrderId: string;
  keys: GamivoKeyResponse[];
  availableStock?: number;
} | {
  ok: false;
  code: string;
  message: string;
  status: number;
};

export interface GamivoGetKeysDto {
  providerOrderId: string;
}

export type GamivoGetKeysResult = {
  ok: true;
  keys: GamivoKeyResponse[];
  availableStock?: number;
} | {
  ok: false;
  code: string;
  message: string;
  status: number;
};

export interface GamivoRefundDto {
  orderId: string;
  reservationId: string;
  refundedAt: string;
  refundedKeysCount: number;
}

export interface GamivoOfferDeactivationDto {
  offerId: number;
  productName: string;
  reason: string;
  providerAccountId: string;
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
  providerAccountId: string;
  providerCode: string;
  /** Raw payload from Digiseller Supplier API POST */
  payload: DigisellerFormDeliveryPayload;
}

/**
 * Raw Digiseller form-delivery webhook payload.
 * Field names vary between test and live modes.
 */
export interface DigisellerFormDeliveryPayload {
  id?: string | number;
  id_goods?: number;
  product_id?: number;
  inv?: string | number;
  invoice_id?: string | number;
  unique_code?: string;
  email?: string;
  amount?: string | number;
  currency?: string;
  type_curr?: string;
  profit?: number;
  unit_cnt?: number;
  sign?: string;
  options?: Array<{ id: string; type: string; user_data: string }>;
  [key: string]: unknown;
}

export interface DigisellerDeliveryResult {
  success: boolean;
  keys?: string[];
  productId?: string | number;
  invoiceId?: string | number;
  errorMessage?: string;
}

// ─── Digiseller Quantity Check ───────────────────────────────────────

export interface DigisellerQuantityCheckDto {
  providerAccountId: string;
  productId: string;
  requestedCount: number;
  sign: string | null;
  isTestEnvelope: boolean;
  rawBody: string | null;
}

export interface DigisellerQuantityCheckResult {
  productId: string;
  count: number;
  error?: string;
}

// ─── G2A Dropshipping Contract ──────────────────────────────────────

export interface G2AReservationDto {
  items: G2AReservationRequestItem[];
  providerAccountId: string;
}

export interface G2AReservationRequestItem {
  product_id: number;
  quantity: number;
  additional_data?: Record<string, unknown>;
}

export interface G2AStockInventoryItem {
  id: string;
  value: string;
  kind: 'text' | 'image' | 'account';
}

export interface G2AStockItem {
  product_id: number;
  inventory_size: number;
  inventory: G2AStockInventoryItem[];
}

export interface G2AReservationResponse {
  reservation_id: string;
  stock: G2AStockItem[];
}

export interface G2AOrderDto {
  reservation_id: string;
  g2a_order_id: number;
  providerAccountId: string;
}

export interface G2AOrderCreatedResponse {
  order_id: string;
  stock: G2AStockItem[];
}

export interface G2ARenewReservationDto {
  externalReservationId: string;
  providerAccountId: string;
}

export interface G2ACancelReservationDto {
  externalReservationId: string;
}

export interface G2AGetInventoryDto {
  orderId: string;
}

export interface G2AReturnInventoryDto {
  orderId: string;
  itemIds: string[];
}

export interface G2ANotificationItem {
  notification_type: 'auction_deactivated';
  date: string;
  data: { product_id: number; offer_id?: string };
}

export interface G2ANotificationsDto {
  notifications: G2ANotificationItem[];
  providerAccountId: string;
}

export interface G2AContractError {
  code: string;
  message: string;
}

// ─── Kinguin Seller Webhook ──────────────────────────────────────────

export interface KinguinWebhookDto {
  payload: import('./kinguin/kinguin-parser.js').KinguinWebhookPayload;
  providerAccountId: string;
}

export type KinguinWebhookResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

// ─── Kinguin Buyer Webhook ──────────────────────────────────────────

export interface KinguinBuyerWebhookDto {
  eventName: string;
  payload: unknown;
  providerAccountId: string;
}

export interface KinguinBuyerProductUpdatePayload {
  productId?: string;
  kinguinId?: number;
  qty?: number;
  textQty?: number;
  cheapestOfferId?: string[];
  updatedAt?: string;
}

export interface KinguinBuyerOrderStatusPayload {
  orderId?: string;
  orderExternalId?: string;
  status?: string;
  updatedAt?: string;
}

// ─── Inventory Callback (generic check) ─────────────────────────────

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

// ─── Bamboo Procurement Callback ──────────────────────────────────

export interface BambooCallbackDto {
  payload: import('./bamboo/bamboo-parser.js').BambooNotificationCallbackPayload;
  providerAccountId: string;
}

export interface BambooCallbackResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}
