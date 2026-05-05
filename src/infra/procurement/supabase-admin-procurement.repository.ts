import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../../core/ports/marketplace-adapter.port.js';
import type { IAdminProcurementRepository } from '../../core/ports/admin-procurement-repository.port.js';
import type {
  TestProviderQuoteDto,
  TestProviderQuoteResult,
  SearchProvidersDto,
  SearchProvidersResult,
  ManageProviderOfferDto,
  ManageProviderOfferResult,
  IngestProviderCatalogDto,
  IngestProviderCatalogResult,
  IngestProviderCatalogStatusDto,
  IngestProviderCatalogStatusResult,
  RefreshProviderPricesDto,
  RefreshProviderPricesResult,
  ManualProviderPurchaseDto,
  ManualProviderPurchaseResult,
  RecoverProviderOrderDto,
  RecoverProviderOrderResult,
  SearchCatalogDto,
  SearchCatalogResult,
  CatalogProductRow,
  LinkCatalogProductDto,
  LinkCatalogProductResult,
  LiveSearchProvidersDto,
  LiveSearchProvidersResult,
  LiveSearchProviderGroup,
} from '../../core/use-cases/procurement/procurement.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminProcurementRepository');

const DEFAULT_SEARCH_LIMIT = 20;

@injectable()
export class SupabaseAdminProcurementRepository implements IAdminProcurementRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
  ) {}

  async testProviderQuote(dto: TestProviderQuoteDto): Promise<TestProviderQuoteResult> {
    logger.info('Testing provider quote', { variantId: dto.variant_id, provider: dto.provider_code });

    const offers = await this.db.query<{ provider_code: string; last_price_cents: number; available_quantity: number }>(
      'provider_variant_offers',
      {
        filter: dto.provider_code
          ? { variant_id: dto.variant_id, provider_code: dto.provider_code }
          : { variant_id: dto.variant_id },
      },
    );

    const quotes = offers.map((offer) => ({
      provider: offer.provider_code,
      price_cents: offer.last_price_cents,
      available: offer.available_quantity > 0,
    }));

    return { quotes };
  }

  async searchProviders(dto: SearchProvidersDto): Promise<SearchProvidersResult> {
    logger.info('Searching provider catalog', { query: dto.query });

    const result = await this.db.rpc<unknown[]>(
      'search_provider_catalog',
      {
        p_query: dto.query,
        p_limit: dto.limit ?? DEFAULT_SEARCH_LIMIT,
      },
    );

    return { providers: result ?? [] };
  }

  async manageProviderOffer(dto: ManageProviderOfferDto): Promise<ManageProviderOfferResult> {
    logger.info('Managing provider offer', { variantId: dto.variant_id, provider: dto.provider_code, action: dto.action });

    switch (dto.action) {
      case 'link': {
        await this.db.insert('provider_variant_offers', {
          variant_id: dto.variant_id,
          provider_code: dto.provider_code,
          ...dto.offer_data,
        });
        break;
      }
      case 'unlink': {
        await this.db.delete('provider_variant_offers', {
          variant_id: dto.variant_id,
          provider_code: dto.provider_code,
        });
        break;
      }
      case 'update': {
        await this.db.update(
          'provider_variant_offers',
          { variant_id: dto.variant_id, provider_code: dto.provider_code },
          dto.offer_data ?? {},
        );
        break;
      }
    }

    return { success: true };
  }

  async ingestProviderCatalog(dto: IngestProviderCatalogDto): Promise<IngestProviderCatalogResult> {
    logger.info('Starting provider catalog ingestion', { provider: dto.provider_code, adminId: dto.admin_id });

    const result = await this.db.rpc<{ job_id: string; status: string }>(
      'start_catalog_ingestion_job',
      { p_provider_code: dto.provider_code, p_admin_id: dto.admin_id },
    );

    return { job_id: result.job_id, status: result.status };
  }

  async ingestProviderCatalogStatus(dto: IngestProviderCatalogStatusDto): Promise<IngestProviderCatalogStatusResult> {
    const job = await this.db.queryOne<{ id: string; status: string; progress: number; error: string | null }>(
      'provider_product_catalog',
      { filter: { job_id: dto.job_id }, single: true },
    );

    if (!job) {
      return { job_id: dto.job_id, status: 'not_found' };
    }

    return {
      job_id: dto.job_id,
      status: job.status,
      progress: job.progress,
      error: job.error ?? undefined,
    };
  }

  async refreshProviderPrices(dto: RefreshProviderPricesDto): Promise<RefreshProviderPricesResult> {
    logger.info('Refreshing provider prices', { provider: dto.provider_code, adminId: dto.admin_id });

    const params: Record<string, unknown> = { p_admin_id: dto.admin_id };
    if (dto.provider_code) {
      params.p_provider_code = dto.provider_code;
    }

    const result = await this.db.rpc<{ prices_updated: number }>(
      'refresh_provider_offer_prices',
      params,
    );

    return { success: true, prices_updated: result.prices_updated ?? 0 };
  }

  async manualProviderPurchase(dto: ManualProviderPurchaseDto): Promise<ManualProviderPurchaseResult> {
    logger.info('Manual provider purchase', { variantId: dto.variant_id, provider: dto.provider_code, quantity: dto.quantity });

    const result = await this.db.insert<{ id: string }>('provider_purchase_queue', {
      variant_id: dto.variant_id,
      provider_code: dto.provider_code,
      quantity: dto.quantity,
      requested_by: dto.admin_id,
      status: 'pending',
    });

    return { success: true, purchase_id: result.id };
  }

  async recoverProviderOrder(dto: RecoverProviderOrderDto): Promise<RecoverProviderOrderResult> {
    logger.info('Recovering provider order', { purchaseId: dto.purchase_id, adminId: dto.admin_id });

    const result = await this.db.rpc<{ new_status: string }>(
      'claim_pending_provider_purchases',
      { p_purchase_id: dto.purchase_id, p_admin_id: dto.admin_id },
    );

    return { success: true, new_status: result.new_status };
  }

  async searchCatalog(dto: SearchCatalogDto): Promise<SearchCatalogResult> {
    const pageSize = dto.page_size ?? 20;
    const page = dto.page ?? 1;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    logger.info('Searching provider catalog table', { search: dto.search, provider: dto.provider_code, page });

    const select = 'id, provider_code, external_product_id, product_name, platform, region, min_price_cents, currency, qty, available_to_buy, thumbnail, slug, wholesale_price_cents, updated_at';
    const ilike: Array<[string, string]> = [];
    const filter: Record<string, unknown> = {};

    if (dto.search) {
      ilike.push(['product_name', `%${dto.search}%`]);
    }
    if (dto.provider_code) {
      filter.provider_code = dto.provider_code;
    }

    const { data, total } = await this.db.queryPaginated<CatalogProductRow>(
      'provider_product_catalog',
      {
        select,
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        ilike: ilike.length > 0 ? ilike : undefined,
        order: { column: 'product_name', ascending: true },
        range: [from, to],
      },
    );

    return { products: data, total };
  }

  async linkCatalogProduct(dto: LinkCatalogProductDto): Promise<LinkCatalogProductResult> {
    logger.info('Linking catalog product to variant', {
      variantId: dto.variant_id,
      provider: dto.provider_code,
      externalProduct: dto.external_product_id,
    });

    const accounts = await this.db.query<{ id: string; supports_seller: boolean }>(
      'provider_accounts',
      { filter: { provider_code: dto.provider_code }, limit: 1 },
    );
    const account = accounts[0];
    if (!account) {
      throw new Error(`No provider account found for provider_code=${dto.provider_code}`);
    }

    const offer = await this.db.insert<{ id: string }>('provider_variant_offers', {
      variant_id: dto.variant_id,
      provider_code: dto.provider_code,
      provider_account_id: account.id,
      external_product_id: dto.external_product_id,
      currency: dto.currency,
      last_price_cents: dto.price_cents,
      is_active: true,
    });

    let sellerListingId: string | null = null;

    if (account.supports_seller) {
      const existingListings = await this.db.query<{ id: string }>(
        'seller_listings',
        {
          filter: { variant_id: dto.variant_id, provider_account_id: account.id },
          limit: 1,
        },
      );

      if (existingListings.length === 0) {
        const listing = await this.db.insert<{ id: string }>('seller_listings', {
          variant_id: dto.variant_id,
          provider_account_id: account.id,
          external_product_id: dto.external_product_id,
          status: 'draft',
          currency: dto.currency,
          price_cents: dto.price_cents,
        });
        sellerListingId = listing.id;
      }
    }

    return { offer_id: offer.id, seller_listing_id: sellerListingId };
  }

  async liveSearchProviders(dto: LiveSearchProvidersDto): Promise<LiveSearchProvidersResult> {
    const maxResults = dto.max_results ?? 10;
    const excludeSet = new Set(dto.exclude_provider_codes ?? []);

    const allProviders = this.registry.getSupportedProviders()
      .filter((code) => !excludeSet.has(code));

    logger.info('Live searching marketplace APIs + local catalog', {
      query: dto.query,
      maxResults,
      providers: allProviders,
    });

    const liveProviders: string[] = [];
    const catalogOnlyProviders: string[] = [];

    for (const code of allProviders) {
      if (this.registry.hasCapability(code, 'product_search')) {
        liveProviders.push(code);
      } else {
        catalogOnlyProviders.push(code);
      }
    }

    const livePromises = liveProviders.map(async (providerCode): Promise<LiveSearchProviderGroup> => {
      const adapter = this.registry.getProductSearchAdapter(providerCode)!;
      try {
        const results = await adapter.searchProducts(dto.query, maxResults);
        return {
          provider_code: providerCode,
          offers: results.map((r) => ({
            provider_code: providerCode,
            external_product_id: r.externalProductId,
            product_name: r.productName,
            platform: r.platform,
            region: r.region,
            price_cents: r.priceCents,
            currency: r.currency,
            available: r.available,
            thumbnail: null,
          })),
        };
      } catch (err) {
        logger.warn(`Live search failed for provider ${providerCode}`, err as Error);
        return { provider_code: providerCode, offers: [] };
      }
    });

    let catalogPromise: Promise<LiveSearchProviderGroup[]> = Promise.resolve([]);
    if (catalogOnlyProviders.length > 0) {
      catalogPromise = this.searchLocalCatalogGrouped(dto.query, catalogOnlyProviders, maxResults);
    }

    const [liveResults, catalogResults] = await Promise.all([
      Promise.allSettled(livePromises),
      catalogPromise,
    ]);

    const providers: LiveSearchProviderGroup[] = [];

    for (const result of liveResults) {
      if (result.status === 'fulfilled') {
        providers.push(result.value);
      }
    }

    for (const group of catalogResults) {
      providers.push(group);
    }

    return { providers };
  }

  private async searchLocalCatalogGrouped(
    query: string,
    providerCodes: string[],
    maxPerProvider: number,
  ): Promise<LiveSearchProviderGroup[]> {
    try {
      const { data } = await this.db.queryPaginated<CatalogProductRow>(
        'provider_product_catalog',
        {
          select: 'id, provider_code, external_product_id, product_name, platform, region, min_price_cents, currency, qty, available_to_buy, thumbnail',
          ilike: [['product_name', `%${query}%`]],
          in: [['provider_code', providerCodes]],
          order: { column: 'product_name', ascending: true },
          range: [0, providerCodes.length * maxPerProvider - 1],
        },
      );

      const grouped = new Map<string, LiveSearchProviderGroup>();
      for (const row of data) {
        let group = grouped.get(row.provider_code);
        if (!group) {
          group = { provider_code: row.provider_code, offers: [] };
          grouped.set(row.provider_code, group);
        }
        if (group.offers.length >= maxPerProvider) continue;
        group.offers.push({
          provider_code: row.provider_code,
          external_product_id: row.external_product_id,
          product_name: row.product_name,
          platform: row.platform ?? null,
          region: row.region ?? null,
          price_cents: row.min_price_cents ?? 0,
          currency: row.currency ?? 'EUR',
          available: row.available_to_buy ?? true,
          thumbnail: row.thumbnail ?? null,
        });
      }

      return [...grouped.values()];
    } catch (err) {
      logger.warn('Local catalog search failed for live search fallback', err as Error);
      return [];
    }
  }
}
