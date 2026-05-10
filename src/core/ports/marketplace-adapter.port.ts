/**
 * Marketplace adapter capability interfaces.
 *
 * Mirrors the seller capability interfaces from the Edge Function
 * `provider-procurement/providers/_seller-adapter.ts`. Provider adapters
 * implement subsets of these interfaces; runtime type guards narrow to the
 * capabilities each provider supports.
 *
 * Handler → use-case → adapter (DIP).
 */

// ─── Shared Adapter Types ────────────────────────────────────────────

export interface DeclareStockResult {
  success: boolean;
  declaredQuantity?: number;
  error?: string;
}

export interface RegisterCallbacksResult {
  registered: number;
  callbackIds: string[];
}

export interface RemoveCallbackResult {
  removed: boolean;
}

export interface GetCallbacksResult {
  callbacks: Array<{ id: string; type: string; url: string }>;
}

export interface UploadKeysResult {
  uploaded: number;
  failed: number;
  errors?: string[];
}

export interface SyncStockLevelResult {
  success: boolean;
  syncedQuantity?: number;
  error?: string;
}

export interface KeyProvisionParams {
  reservationId: string;
  externalReservationId: string;
  keys: Array<{ value: string; type?: string }>;
}

export interface KeyProvisionResult {
  success: boolean;
  provisioned: number;
  error?: string;
}

export interface SellerPayoutResult {
  grossPriceCents: number;
  feeCents: number;
  netPayoutCents: number;
}

export interface PricingContext {
  priceCents: number;
  currency: string;
  listingType: string;
  externalListingId?: string;
  externalProductId?: string;
}

export interface CompetitorPrice {
  merchantName: string;
  priceCents: number;
  currency: string;
  inStock: boolean;
  isOwnOffer: boolean | null;
  externalListingId?: string;
}

export interface CreateListingParams {
  externalProductId: string;
  priceCents: number;
  currency: string;
  listingType: string;
  quantity?: number;
}

export interface CreateListingResult {
  externalListingId: string;
  status: string;
}

export interface UpdateListingParams {
  externalListingId: string;
  priceCents?: number;
  quantity?: number;
  /** Listing currency (e.g. Eneba `S_MoneyInput.currency`). Defaults per adapter. */
  currency?: string;
}

export interface UpdateListingResult {
  success: boolean;
  error?: string;
}

export interface ListingStatusResult {
  status: string;
  externalListingId: string;
  stock?: number;
  priceCents?: number;
}

export interface BatchPriceUpdate {
  externalListingId: string;
  priceCents: number;
  /** Defaults to EUR in the Eneba adapter when omitted. */
  currency?: string;
}

export interface BatchPriceUpdateResult {
  updated: number;
  failed: number;
  errors?: Array<{ externalListingId: string; error: string }>;
}

export interface BatchDeclaredStockUpdate {
  externalListingId: string;
  quantity: number;
}

// ─── Capability Interfaces ───────────────────────────────────────────

export interface ISellerListingAdapter {
  createListing(params: CreateListingParams): Promise<CreateListingResult>;
  updateListing(params: UpdateListingParams): Promise<UpdateListingResult>;
  deactivateListing(externalListingId: string): Promise<{ success: boolean }>;
  getListingStatus(externalListingId: string): Promise<ListingStatusResult>;
  /**
   * When implemented, publish flows query the marketplace for an auction already tied to this
   * catalog product (e.g. Eneba `S_stock(productId: …)`) and prefer `updateListing` over create.
   */
  discoverExistingAuctionId?(externalProductId: string): Promise<string | null>;
}

export interface ISellerKeyUploadAdapter {
  uploadKeys(externalListingId: string, keys: string[]): Promise<UploadKeysResult>;
}

export interface ISellerDeclaredStockAdapter {
  declareStock(externalListingId: string, quantity: number): Promise<DeclareStockResult>;
  provisionKeys(params: KeyProvisionParams): Promise<KeyProvisionResult>;
  cancelReservation(reservationId: string, reason: string): Promise<{ success: boolean }>;
}

export interface ISellerStockSyncAdapter {
  syncStockLevel(externalListingId: string, availableQuantity: number): Promise<SyncStockLevelResult>;
}

