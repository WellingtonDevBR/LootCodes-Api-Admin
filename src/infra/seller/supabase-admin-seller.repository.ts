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
  CreateProviderAccountDto,
  CreateProviderAccountResult,
  UpdateProviderAccountDto,
  UpdateProviderAccountResult,
  CreateVariantOfferDto,
  CreateVariantOfferResult,
  UpdateVariantOfferDto,
  UpdateVariantOfferResult,
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

    const accountMap = await this.buildAccountMap();

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

  async createProviderAccount(dto: CreateProviderAccountDto): Promise<CreateProviderAccountResult> {
    const now = new Date().toISOString();
    const row = await this.db.insert<Record<string, unknown>>('provider_accounts', {
      provider_code: dto.provider_code,
      display_name: dto.display_name,
      is_enabled: dto.is_enabled ?? false,
      priority: dto.priority ?? 100,
      supports_catalog: dto.supports_catalog ?? false,
      supports_quote: dto.supports_quote ?? false,
      supports_purchase: dto.supports_purchase ?? false,
      supports_callback: dto.supports_callback ?? false,
      supports_seller: dto.supports_seller ?? false,
      seller_config: dto.seller_config ?? {},
      procurement_config: dto.procurement_config ?? {},
      health_status: 'healthy',
      created_at: now,
      updated_at: now,
    });
    return { account: row as unknown as ProviderAccountItem };
  }

  async updateProviderAccount(dto: UpdateProviderAccountDto): Promise<UpdateProviderAccountResult> {
    const { id, ...fields } = dto;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (fields.display_name !== undefined) updates.display_name = fields.display_name;
    if (fields.priority !== undefined) updates.priority = fields.priority;
    if (fields.is_enabled !== undefined) updates.is_enabled = fields.is_enabled;
    if (fields.supports_catalog !== undefined) updates.supports_catalog = fields.supports_catalog;
    if (fields.supports_quote !== undefined) updates.supports_quote = fields.supports_quote;
    if (fields.supports_purchase !== undefined) updates.supports_purchase = fields.supports_purchase;
    if (fields.supports_callback !== undefined) updates.supports_callback = fields.supports_callback;
    if (fields.supports_seller !== undefined) updates.supports_seller = fields.supports_seller;
    if (fields.seller_config !== undefined) updates.seller_config = fields.seller_config;
    if (fields.procurement_config !== undefined) updates.procurement_config = fields.procurement_config;
    if (fields.health_status !== undefined) updates.health_status = fields.health_status;

    const rows = await this.db.update<Record<string, unknown>>('provider_accounts', { id }, updates);
    if (rows.length === 0) throw new Error(`Provider account ${id} not found`);
    return { account: rows[0] as unknown as ProviderAccountItem };
  }

  async deleteProviderAccount(id: string): Promise<void> {
    await this.db.delete('provider_accounts', { id });
  }

  async createVariantOffer(dto: CreateVariantOfferDto): Promise<CreateVariantOfferResult> {
    const now = new Date().toISOString();
    const row = await this.db.insert<Record<string, unknown>>('provider_variant_offers', {
      variant_id: dto.variant_id,
      provider_account_id: dto.provider_account_id,
      external_sku: dto.external_sku ?? null,
      external_offer_id: dto.external_offer_id ?? null,
      external_platform_code: dto.external_platform_code ?? null,
      external_region_code: dto.external_region_code ?? null,
      currency: dto.currency ?? 'USD',
      is_active: dto.is_active ?? true,
      created_at: now,
      updated_at: now,
    });

    const accountMap = await this.buildAccountMap();
    const account = accountMap.get(dto.provider_account_id);

    const offer: VariantOfferItem = {
      id: row.id as string,
      variant_id: row.variant_id as string,
      provider_account_id: row.provider_account_id as string,
      external_sku: (row.external_sku as string) ?? null,
      external_offer_id: (row.external_offer_id as string) ?? null,
      currency: row.currency as string,
      last_price_cents: null,
      available_quantity: null,
      is_active: row.is_active as boolean,
      last_checked_at: null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      provider_code: account?.provider_code ?? null,
      provider_name: account?.display_name ?? null,
    };

    return { offer };
  }

  async updateVariantOffer(dto: UpdateVariantOfferDto): Promise<UpdateVariantOfferResult> {
    const { id, ...fields } = dto;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (fields.external_sku !== undefined) updates.external_sku = fields.external_sku;
    if (fields.external_offer_id !== undefined) updates.external_offer_id = fields.external_offer_id;
    if (fields.external_platform_code !== undefined) updates.external_platform_code = fields.external_platform_code;
    if (fields.external_region_code !== undefined) updates.external_region_code = fields.external_region_code;
    if (fields.currency !== undefined) updates.currency = fields.currency;
    if (fields.is_active !== undefined) updates.is_active = fields.is_active;

    const rows = await this.db.update<Record<string, unknown>>('provider_variant_offers', { id }, updates);
    if (rows.length === 0) throw new Error(`Variant offer ${id} not found`);
    const row = rows[0];
    const accountMap = await this.buildAccountMap();
    const account = accountMap.get(row.provider_account_id as string);

    const offer: VariantOfferItem = {
      id: row.id as string,
      variant_id: row.variant_id as string,
      provider_account_id: row.provider_account_id as string,
      external_sku: (row.external_sku as string) ?? null,
      external_offer_id: (row.external_offer_id as string) ?? null,
      currency: row.currency as string,
      last_price_cents: (row.last_price_cents as number) ?? null,
      available_quantity: (row.available_quantity as number) ?? null,
      is_active: row.is_active as boolean,
      last_checked_at: (row.last_checked_at as string) ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      provider_code: account?.provider_code ?? null,
      provider_name: account?.display_name ?? null,
    };

    return { offer };
  }

  async deleteVariantOffer(id: string): Promise<void> {
    await this.db.delete('provider_variant_offers', { id });
  }

  private async buildAccountMap(): Promise<Map<string, { provider_code: string; display_name: string }>> {
    const accounts = await this.db.query<Record<string, unknown>>('provider_accounts', {});
    const map = new Map<string, { provider_code: string; display_name: string }>();
    for (const a of accounts) {
      map.set(a.id as string, {
        provider_code: a.provider_code as string,
        display_name: a.display_name as string,
      });
    }
    return map;
  }
}
