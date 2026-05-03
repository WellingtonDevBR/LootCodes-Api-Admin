import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminSellerRepository } from '../../core/ports/admin-seller-repository.port.js';
import type {
  ListProviderAccountsResult,
  ListSellerListingsDto,
  ListSellerListingsResult,
  GetVariantOffersDto,
  GetVariantOffersResult,
  ProviderAccountItem,
  SellerListingItem,
  VariantOfferItem,
} from '../../core/use-cases/seller/seller.types.js';

@injectable()
export class SupabaseAdminSellerRepository implements IAdminSellerRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async listProviderAccounts(): Promise<ListProviderAccountsResult> {
    const rows = await this.db.query<ProviderAccountItem>('provider_accounts', {
      order: { column: 'priority', ascending: true },
    });
    return { accounts: rows };
  }

  async listSellerListingsForVariant(dto: ListSellerListingsDto): Promise<ListSellerListingsResult> {
    const rows = await this.db.query<Record<string, unknown>>('seller_listings', {
      eq: [['variant_id', dto.variant_id]],
      order: { column: 'created_at', ascending: true },
    });

    const accountIds = [...new Set(rows.map((r) => r.provider_account_id as string).filter(Boolean))];
    const accountMap = new Map<string, { provider_code: string; display_name: string }>();

    if (accountIds.length > 0) {
      const accounts = await this.db.query<Record<string, unknown>>('provider_accounts', {});
      for (const a of accounts) {
        accountMap.set(a.id as string, {
          provider_code: a.provider_code as string,
          display_name: a.display_name as string,
        });
      }
    }

    const listings: SellerListingItem[] = rows.map((r) => {
      const account = accountMap.get(r.provider_account_id as string);
      return {
        id: r.id as string,
        variant_id: r.variant_id as string,
        provider_account_id: r.provider_account_id as string,
        external_listing_id: (r.external_listing_id as string) ?? null,
        external_product_id: r.external_product_id as string,
        listing_type: r.listing_type as 'key_upload' | 'declared_stock',
        status: r.status as string,
        currency: r.currency as string,
        price_cents: r.price_cents as number,
        min_price_cents: r.min_price_cents as number,
        declared_stock: r.declared_stock as number,
        auto_sync_stock: r.auto_sync_stock as boolean,
        auto_sync_price: r.auto_sync_price as boolean,
        last_synced_at: (r.last_synced_at as string) ?? null,
        error_message: (r.error_message as string) ?? null,
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
        provider_code: account?.provider_code ?? null,
        provider_name: account?.display_name ?? null,
      };
    });

    return { listings };
  }

  async getVariantOffers(dto: GetVariantOffersDto): Promise<GetVariantOffersResult> {
    const rows = await this.db.query<Record<string, unknown>>('provider_variant_offers', {
      eq: [['variant_id', dto.variant_id]],
      order: { column: 'created_at', ascending: true },
    });

    const accountIds = [...new Set(rows.map((r) => r.provider_account_id as string).filter(Boolean))];
    const accountMap = new Map<string, { provider_code: string; display_name: string }>();

    if (accountIds.length > 0) {
      const accounts = await this.db.query<Record<string, unknown>>('provider_accounts', {});
      for (const a of accounts) {
        accountMap.set(a.id as string, {
          provider_code: a.provider_code as string,
          display_name: a.display_name as string,
        });
      }
    }

    const offers: VariantOfferItem[] = rows.map((r) => {
      const account = accountMap.get(r.provider_account_id as string);
      return {
        id: r.id as string,
        variant_id: r.variant_id as string,
        provider_account_id: r.provider_account_id as string,
        external_sku: (r.external_sku as string) ?? null,
        external_offer_id: (r.external_offer_id as string) ?? null,
        currency: r.currency as string,
        last_price_cents: (r.last_price_cents as number) ?? null,
        available_quantity: (r.available_quantity as number) ?? null,
        is_active: r.is_active as boolean,
        last_checked_at: (r.last_checked_at as string) ?? null,
        created_at: r.created_at as string,
        updated_at: r.updated_at as string,
        provider_code: account?.provider_code ?? null,
        provider_name: account?.display_name ?? null,
      };
    });

    return { offers };
  }
}