export interface ISellerPricingAdapter {
  /**
   * 'seller_price' → the adapter submits net amounts (e.g. Eneba `priceIWantToGet`).
   * `listing.price_cents` is already the net payout after fees — calling
   * `calculateNetPayout` would treat the net price as gross, returning a
   * lower incorrect value AND burning API rate-limit budget unnecessarily.
   *
   * 'gross_price' (default) → `listing.price_cents` is the gross buyer-facing
   * price; callers must invoke `calculateNetPayout` to learn the net amount.
   */
  readonly pricingModel?: 'gross_price' | 'seller_price';
  calculateNetPayout(ctx: PricingContext): Promise<SellerPayoutResult>;
}

export interface ISellerCompetitionAdapter {
  getCompetitorPrices(externalProductId: string): Promise<CompetitorPrice[]>;
  /**
   * Optional batch variant — fetch competitor prices for multiple products in
   * as few API calls as possible. Returns a Map keyed by externalProductId.
   * Adapters that implement this avoid per-listing round-trips and rate limits.
   * Falls back to sequential `getCompetitorPrices` when absent.
   */
  batchGetCompetitorPrices?(productIds: string[]): Promise<Map<string, CompetitorPrice[]>>;
}

export interface ISellerCallbackSetupAdapter {
  registerCallback(type: string, url: string, authToken: string): Promise<RegisterCallbacksResult>;
  removeCallback(callbackId: string): Promise<RemoveCallbackResult>;
  getCallbacks(): Promise<GetCallbacksResult>;
}

export interface ISellerBatchPriceAdapter {
  batchUpdatePrices(updates: BatchPriceUpdate[]): Promise<BatchPriceUpdateResult>;
}

export interface ISellerBatchDeclaredStockAdapter {
  batchUpdateDeclaredStock(updates: BatchDeclaredStockUpdate[]): Promise<{ updated: number; failed: number }>;
}

export interface ISellerGlobalStockAdapter {
  updateAllStockStatus(enabled: boolean): Promise<{ success: boolean }>;
}

// ─── Product Search ──────────────────────────────────────────────────

export interface ProductSearchResult {
  externalProductId: string;
  productName: string;
  platform: string | null;
  region: string | null;
  priceCents: number;
  currency: string;
  available: boolean;
}

export interface IProductSearchAdapter {
  searchProducts(query: string, limit?: number): Promise<ProductSearchResult[]>;
}

// ─── Adapter Registry ────────────────────────────────────────────────

export type MarketplaceCapability =
  | 'listing'
  | 'key_upload'
  | 'declared_stock'
  | 'stock_sync'
  | 'pricing'
  | 'competition'
  | 'callback_setup'
  | 'batch_price'
  | 'batch_declared_stock'
  | 'global_stock'
  | 'product_search';

export interface IMarketplaceAdapterRegistry {
  registerAdapter(providerCode: string, adapter: unknown): void;
  getListingAdapter(providerCode: string): ISellerListingAdapter | null;
  getKeyUploadAdapter(providerCode: string): ISellerKeyUploadAdapter | null;
  getDeclaredStockAdapter(providerCode: string): ISellerDeclaredStockAdapter | null;
  getStockSyncAdapter(providerCode: string): ISellerStockSyncAdapter | null;
  getPricingAdapter(providerCode: string): ISellerPricingAdapter | null;
  getCompetitionAdapter(providerCode: string): ISellerCompetitionAdapter | null;
  getCallbackSetupAdapter(providerCode: string): ISellerCallbackSetupAdapter | null;
  getBatchPriceAdapter(providerCode: string): ISellerBatchPriceAdapter | null;
  getBatchDeclaredStockAdapter(providerCode: string): ISellerBatchDeclaredStockAdapter | null;
  getGlobalStockAdapter(providerCode: string): ISellerGlobalStockAdapter | null;
  getProductSearchAdapter(providerCode: string): IProductSearchAdapter | null;
  hasCapability(providerCode: string, capability: MarketplaceCapability): boolean;
  getSupportedProviders(): string[];
}
