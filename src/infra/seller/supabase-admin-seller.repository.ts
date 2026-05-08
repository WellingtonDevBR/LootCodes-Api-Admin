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
  GetProviderAccountDetailResult,
  GetWebhookStatusResult,
  RegisterWebhooksResult,
  CreateVariantOfferDto,
  CreateVariantOfferResult,
  UpdateVariantOfferDto,
  UpdateVariantOfferResult,
  ProviderAccountItem,
  ProviderAccountDetail,
  SellerListingItem,
  VariantOfferItem,
  ProcurementConfig,
} from '../../core/use-cases/seller/seller.types.js';
import { parseSellerConfig } from '../../core/use-cases/seller/seller.types.js';
import { mergeApiProfilePatch } from './merge-api-profile.js';
import { extractPublicApiProfileFields } from './extract-public-api-profile-fields.js';
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
  FetchRemoteStockDto,
  FetchRemoteStockResult,
  SellerListingPublishContext,
  PublishSellerListingToMarketplaceResult,
  BindSellerListingExternalAuctionDto,
  BindSellerListingExternalAuctionResult,
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
      neq: [['health_status', 'deleted']],
      order: { column: 'priority', ascending: true },
    });
    return { accounts: rows };
  }

  async listSellerListingsForVariant(dto: ListSellerListingsDto): Promise<ListSellerListingsResult> {
    const listingQueryOpts = {
      eq: [['variant_id', dto.variant_id]] as Array<[string, unknown]>,
      order: { column: 'created_at', ascending: true },
    };

    let rows = await this.db.query<Record<string, unknown>>('seller_listings', listingQueryOpts);

    let repairedAny = false;
    for (const r of rows) {
      const ext = (r.external_listing_id as string | null)?.trim();
      if (ext && r.status === 'failed') {
        await this.repairSellerListingRowIfStaleFailure(r.id as string);
        repairedAny = true;
      }
    }
    if (repairedAny) {
      rows = await this.db.query<Record<string, unknown>>('seller_listings', listingQueryOpts);
    }

    const accountMap = rows.length > 0 ? await this.buildAccountMap() : new Map();

    const listings: SellerListingItem[] = rows.map((r) => {
      const account = accountMap.get(r.provider_account_id as string);
      return {
        id: r.id as string,
        variant_id: r.variant_id as string,
        provider_account_id: r.provider_account_id as string,
        external_listing_id: (r.external_listing_id as string) ?? null,
        external_product_id: (r.external_product_id as string) ?? null,
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
        pricing_overrides: (r.pricing_overrides as Record<string, unknown> | null) ?? null,
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

  async getProviderAccountDetail(id: string): Promise<GetProviderAccountDetailResult> {
    const row = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
      filter: { id },
    });
    if (!row) throw new Error(`Provider account ${id} not found`);

    const rawSeller = (row.seller_config as Record<string, unknown>) ?? {};
    const rawProcurement = (row.procurement_config as Record<string, unknown>) ?? {};
    const rawApiProfile = (row.api_profile as Record<string, unknown>) ?? {};

    const account: ProviderAccountDetail = {
      id: row.id as string,
      provider_code: row.provider_code as string,
      display_name: row.display_name as string,
      is_enabled: row.is_enabled as boolean,
      priority: row.priority as number,
      health_status: (row.health_status as string) ?? 'unknown',
      prioritize_quote_sync: row.prioritize_quote_sync as boolean,
      supports_catalog: row.supports_catalog as boolean,
      supports_quote: row.supports_quote as boolean,
      supports_purchase: row.supports_purchase as boolean,
      supports_callback: row.supports_callback as boolean,
      supports_seller: row.supports_seller as boolean,
      seller_config: parseSellerConfig(rawSeller),
      procurement_config: rawProcurement as ProcurementConfig,
      api_profile_keys: Object.keys(rawApiProfile),
      api_profile_public: extractPublicApiProfileFields(rawApiProfile),
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };

    return { account };
  }

  async registerWebhooks(accountId: string): Promise<RegisterWebhooksResult> {
    logger.info('Registering webhooks via Edge Function', { accountId });
    const result = await this.db.invokeFunction('provider-procurement', {
      action: 'seller-stock',
      sub_action: 'register-callbacks',
      provider_account_id: accountId,
    });
    return {
      registered: (result as Record<string, unknown>).registered as number ?? 0,
      webhook_ids: ((result as Record<string, unknown>).webhook_ids as string[]) ?? [],
    };
  }

  async getWebhookStatus(accountId: string): Promise<GetWebhookStatusResult> {
    logger.info('Fetching webhook status', { accountId });

    const row = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
      filter: { id: accountId },
      select: 'id,seller_config',
    });
    if (!row) throw new Error(`Provider account ${accountId} not found`);

    const parsed = parseSellerConfig((row.seller_config as Record<string, unknown>) ?? {});
    const callbackIds = Array.isArray(parsed.callback_ids)
      ? (parsed.callback_ids as Record<string, unknown>[]).map((w) => ({
          id: (w.id as string) ?? '',
          type: (w.type as string) ?? 'unknown',
          url: (w.url as string) ?? '',
          active: (w.active as boolean) ?? false,
        }))
      : [];

    return {
      provider_account_id: accountId,
      webhooks: callbackIds,
      declared_stock_enabled: parsed.seller_declared_stock_enabled,
    };
  }

  async createProviderAccount(dto: CreateProviderAccountDto): Promise<CreateProviderAccountResult> {
    const now = new Date().toISOString();
    const row = await this.db.insert<Record<string, unknown>>('provider_accounts', {
      provider_code: dto.provider_code,
      display_name: dto.display_name,
      is_enabled: dto.is_enabled ?? false,
      priority: dto.priority ?? 100,
      api_profile: dto.api_profile ?? {},
      supports_catalog: dto.supports_catalog ?? false,
      supports_quote: dto.supports_quote ?? false,
      supports_purchase: dto.supports_purchase ?? false,
      supports_callback: dto.supports_callback ?? false,
      supports_seller: dto.supports_seller ?? false,
      seller_config: dto.seller_config ?? {},
      procurement_config: dto.procurement_config ?? {},
      prioritize_quote_sync: dto.prioritize_quote_sync ?? false,
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
    if (fields.health_status !== undefined) updates.health_status = fields.health_status;
    if (fields.prioritize_quote_sync !== undefined) updates.prioritize_quote_sync = fields.prioritize_quote_sync;

    if (fields.seller_config !== undefined || fields.procurement_config !== undefined) {
      const existing = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
        filter: { id },
        select: 'seller_config,procurement_config',
      });
      if (!existing) throw new Error(`Provider account ${id} not found`);

      if (fields.seller_config !== undefined) {
        const existingSeller = (existing.seller_config as Record<string, unknown>) ?? {};
        updates.seller_config = { ...existingSeller, ...fields.seller_config };
      }
      if (fields.procurement_config !== undefined) {
        const existingProcurement = (existing.procurement_config as Record<string, unknown>) ?? {};
        updates.procurement_config = { ...existingProcurement, ...fields.procurement_config };
      }
    }

    if (fields.api_profile !== undefined) {
      const existingRow = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
        filter: { id },
        select: 'api_profile',
      });
      if (!existingRow) throw new Error(`Provider account ${id} not found`);
      updates.api_profile = mergeApiProfilePatch(
        existingRow.api_profile as Record<string, unknown>,
        fields.api_profile,
      );
    }

    const rows = await this.db.update<Record<string, unknown>>('provider_accounts', { id }, updates);
    if (rows.length === 0) throw new Error(`Provider account ${id} not found`);
    return { account: rows[0] as unknown as ProviderAccountItem };
  }

  async deleteProviderAccount(id: string): Promise<void> {
    await this.db.update('provider_accounts', { id }, {
      is_enabled: false,
      health_status: 'deleted',
      updated_at: new Date().toISOString(),
    });
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

    const now = new Date().toISOString();
    const row = await this.db.insert<Record<string, unknown>>('seller_listings', {
      variant_id: dto.variant_id,
      provider_account_id: dto.provider_account_id,
      external_product_id: dto.external_product_id ?? null,
      listing_type: dto.listing_type ?? 'declared_stock',
      status: 'active',
      currency: dto.currency ?? 'EUR',
      price_cents: dto.price_cents,
      min_price_cents: 0,
      declared_stock: 0,
      auto_sync_stock: dto.auto_sync_stock ?? true,
      auto_sync_price: dto.auto_sync_price ?? false,
      created_at: now,
      updated_at: now,
    });

    await this.recordSellerListingDomainEvent({
      listing_id: row.id as string,
      event_type: 'seller.listing_created',
      payload: {
        listing_id: row.id,
        variant_id: dto.variant_id,
        provider_account_id: dto.provider_account_id,
        admin_id: dto.admin_id,
      },
      created_at: now,
    });

    return {
      listing_id: row.id as string,
      external_listing_id: null,
      status: 'active',
    };
  }

  async updateSellerListingPrice(dto: UpdateSellerListingPriceDto): Promise<UpdateSellerListingPriceResult> {
    logger.info('Updating seller listing price', { listingId: dto.listing_id, priceCents: dto.price_cents });

    const now = new Date().toISOString();
    const rows = await this.db.update<Record<string, unknown>>('seller_listings', { id: dto.listing_id }, {
      price_cents: dto.price_cents,
      updated_at: now,
    });

    if (rows.length === 0) throw new Error(`Seller listing ${dto.listing_id} not found`);

    await this.recordSellerListingDomainEvent({
      listing_id: dto.listing_id,
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

    const now = new Date().toISOString();
    const rows = await this.db.update<Record<string, unknown>>('seller_listings', { id: dto.listing_id }, {
      status: 'inactive',
      updated_at: now,
    });

    if (rows.length === 0) throw new Error(`Seller listing ${dto.listing_id} not found`);

    await this.recordSellerListingDomainEvent({
      listing_id: dto.listing_id,
      event_type: 'seller.listing_removed',
      payload: { listing_id: dto.listing_id, admin_id: dto.admin_id },
      created_at: now,
    });

    return { listing_id: dto.listing_id, status: 'inactive' };
  }

  async unlinkSellerListingMarketplaceProduct(
    dto: UnlinkSellerListingMarketplaceProductDto,
  ): Promise<UnlinkSellerListingMarketplaceProductResult> {
    logger.info('Unlinking marketplace product from seller listing', { listingId: dto.listing_id });

    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: dto.listing_id },
    });
    if (!listing) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const previousExternalProductId = (listing.external_product_id as string | null) ?? null;
    const previousExternalListingId = (listing.external_listing_id as string | null) ?? null;

    const now = new Date().toISOString();
    const rows = await this.db.update<Record<string, unknown>>('seller_listings', { id: dto.listing_id }, {
      external_product_id: null,
      external_listing_id: null,
      status: 'draft',
      auto_sync_stock: false,
      auto_sync_price: false,
      error_message: null,
      updated_at: now,
    });

    if (rows.length === 0) throw new Error(`Seller listing ${dto.listing_id} not found`);

    await this.recordSellerListingDomainEvent({
      listing_id: dto.listing_id,
      event_type: 'seller.listing_marketplace_unlinked',
      payload: {
        listing_id: dto.listing_id,
        variant_id: listing.variant_id as string,
        provider_account_id: listing.provider_account_id as string,
        admin_id: dto.admin_id,
        previous_external_product_id: previousExternalProductId,
        previous_external_listing_id: previousExternalListingId,
      },
      created_at: now,
    });

    return {
      listing_id: dto.listing_id,
      variant_id: listing.variant_id as string,
      provider_account_id: listing.provider_account_id as string,
      external_product_id: null,
      external_listing_id: null,
      status: rows[0].status as string,
      previous_external_product_id: previousExternalProductId,
      previous_external_listing_id: previousExternalListingId,
    };
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
      updates.reservation_consecutive_failures = 0;
      updates.reservation_success_count = 0;
      updates.reservation_failure_count = 0;
      updates.provision_success_count = 0;
      updates.provision_failure_count = 0;
    }
    if (dto.clear_pause_message) {
      updates.error_message = null;
    }
    if (dto.resume_active) {
      updates.status = 'active';
    }

    const rows = await this.db.update<Record<string, unknown>>('seller_listings', { id: dto.listing_id }, updates);
    if (rows.length === 0) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const status = rows[0].status as string;

    return {
      listing_id: dto.listing_id,
      status,
      health_status: status === 'active' ? 'healthy' : 'degraded',
    };
  }

  async syncSellerStock(dto: SyncSellerStockDto): Promise<SyncSellerStockResult> {
    logger.info('Syncing seller stock', { listingId: dto.listing_id });

    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: dto.listing_id },
    });
    if (!listing) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const availableKeys = await this.db.query<Record<string, unknown>>('product_keys', {
      eq: [
        ['variant_id', listing.variant_id as string],
        ['key_state', 'available'],
      ],
    });

    const stockCount = availableKeys.length;
    const now = new Date().toISOString();

    await this.db.update('seller_listings', { id: dto.listing_id }, {
      declared_stock: stockCount,
      last_synced_at: now,
      updated_at: now,
      error_message: null,
    });

    return {
      listing_id: dto.listing_id,
      declared_stock: stockCount,
      synced_at: now,
    };
  }

  async fetchRemoteStock(dto: FetchRemoteStockDto): Promise<FetchRemoteStockResult> {
    logger.info('Fetching remote stock from local data', { listingId: dto.listing_id });

    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: dto.listing_id },
    });
    if (!listing) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const variant = await this.db.queryOne<Record<string, unknown>>('product_variants', {
      filter: { id: listing.variant_id as string },
      select: 'id,name',
    });

    const availableKeys = await this.db.query<Record<string, unknown>>('product_keys', {
      eq: [
        ['variant_id', listing.variant_id as string],
        ['key_state', 'available'],
      ],
    });

    const stockCount = availableKeys.length;
    const items = [{
      external_id: (listing.external_product_id as string) ?? (listing.id as string),
      name: (variant?.name as string) ?? 'Unknown variant',
      price_cents: (listing.price_cents as number) ?? 0,
      currency: (listing.currency as string) ?? 'EUR',
      stock: stockCount,
      is_own: true,
    }];

    return {
      listing_id: dto.listing_id,
      items,
    };
  }

  async getSellerListingPublishContext(listingId: string): Promise<SellerListingPublishContext | null> {
    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: listingId },
    });
    if (!listing) return null;
    const account = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
      filter: { id: listing.provider_account_id as string },
    });
    if (!account) return null;
    return {
      listing_id: listing.id as string,
      variant_id: listing.variant_id as string,
      provider_account_id: listing.provider_account_id as string,
      provider_code: account.provider_code as string,
      external_product_id: (listing.external_product_id as string | null) ?? null,
      external_listing_id: (listing.external_listing_id as string | null) ?? null,
      listing_type: listing.listing_type as 'key_upload' | 'declared_stock',
      price_cents: listing.price_cents as number,
      currency: listing.currency as string,
      status: listing.status as string,
    };
  }

  async repairSellerListingRowIfStaleFailure(listingId: string): Promise<void> {
    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: listingId },
    });
    if (!listing) return;

    const ext = (listing.external_listing_id as string | null)?.trim();
    if (!ext || listing.status !== 'failed') return;

    await this.db.update('seller_listings', { id: listingId }, {
      status: 'active',
      error_message: null,
      updated_at: new Date().toISOString(),
    });

    logger.info('Repaired seller listing stuck as failed despite marketplace auction id', {
      listing_id: listingId,
    });
  }

  async countAvailableProductKeysForVariant(variantId: string): Promise<number> {
    const keys = await this.db.query<Record<string, unknown>>('product_keys', {
      eq: [
        ['variant_id', variantId],
        ['key_state', 'available'],
      ],
    });
    return keys.length;
  }

  async finalizeSellerListingMarketplacePublishSuccess(params: {
    listing_id: string;
    external_listing_id: string;
    declared_stock: number;
    admin_id: string;
    listing_type?: 'declared_stock';
  }): Promise<PublishSellerListingToMarketplaceResult> {
    const now = new Date().toISOString();
    await this.db.update('seller_listings', { id: params.listing_id }, {
      external_listing_id: params.external_listing_id,
      status: 'active',
      declared_stock: params.declared_stock,
      ...(params.listing_type != null ? { listing_type: params.listing_type } : {}),
      error_message: null,
      auto_sync_stock: true,
      updated_at: now,
      last_synced_at: now,
    });

    await this.recordSellerListingDomainEvent({
      listing_id: params.listing_id,
      event_type: 'seller.listing_updated',
      payload: {
        listing_id: params.listing_id,
        field: 'marketplace_publish',
        external_listing_id: params.external_listing_id,
        admin_id: params.admin_id,
      },
      created_at: now,
    });

    return {
      listing_id: params.listing_id,
      external_listing_id: params.external_listing_id,
      status: 'active',
      skipped_already_published: false,
    };
  }

  async markSellerListingPublishFailure(listing_id: string, error_message: string): Promise<void> {
    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: listing_id },
    });
    if (!listing) return;

    const hasRemoteAuction = Boolean((listing.external_listing_id as string | null)?.trim());
    const now = new Date().toISOString();

    if (hasRemoteAuction) {
      logger.warn(
        'Publish failed after marketplace row was linked — keeping active (likely audit insert followed listing update)',
        { listing_id, truncated_error: error_message.slice(0, 500) },
      );
      await this.db.update('seller_listings', { id: listing_id }, {
        status: 'active',
        error_message: null,
        updated_at: now,
      });
      return;
    }

    await this.db.update('seller_listings', { id: listing_id }, {
      error_message,
      /** Matches Postgres `seller_listings_status_check` (there is no `error` value). */
      status: 'failed',
      updated_at: now,
    });
  }

  /**
   * Persist a JIT-publish-derived price on a listing and emit a domain
   * event tagging the source buyer for audit. Called only when the
   * publish use case fell back to a buyer-funded plan because there
   * were no on-hand keys.
   */
  async updateSellerListingJitPublishPrice(params: {
    listing_id: string;
    price_cents: number;
    source_provider_code: string;
    source_provider_account_id: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.update('seller_listings', { id: params.listing_id }, {
      price_cents: params.price_cents,
      updated_at: now,
    });

    await this.recordSellerListingDomainEvent({
      listing_id: params.listing_id,
      event_type: 'seller.listing_updated',
      payload: {
        listing_id: params.listing_id,
        field: 'jit_publish_price',
        price_cents: params.price_cents,
        source_provider_code: params.source_provider_code,
        source_provider_account_id: params.source_provider_account_id,
      },
      created_at: now,
    });
  }

  async finalizeSellerListingBindExistingAuction(
    dto: BindSellerListingExternalAuctionDto & { verified_remote_status: string },
  ): Promise<BindSellerListingExternalAuctionResult> {
    const now = new Date().toISOString();
    const extId = dto.external_listing_id.trim();
    await this.db.update('seller_listings', { id: dto.listing_id }, {
      external_listing_id: extId,
      status: 'active',
      error_message: null,
      updated_at: now,
    });

    await this.recordSellerListingDomainEvent({
      listing_id: dto.listing_id,
      event_type: 'seller.listing_updated',
      payload: {
        listing_id: dto.listing_id,
        field: 'external_listing_id_manual_bind',
        external_listing_id: extId,
        admin_id: dto.admin_id,
      },
      created_at: now,
    });

    return {
      listing_id: dto.listing_id,
      external_listing_id: extId,
      status: 'active',
      verified_remote_status: dto.verified_remote_status,
    };
  }

  // --- Private Helpers ---

  /** Matches `public.domain_events`: `aggregate_type` / `aggregate_id` are NOT NULL (seller aggregate = listing row). */
  private async recordSellerListingDomainEvent(params: {
    readonly listing_id: string;
    readonly event_type: string;
    readonly payload: Record<string, unknown>;
    readonly created_at: string;
  }): Promise<void> {
    await this.db.insert('domain_events', {
      event_type: params.event_type,
      aggregate_type: 'seller',
      aggregate_id: params.listing_id,
      payload: params.payload,
      version: 1,
      created_at: params.created_at,
    });
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
