import type {
  ListProviderAccountsResult,
  ListSellerListingsDto,
  ListSellerListingsResult,
  GetVariantOffersDto,
  GetVariantOffersResult,
} from '../use-cases/seller/seller.types.js';

export interface IAdminSellerRepository {
  listProviderAccounts(): Promise<ListProviderAccountsResult>;
  listSellerListingsForVariant(dto: ListSellerListingsDto): Promise<ListSellerListingsResult>;
  getVariantOffers(dto: GetVariantOffersDto): Promise<GetVariantOffersResult>;
}
