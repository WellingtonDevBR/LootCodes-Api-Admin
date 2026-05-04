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
  DeleteSellerListingDto,
  RecoverSellerListingHealthDto,
  RecoverSellerListingHealthResult,
  SyncSellerStockDto,
  SyncSellerStockResult,
  FetchRemoteStockDto,
  FetchRemoteStockResult,
} from '../use-cases/seller/seller-listing.types.js';

export interface IAdminSellerRepository {
  // Provider accounts
  listProviderAccounts(): Promise<ListProviderAccountsResult>;
  createProviderAccount(dto: CreateProviderAccountDto): Promise<CreateProviderAccountResult>;
  updateProviderAccount(dto: UpdateProviderAccountDto): Promise<UpdateProviderAccountResult>;
  deleteProviderAccount(id: string): Promise<void>;

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
  deleteSellerListing(dto: DeleteSellerListingDto): Promise<void>;
  recoverSellerListingHealth(dto: RecoverSellerListingHealthDto): Promise<RecoverSellerListingHealthResult>;
  syncSellerStock(dto: SyncSellerStockDto): Promise<SyncSellerStockResult>;
  fetchRemoteStock(dto: FetchRemoteStockDto): Promise<FetchRemoteStockResult>;

  // Variant offers
  getVariantOffers(dto: GetVariantOffersDto): Promise<GetVariantOffersResult>;
  createVariantOffer(dto: CreateVariantOfferDto): Promise<CreateVariantOfferResult>;
  updateVariantOffer(dto: UpdateVariantOfferDto): Promise<UpdateVariantOfferResult>;
  deleteVariantOffer(id: string): Promise<void>;
}
