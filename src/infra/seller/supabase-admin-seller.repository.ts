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
} from '../../core/use-cases/seller/seller-listing.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminSellerRepository');

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

  // --- Seller Listing Mutations ---

  async createSellerListing(dto: CreateSellerListingDto): Promise<CreateSellerListingResult> {
    logger.info('Creating seller listing', { variantId: dto.variant_id, provider: dto.provider_account_id });

    const result = await this.db.invokeFunction<CreateSellerListingResult>('provider-procurement', {
      action: 'seller-listing',
      sub_action: 'create',
      variant_id: dto.variant_id,
      provider_account_id: dto.provider_account_id,
      price_cents: dto.price_cents,
      currency: dto.currency,
      listing_type: dto.listing_type,
      external_product_id: dto.external_product_id,
      auto_sync_stock: dto.auto_sync_stock ?? true,
      auto_sync_price: dto.auto_sync_price ?? false,
      admin_id: dto.admin_id,
    });

    return result;
  }

  async updateSellerListingPrice(dto: UpdateSellerListingPriceDto): Promise<UpdateSellerListingPriceResult> {
    logger.info('Updating seller listing price', { listingId: dto.listing_id, priceCents: dto.price_cents });

    const now = new Date().toISOString();
    const rows = await this.db.update<Record<string, unknown>>('seller_listings', { id: dto.listing_id }, {
      price_cents: dto.price_cents,
      updated_at: now,
    });

    if (rows.length === 0) throw new Error(`Seller listing ${dto.listing_id} not found`);

    await this.db.insert('domain_events', {
      event_type: 'seller.listing_updated',
      payload: { listing_id: dto.listing_id, field: 'price_cents', value: dto.price_cents, admin_id: dto.admin_id },
      created_at: now,
    });

    return {
      listing_id: dto.listing_id,
      price_cents: dto.price_cents,
      updated_at: now,
    };
  }

  async toggleSellerListingSync(dto: ToggleSellerListingSyncDto): Promise<ToggleSellerListingSyncResult> {
    logger.info('Toggling seller listing sync', { listingId: dto.listing_id });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.sync_stock !== undefined) updates.auto_sync_stock = dto.sync_stock;
    if (dto.sync_price !== undefined) updates.auto_sync_price = dto.sync_price;

    const rows = await this.db.update<Record<string, unknown>>('seller_listings', { id: dto.listing_id }, updates);
    if (rows.length === 0) throw new Error(`Seller listing ${dto.listing_id} not found`);

    return {
      listing_id: dto.listing_id,
      auto_sync_stock: rows[0].auto_sync_stock as boolean,
      auto_sync_price: rows[0].auto_sync_price as boolean,
    };
  }

  async updateSellerListingMinPrice(dto: UpdateSellerListingMinPriceDto): Promise<UpdateSellerListingMinPriceResult> {
    logger.info('Updating seller listing min price', { listingId: dto.listing_id, mode: dto.mode });

    const updates: Record<string, unknown> = {
      min_price_mode: dto.mode,
      updated_at: new Date().toISOString(),
    };

    if (dto.mode === 'manual' && dto.override_cents !== undefined) {
      updates.min_price_cents = dto.override_cents;
    } else if (dto.mode === 'auto') {
      updates.min_price_cents = 0;
    }

    const rows = await this.db.update<Record<string, unknown>>('seller_listings', { id: dto.listing_id }, updates);
    if (rows.length === 0) throw new Error(`Seller listing ${dto.listing_id} not found`);

    return {
      listing_id: dto.listing_id,
      min_price_cents: rows[0].min_price_cents as number,
      min_price_mode: rows[0].min_price_mode as string,
    };
  }

  async updateSellerListingOverrides(dto: UpdateSellerListingOverridesDto): Promise<UpdateSellerListingOverridesResult> {
    logger.info('Updating seller listing pricing overrides', { listingId: dto.listing_id });

    const rows = await this.db.update<Record<string, unknown>>('seller_listings', { id: dto.listing_id }, {
      pricing_overrides: dto.overrides,
      updated_at: new Date().toISOString(),
    });

    if (rows.length === 0) throw new Error(`Seller listing ${dto.listing_id} not found`);

    return {
      listing_id: dto.listing_id,
      pricing_overrides: dto.overrides,
    };
  }

  async setSellerListingVisibility(dto: SetSellerListingVisibilityDto): Promise<SetSellerListingVisibilityResult> {
    logger.info('Setting seller listing visibility', { listingId: dto.listing_id, visibility: dto.visibility });

    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: dto.listing_id },
    });
    if (!listing) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const metadata = (listing.metadata as Record<string, unknown>) ?? {};
    metadata.visibility = dto.visibility;

    await this.db.update('seller_listings', { id: dto.listing_id }, {
      metadata,
      updated_at: new Date().toISOString(),
    });

    return { listing_id: dto.listing_id, visibility: dto.visibility };
  }

  async deactivateSellerListing(dto: DeactivateSellerListingDto): Promise<DeactivateSellerListingResult> {
    logger.info('Deactivating seller listing', { listingId: dto.listing_id });

    const result = await this.db.invokeFunction<{ status: string }>('provider-procurement', {
      action: 'seller-listing',
      sub_action: 'deactivate',
      listing_id: dto.listing_id,
      admin_id: dto.admin_id,
    });

    return { listing_id: dto.listing_id, status: result.status ?? 'inactive' };
  }

  async deleteSellerListing(dto: DeleteSellerListingDto): Promise<void> {
    logger.info('Deleting seller listing', { listingId: dto.listing_id, deactivateFirst: dto.deactivate_first });

    if (dto.deactivate_first) {
      try {
        await this.deactivateSellerListing({ listing_id: dto.listing_id, admin_id: dto.admin_id });
      } catch (err) {
        logger.warn('Deactivation before delete failed, proceeding with DB removal', { error: err });
      }
    }

    await this.db.delete('seller_listings', { id: dto.listing_id });
  }

  async recoverSellerListingHealth(dto: RecoverSellerListingHealthDto): Promise<RecoverSellerListingHealthResult> {
    logger.info('Recovering seller listing health', { listingId: dto.listing_id });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (dto.reset_metrics) {
      updates.callback_fail_count = 0;
      updates.callback_success_count = 0;
    }
    if (dto.clear_pause_message) {
      updates.error_message = null;
    }
    if (dto.resume_active) {
      updates.status = 'active';
      updates.health_status = 'healthy';
    }

    const rows = await this.db.update<Record<string, unknown>>('seller_listings', { id: dto.listing_id }, updates);
    if (rows.length === 0) throw new Error(`Seller listing ${dto.listing_id} not found`);

    return {
      listing_id: dto.listing_id,
      status: rows[0].status as string,
      health_status: (rows[0].health_status as string) ?? 'healthy',
    };
  }

  async syncSellerStock(dto: SyncSellerStockDto): Promise<SyncSellerStockResult> {
    logger.info('Syncing seller stock', { listingId: dto.listing_id });

    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: dto.listing_id },
    });
    if (!listing) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const subAction = listing.listing_type === 'declared_stock' ? 'declare-stock' : 'sync';
    const result = await this.db.invokeFunction<{ declared_stock?: number }>('provider-procurement', {
      action: 'seller-stock',
      sub_action: subAction,
      listing_id: dto.listing_id,
      admin_id: dto.admin_id,
    });

    return {
      listing_id: dto.listing_id,
      declared_stock: result.declared_stock ?? (listing.declared_stock as number) ?? 0,
      synced_at: new Date().toISOString(),
    };
  }

  async fetchRemoteStock(dto: FetchRemoteStockDto): Promise<FetchRemoteStockResult> {
    logger.info('Fetching remote stock', { listingId: dto.listing_id });

    const result = await this.db.invokeFunction<{ items: FetchRemoteStockResult['items'] }>('provider-procurement', {
      action: 'seller-stock',
      sub_action: 'fetch-remote',
      listing_id: dto.listing_id,
      admin_id: dto.admin_id,
    });

    return {
      listing_id: dto.listing_id,
      items: result.items ?? [],
    };
  }

  // --- Private Helpers ---

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
