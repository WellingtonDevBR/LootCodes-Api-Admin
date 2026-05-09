import type {
  ListProviderAccountsResult,
  ListSellerListingsDto,
  ListSellerListingsResult,
  GetVariantOffersDto,
  GetVariantOffersResult,
  CreateProviderAccountDto,
  CreateProviderAccountResult,
  UpdateProviderAccountDto,
  UpdateProviderAccountResult,
  GetProviderAccountDetailResult,
  GetWebhookStatusResult,
  RegisterWebhooksResult,
  CreateVariantOfferDto,
  CreateVariantOfferResult,
  UpdateVariantOfferDto,
  UpdateVariantOfferResult,
} from '../use-cases/seller/seller.types.js';
import type {
  CreateSellerListingDto,
  CreateSellerListingResult,
  UpdateSellerListingPriceDto,
  UpdateSellerListingPriceResult,
  ToggleSellerListingSyncDto,
  ToggleSellerListingSyncResult,
  UpdateSellerListingMinPriceDto,
  UpdateSellerListingMinPriceResult,
  UpdateSellerListingOverridesDto,
  UpdateSellerListingOverridesResult,
  SetSellerListingVisibilityDto,
  SetSellerListingVisibilityResult,
  DeactivateSellerListingDto,
  DeactivateSellerListingResult,
  UnlinkSellerListingMarketplaceProductDto,
  UnlinkSellerListingMarketplaceProductResult,
  DeleteSellerListingDto,
  RecoverSellerListingHealthDto,
  RecoverSellerListingHealthResult,
  SyncSellerStockDto,
  SyncSellerStockResult,
  SetSellerListingDeclaredStockDto,
  SetSellerListingDeclaredStockResult,
  FetchRemoteStockDto,
  FetchRemoteStockResult,
  SellerListingPublishContext,
  PublishSellerListingToMarketplaceResult,
  BindSellerListingExternalAuctionDto,
  BindSellerListingExternalAuctionResult,
} from '../use-cases/seller/seller-listing.types.js';

export interface IAdminSellerRepository {
  // Provider accounts
  listProviderAccounts(): Promise<ListProviderAccountsResult>;
  getProviderAccountDetail(id: string): Promise<GetProviderAccountDetailResult>;
  createProviderAccount(dto: CreateProviderAccountDto): Promise<CreateProviderAccountResult>;
  updateProviderAccount(dto: UpdateProviderAccountDto): Promise<UpdateProviderAccountResult>;
  deleteProviderAccount(id: string): Promise<void>;

  // Webhooks — registerWebhooks proxies to Edge Function for marketplace API calls;
  // getWebhookStatus reads directly from the database.
  registerWebhooks(accountId: string): Promise<RegisterWebhooksResult>;
  getWebhookStatus(accountId: string): Promise<GetWebhookStatusResult>;

  // Seller listings — read
  listSellerListingsForVariant(dto: ListSellerListingsDto): Promise<ListSellerListingsResult>;

  // Seller listings — mutations
  createSellerListing(dto: CreateSellerListingDto): Promise<CreateSellerListingResult>;
  updateSellerListingPrice(dto: UpdateSellerListingPriceDto): Promise<UpdateSellerListingPriceResult>;
  toggleSellerListingSync(dto: ToggleSellerListingSyncDto): Promise<ToggleSellerListingSyncResult>;
  updateSellerListingMinPrice(dto: UpdateSellerListingMinPriceDto): Promise<UpdateSellerListingMinPriceResult>;
  updateSellerListingOverrides(dto: UpdateSellerListingOverridesDto): Promise<UpdateSellerListingOverridesResult>;
  setSellerListingVisibility(dto: SetSellerListingVisibilityDto): Promise<SetSellerListingVisibilityResult>;
  deactivateSellerListing(dto: DeactivateSellerListingDto): Promise<DeactivateSellerListingResult>;
  unlinkSellerListingMarketplaceProduct(
    dto: UnlinkSellerListingMarketplaceProductDto,
  ): Promise<UnlinkSellerListingMarketplaceProductResult>;
  deleteSellerListing(dto: DeleteSellerListingDto): Promise<void>;
  recoverSellerListingHealth(dto: RecoverSellerListingHealthDto): Promise<RecoverSellerListingHealthResult>;
  syncSellerStock(dto: SyncSellerStockDto): Promise<SyncSellerStockResult>;
  /**
   * Persist an operator-pinned `manual_declared_stock` value (also mirrored to
   * `declared_stock` since this row was just pushed to the marketplace).
   * Caller is responsible for the marketplace round-trip — this method only
   * commits the local row and emits the `seller.listing_updated` audit event.
   */
  setSellerListingManualDeclaredStock(
    dto: SetSellerListingDeclaredStockDto,
  ): Promise<SetSellerListingDeclaredStockResult>;
  fetchRemoteStock(dto: FetchRemoteStockDto): Promise<FetchRemoteStockResult>;

  /** Loads seller_listings joined with provider_accounts.provider_code for marketplace adapter routing. */
  getSellerListingPublishContext(listingId: string): Promise<SellerListingPublishContext | null>;
  /** Corrects rows stuck `failed` after DB partially succeeded (marketplace id present); safe no-op otherwise. */
  repairSellerListingRowIfStaleFailure(listingId: string): Promise<void>;
  countAvailableProductKeysForVariant(variantId: string): Promise<number>;
  finalizeSellerListingMarketplacePublishSuccess(params: {
    listing_id: string;
    external_listing_id: string;
    declared_stock: number;
    admin_id: string;
    /** When Eneba publish bridges `key_upload` → declared-stock auction, persist `declared_stock` listing type. */
    listing_type?: 'declared_stock';
  }): Promise<PublishSellerListingToMarketplaceResult>;
  markSellerListingPublishFailure(listing_id: string, error_message: string): Promise<void>;
  /**
   * Persist the marketplace price on a listing when a JIT-publish fallback
   * derived the price from a buyer offer. Records the source buyer for
   * audit so the CRM can show "Auto-priced from <buyer> at <price>".
   */
  updateSellerListingJitPublishPrice(params: {
    listing_id: string;
    price_cents: number;
    source_provider_code: string;
    source_provider_account_id: string;
  }): Promise<void>;
  finalizeSellerListingBindExistingAuction(
    dto: BindSellerListingExternalAuctionDto & { verified_remote_status: string },
  ): Promise<BindSellerListingExternalAuctionResult>;

  // Variant offers
  getVariantOffers(dto: GetVariantOffersDto): Promise<GetVariantOffersResult>;
  createVariantOffer(dto: CreateVariantOfferDto): Promise<CreateVariantOfferResult>;
  updateVariantOffer(dto: UpdateVariantOfferDto): Promise<UpdateVariantOfferResult>;
  deleteVariantOffer(id: string): Promise<void>;
}
