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

export interface IAdminSellerRepository {
  listProviderAccounts(): Promise<ListProviderAccountsResult>;
  listSellerListingsForVariant(dto: ListSellerListingsDto): Promise<ListSellerListingsResult>;
  getVariantOffers(dto: GetVariantOffersDto): Promise<GetVariantOffersResult>;
  createProviderAccount(dto: CreateProviderAccountDto): Promise<CreateProviderAccountResult>;
  updateProviderAccount(dto: UpdateProviderAccountDto): Promise<UpdateProviderAccountResult>;
  deleteProviderAccount(id: string): Promise<void>;
  createVariantOffer(dto: CreateVariantOfferDto): Promise<CreateVariantOfferResult>;
  updateVariantOffer(dto: UpdateVariantOfferDto): Promise<UpdateVariantOfferResult>;
  deleteVariantOffer(id: string): Promise<void>;
}
