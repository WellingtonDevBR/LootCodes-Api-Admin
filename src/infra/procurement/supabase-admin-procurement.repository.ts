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
  LiveSearchDiagnostics,
  LiveSearchOffer,
  GetProcurementConfigResult,
  UpdateProcurementConfigDto,
  ProcurementConfig,
  ListPurchaseQueueDto,
  ListPurchaseQueueResult,
  PurchaseQueueItemRow,
  CancelQueueItemDto,
  CancelQueueItemResult,
  ListPurchaseAttemptsDto,
  ListPurchaseAttemptsResult,
  PurchaseAttemptRow,
} from '../../core/use-cases/procurement/procurement.types.js';
import { createLogger } from '../../shared/logger.js';
import {
  catalogProductRowToLiveSearchOffer,
  liveSearchOffersToCatalogUpsertRows,
  mergeLiveSearchOffers,
  productSearchResultsToLiveSearchOffers,
} from './live-search-mapping.js';
import { refreshBambooOfferSnapshotsForVariant } from './bamboo-variant-offer-quote-refresh.js';
import { refreshAppRouteOfferSnapshotsForVariant } from './approute-variant-offer-quote-refresh.js';
import { syncAppRouteProductCatalog } from './approute-catalog-sync.js';
import { catalogProductNameIlikeClauses } from './catalog-product-name-search.js';
import { randomUUID } from 'node:crypto';
import { InternalError, NotFoundError } from '../../core/errors/domain-errors.js';

const logger = createLogger('AdminProcurementRepository');

const DEFAULT_SEARCH_LIMIT = 20;

function procurementQuoteProviderLabel(
  providerCode: string | null | undefined,
  displayName: string | null | undefined,
): string {
  const code = typeof providerCode === 'string' ? providerCode.trim() : '';
  if (code.length > 0) return code;
  const name = typeof displayName === 'string' ? displayName.trim() : '';
  if (name.length > 0) return name;
  return 'unknown';
}

@injectable()
export class SupabaseAdminProcurementRepository implements IAdminProcurementRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
  ) {}

  async testProviderQuote(dto: TestProviderQuoteDto): Promise<TestProviderQuoteResult> {
    logger.info('Testing provider quote', { variantId: dto.variant_id, provider: dto.provider_code });

    type OfferRow = {
      readonly id: string;
      readonly provider_account_id: string;
      readonly external_offer_id: string | null;
      external_parent_product_id: string | null;
      currency: string | null;
      last_price_cents: number | null;
      available_quantity: number | null;
    };

    const rawOffers = await this.db.query<OfferRow>('provider_variant_offers', {
      filter: { variant_id: dto.variant_id },
    });

    if (rawOffers.length === 0) {
      return { quotes: [] };
    }

    const offers = rawOffers.map((o) => ({ ...o }));

    const accountIds = [...new Set(offers.map((o) => o.provider_account_id))];
    const accounts = await this.db.query<{
      id: string;
      provider_code: string | null;
      display_name: string | null;
      api_profile: unknown;
    }>('provider_accounts', {
      in: [['id', accountIds]],
    });

    const filterCode = typeof dto.provider_code === 'string' ? dto.provider_code.trim() : '';
    const allowedAccountIds = filterCode
      ? new Set(
          accounts
            .filter((a) => (a.provider_code ?? '').trim() === filterCode)
            .map((a) => a.id),
        )
      : null;

    const labelByAccountId = new Map(
      accounts.map((a) => [a.id, procurementQuoteProviderLabel(a.provider_code, a.display_name)]),
    );

    const accountsById = new Map(
      accounts.map((a) => {
        const raw = a.api_profile;
        const api_profile =
          raw != null && typeof raw === 'object' && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : null;
        return [
          a.id,
          {
            id: a.id,
            provider_code: a.provider_code,
            api_profile,
          },
        ] as const;
      }),
    );

    await refreshBambooOfferSnapshotsForVariant(this.db, offers, accountsById, {
      providerCodeFilter: filterCode.length > 0 ? filterCode : undefined,
    });

    await refreshAppRouteOfferSnapshotsForVariant(this.db, offers, accountsById, {
      providerCodeFilter: filterCode.length > 0 ? filterCode : undefined,
    });

    const quotes = offers
      .filter((o) => (allowedAccountIds === null ? true : allowedAccountIds.has(o.provider_account_id)))
      .map((offer) => {
        const qty = offer.available_quantity;
        const available = qty !== null && qty > 0;
        return {
          provider: labelByAccountId.get(offer.provider_account_id) ?? 'unknown',
          price_cents: offer.last_price_cents ?? 0,
          available,
          available_quantity: qty,
        };
      });

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

    const code = dto.provider_code.trim().toLowerCase();
    if (code === 'approute') {
      const rows = await this.db.query<{ id: string }>('provider_accounts', {
        select: 'id',
        eq: [['provider_code', 'approute']],
        limit: 1,
      });
      const accountId = rows[0]?.id;
      if (!accountId) {
        throw new NotFoundError('No provider_accounts row with provider_code approute');
      }

      const syncResult = await syncAppRouteProductCatalog(this.db, accountId);
      if (!syncResult.success) {
        throw new InternalError(syncResult.error);
      }

      return {
        job_id: `inline-sync-approute-${randomUUID()}`,
        status: 'completed',
      };
    }

    const result = await this.db.rpc<{ job_id: string; status: string }>(
      'start_catalog_ingestion_job',
      { p_provider_code: dto.provider_code, p_admin_id: dto.admin_id },
    );

    return { job_id: result.job_id, status: result.status };
  }

  async ingestProviderCatalogStatus(dto: IngestProviderCatalogStatusDto): Promise<IngestProviderCatalogStatusResult> {
    if (dto.job_id.startsWith('inline-sync-approute-')) {
      return {
        job_id: dto.job_id,
        status: 'completed',
        progress: 100,
      };
    }

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

  async recoverProviderOrder(dto: RecoverProviderOrderDto): Promise<RecoverProviderOrderResult> {
    logger.info('Recovering provider order', { purchaseId: dto.purchase_id, adminId: dto.admin_id });

    const result = await this.db.rpc<{ new_status: string }>(
      'claim_pending_provider_purchases',
      { p_purchase_id: dto.purchase_id, p_admin_id: dto.admin_id },
    );

    return { success: true, new_status: result.new_status };
  }

  async searchCatalog(dto: SearchCatalogDto): Promise<SearchCatalogResult> {
    const pageSize = dto.page_size ?? DEFAULT_SEARCH_LIMIT;
    const page = dto.page ?? 1;

    logger.info('Searching provider catalog table', { search: dto.search, provider: dto.provider_code, page });

    const select =
      'id, provider_code, external_product_id, external_parent_product_id, product_name, platform, region, min_price_cents, currency, qty, available_to_buy, thumbnail, slug, wholesale_price_cents, updated_at';

    const ilike = catalogProductNameIlikeClauses(dto.search);

    const sharedOpts = {
      select,
      ilike: ilike.length > 0 ? ilike : undefined,
      order: { column: 'product_name', ascending: true } as const,
    };

    const providerFilter = dto.provider_code?.trim();
    if (providerFilter) {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const { data, total } = await this.db.queryPaginated<CatalogProductRow>('provider_product_catalog', {
        ...sharedOpts,
        filter: { provider_code: providerFilter },
        range: [from, to],
      });
      return { products: data, total };
    }

    /** Blended catalog search: one global page slice used to starve late-sort providers (same class of bug as live-search local merge). */
    const codes = [...new Set(this.registry.getSupportedProviders())].filter((c) => c.trim().length > 0).sort();
    if (codes.length === 0) {
      return { products: [], total: 0 };
    }

    const { total } = await this.db.queryPaginated<CatalogProductRow>('provider_product_catalog', {
      ...sharedOpts,
      range: [0, 0],
    });

    const slotsNeeded = page * pageSize;
    const perProvider = Math.max(1, Math.ceil(slotsNeeded / codes.length));

    const slices = await Promise.all(
      codes.map((code) =>
        this.db
          .queryPaginated<CatalogProductRow>('provider_product_catalog', {
            ...sharedOpts,
            filter: { provider_code: code },
            range: [0, perProvider - 1],
          })
          .then((r) => r.data),
      ),
    );

    const merged = slices.flat().sort((a, b) => a.product_name.localeCompare(b.product_name));
    const from = (page - 1) * pageSize;
    const products = merged.slice(from, from + pageSize);

    return { products, total };
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

    const createProcurementOffer = dto.create_procurement_offer !== false;

    let offerId: string | null = null;
    if (createProcurementOffer) {
      let externalParentProductId =
        typeof dto.external_parent_product_id === 'string' ? dto.external_parent_product_id.trim() : '';
      if (!externalParentProductId) {
        const catHits = await this.db.query<{
          readonly external_parent_product_id: string | null;
          readonly slug: string | null;
        }>('provider_product_catalog', {
          filter: {
            provider_account_id: account.id,
            external_product_id: dto.external_product_id,
          },
          limit: 1,
        });
        const hit = catHits[0];
        externalParentProductId =
          hit?.external_parent_product_id?.trim() || hit?.slug?.trim() || '';
      }

      const offerRow: Record<string, unknown> = {
        variant_id: dto.variant_id,
        provider_account_id: account.id,
        external_offer_id: dto.external_product_id,
        currency: dto.currency,
        last_price_cents: dto.price_cents,
        is_active: true,
      };
      if (externalParentProductId) {
        offerRow.external_parent_product_id = externalParentProductId;
      }
      if (dto.platform_code !== undefined && dto.platform_code !== '') {
        offerRow.external_platform_code = dto.platform_code;
      }
      if (dto.region_code !== undefined && dto.region_code !== '') {
        offerRow.external_region_code = dto.region_code;
      }

      const offer = await this.db.insert<{ id: string }>('provider_variant_offers', offerRow);
      offerId = offer.id;
    }

    let sellerListingId: string | null = null;

    if (account.supports_seller) {
      const existingListings = await this.db.query<{ id: string }>(
        'seller_listings',
        {
          filter: { variant_id: dto.variant_id, provider_account_id: account.id },
          limit: 1,
        },
      );

      const relinkNow = new Date().toISOString();
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
      } else {
        const listingId = existingListings[0].id;
        await this.db.update('seller_listings', { id: listingId }, {
          external_product_id: dto.external_product_id,
          currency: dto.currency,
          price_cents: dto.price_cents,
          external_listing_id: null,
          status: 'draft',
          auto_sync_stock: false,
          auto_sync_price: false,
          error_message: null,
          updated_at: relinkNow,
        });
        sellerListingId = listingId;
      }
    }

    return { offer_id: offerId, seller_listing_id: sellerListingId };
  }

  async liveSearchProviders(dto: LiveSearchProvidersDto): Promise<LiveSearchProvidersResult> {
    const maxResults = dto.max_results ?? 10;
    const excludeSet = new Set(dto.exclude_provider_codes ?? []);

    const allProviders = this.registry
      .getSupportedProviders()
      .filter((code) => !excludeSet.has(code));

    logger.info('Live searching marketplace APIs + local catalog', {
      query: dto.query,
      maxResults,
      providers: allProviders,
    });

    if (allProviders.length === 0) {
      return {
        providers: [],
        diagnostics: this.buildLiveSearchDiagnostics([], [], []),
      };
    }

    const liveProviders = allProviders.filter((c) => this.registry.hasCapability(c, 'product_search'));
    const catalogOnlyProviders = allProviders.filter(
      (c) => !this.registry.hasCapability(c, 'product_search'),
    );

    const accountByCode = await this.resolveCanonicalAccountIdsByProviderCode(allProviders);

    const localGroupedPromise = this.searchLocalCatalogGrouped(dto.query, allProviders, maxResults);

    const livePromises = liveProviders.map(
      async (providerCode): Promise<{ providerCode: string; offers: LiveSearchOffer[] }> => {
        const adapter = this.registry.getProductSearchAdapter(providerCode)!;
        try {
          const results = await adapter.searchProducts(dto.query, maxResults);
          const offers = productSearchResultsToLiveSearchOffers(providerCode, results);

          return { providerCode, offers };
        } catch (err) {
          logger.warn(`Live search failed for provider ${providerCode}`, err as Error);
          return { providerCode, offers: [] };
        }
      },
    );

    const [localGroups, liveSettled] = await Promise.all([
      localGroupedPromise,
      Promise.allSettled(livePromises),
    ]);

    const localByCode = new Map(localGroups.map((g) => [g.provider_code, g]));

    const providers: LiveSearchProviderGroup[] = [];

    for (const settled of liveSettled) {
      if (settled.status !== 'fulfilled') continue;
      const { providerCode, offers: liveOffers } = settled.value;
      const localGroup = localByCode.get(providerCode);
      const merged = mergeLiveSearchOffers(liveOffers, localGroup?.offers ?? [], maxResults);
      providers.push({ provider_code: providerCode, offers: merged });

      const accountId = accountByCode.get(providerCode);
      if (accountId) {
        const pricedForCatalog = merged.filter((o) => o.price_cents > 0);
        if (pricedForCatalog.length > 0) {
          this.scheduleLiveSearchCatalogUpsert(pricedForCatalog, providerCode, accountId);
        }
      }

      if (localGroup) localByCode.delete(providerCode);
    }

    for (const group of localByCode.values()) {
      providers.push({
        provider_code: group.provider_code,
        offers: group.offers.slice(0, maxResults),
      });
    }

    /** Catalog-only adapters (e.g. AppRoute) have no HTTP `product_search`; include them so CRM Live Search lists every registered procurement source, even when the query matches nothing locally yet. */
    const includedCodes = new Set(providers.map((p) => p.provider_code));
    for (const code of catalogOnlyProviders) {
      if (!includedCodes.has(code)) {
        providers.push({ provider_code: code, offers: [] });
        includedCodes.add(code);
      }
    }

    const orderIdx = new Map(allProviders.map((c, i) => [c, i]));
    providers.sort(
      (a, b) => (orderIdx.get(a.provider_code) ?? 0) - (orderIdx.get(b.provider_code) ?? 0),
    );

    const diagnostics = this.buildLiveSearchDiagnostics(
      allProviders,
      liveProviders,
      catalogOnlyProviders,
    );

    return { providers, diagnostics };
  }

  private buildLiveSearchDiagnostics(
    selectedCodes: string[],
    liveHttpParticipants: string[],
    catalogFallbackParticipants: string[],
  ): LiveSearchDiagnostics {
    const registered = [...this.registry.getSupportedProviders()].sort();
    const live_http = registered.filter((c) => this.registry.hasCapability(c, 'product_search')).sort();
    const catalog_fallback = registered.filter((c) => !this.registry.hasCapability(c, 'product_search')).sort();
    const hints: string[] = [];

    if (registered.length === 0) {
      hints.push(
        'No marketplace adapters are registered. Check Vault secrets and api_profile for enabled provider_accounts (bootstrap log: Marketplace adapters bootstrapped).',
      );
    }

    for (const code of selectedCodes) {
      if (code !== 'kinguin') continue;
      const adapter = this.registry.getProductSearchAdapter('kinguin');
      if (!adapter) continue;
      const probe = adapter as { isBuyerProductSearchConfigured?: () => boolean };
      if (typeof probe.isBuyerProductSearchConfigured === 'function' && !probe.isBuyerProductSearchConfigured()) {
        hints.push(
          'Kinguin live marketplace search needs buyer_base_url and a buyer API key: set Vault `KINGUIN_BUYER_API_KEY`, or reuse Edge naming `KINGUIN_API_KEY`. Seller credentials alone return empty live results.',
        );
      }
    }

    if (
      registered.length > 0 &&
      selectedCodes.length > 0 &&
      liveHttpParticipants.length === 0 &&
      catalogFallbackParticipants.length > 0
    ) {
      hints.push(
        'Every adapter participating in this search uses catalog DB fallback only (no HTTP product_search). Run catalog ingestion or add buyer/search credentials for marketplace APIs.',
      );
    }

    return {
      registered_provider_codes: registered,
      live_http_provider_codes: live_http,
      catalog_fallback_provider_codes: catalog_fallback,
      hints,
    };
  }

  async getProcurementConfig(): Promise<GetProcurementConfigResult> {
    const setting = await this.db.queryOne<{ value: Record<string, unknown> }>(
      'platform_settings',
      { filter: { key: 'provider_procurement_config' }, single: true },
    );

    const raw = setting?.value ?? {};
    const config: ProcurementConfig = {
      auto_buy_enabled: raw.auto_buy_enabled === true,
      daily_spend_limit_cents: typeof raw.daily_spend_limit_cents === 'number' ? raw.daily_spend_limit_cents : null,
      max_cost_per_item_cents: typeof raw.max_cost_per_item_cents === 'number' ? raw.max_cost_per_item_cents : null,
    };

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const transactions = await this.db.query<{ amount: number }>(
      'transactions',
      {
        select: 'amount',
        filter: { type: 'purchase', direction: 'debit' },
        gte: [['created_at', todayStart.toISOString()]],
      },
    );

    const todaySpendCents = transactions.reduce((sum, row) => sum + (row.amount ?? 0), 0);

    return { config, today_spend_cents: todaySpendCents };
  }

  async updateProcurementConfig(dto: UpdateProcurementConfigDto): Promise<ProcurementConfig> {
    logger.info('Updating procurement config', { adminId: dto.admin_id });

    const current = await this.db.queryOne<{ value: Record<string, unknown> }>(
      'platform_settings',
      { filter: { key: 'provider_procurement_config' }, single: true },
    );

    const existing = current?.value ?? {};
    const merged: Record<string, unknown> = { ...existing };

    if (dto.auto_buy_enabled !== undefined) merged.auto_buy_enabled = dto.auto_buy_enabled;
    if (dto.daily_spend_limit_cents !== undefined) merged.daily_spend_limit_cents = dto.daily_spend_limit_cents;
    if (dto.max_cost_per_item_cents !== undefined) merged.max_cost_per_item_cents = dto.max_cost_per_item_cents;

    await this.db.upsert(
      'platform_settings',
      { key: 'provider_procurement_config', value: merged, updated_at: new Date().toISOString() },
      'key',
    );

    return {
      auto_buy_enabled: merged.auto_buy_enabled === true,
      daily_spend_limit_cents: typeof merged.daily_spend_limit_cents === 'number' ? merged.daily_spend_limit_cents : null,
      max_cost_per_item_cents: typeof merged.max_cost_per_item_cents === 'number' ? merged.max_cost_per_item_cents : null,
    };
  }

  async listPurchaseQueue(dto: ListPurchaseQueueDto): Promise<ListPurchaseQueueResult> {
    const limit = dto.limit ?? 20;
    const offset = dto.offset ?? 0;
    const from = offset;
    const to = from + limit - 1;

    const filter: Record<string, unknown> = {};
    if (dto.status) filter.status = dto.status;

    const { data, total } = await this.db.queryPaginated<PurchaseQueueItemRow>(
      'provider_purchase_queue',
      {
        select: 'id, order_id, order_item_id, variant_id, quantity_needed, status, attempts_total, max_attempts, last_error, created_at, processed_at, next_retry_at',
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        order: { column: 'created_at', ascending: false },
        range: [from, to],
      },
    );

    return { items: data, total };
  }

  async cancelQueueItem(dto: CancelQueueItemDto): Promise<CancelQueueItemResult> {
    logger.info('Cancelling queue item', { queueId: dto.queue_id, adminId: dto.admin_id });

    await this.db.update(
      'provider_purchase_queue',
      { id: dto.queue_id },
      {
        status: 'failed',
        last_error: `Cancelled by admin ${dto.admin_id}`,
        processed_at: new Date().toISOString(),
      },
    );

    return { success: true };
  }

  async listPurchaseAttempts(dto: ListPurchaseAttemptsDto): Promise<ListPurchaseAttemptsResult> {
    const attempts = await this.db.query<PurchaseAttemptRow>(
      'provider_purchase_attempts',
      {
        select: 'id, queue_id, provider_account_id, attempt_no, status, provider_order_ref, error_code, error_message, started_at, finished_at',
        filter: { queue_id: dto.queue_id },
        order: { column: 'attempt_no', ascending: true },
      },
    );

    return { attempts };
  }

  private async resolveCanonicalAccountIdsByProviderCode(
    providerCodes: string[],
  ): Promise<Map<string, string>> {
    if (providerCodes.length === 0) return new Map();

    const rows = await this.db.query<{ id: string; provider_code: string }>('provider_accounts', {
      select: 'id, provider_code',
      filter: { is_enabled: true },
      in: [['provider_code', providerCodes]],
    });

    const byCode = new Map<string, string[]>();
    for (const row of rows) {
      const list = byCode.get(row.provider_code) ?? [];
      list.push(row.id);
      byCode.set(row.provider_code, list);
    }

    const map = new Map<string, string>();
    for (const code of providerCodes) {
      const ids = byCode.get(code);
      if (ids === undefined || ids.length === 0) continue;
      ids.sort();
      map.set(code, ids[ids.length - 1]!);
    }

    return map;
  }

  private scheduleLiveSearchCatalogUpsert(
    offers: LiveSearchOffer[],
    providerCode: string,
    providerAccountId: string,
  ): void {
    const rows = liveSearchOffersToCatalogUpsertRows(
      offers,
      providerCode,
      providerAccountId,
      new Date().toISOString(),
    );

    void this.db
      .upsertMany('provider_product_catalog', rows, 'provider_account_id,external_product_id')
      .catch((err) => {
        logger.warn('Auto-catalog upsert failed (non-blocking)', {
          provider: providerCode,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  private async searchLocalCatalogGrouped(
    query: string,
    providerCodes: string[],
    maxPerProvider: number,
  ): Promise<LiveSearchProviderGroup[]> {
    try {
      const uniqueCodes = [...new Set(providerCodes)];
      const ilike = catalogProductNameIlikeClauses(query);
      const groups = await Promise.all(
        uniqueCodes.map(async (code): Promise<LiveSearchProviderGroup | null> => {
          const { data } = await this.db.queryPaginated<CatalogProductRow>(
            'provider_product_catalog',
            {
              select:
                'id, provider_code, external_product_id, external_parent_product_id, product_name, platform, region, min_price_cents, currency, qty, available_to_buy, thumbnail',
              filter: { provider_code: code },
              ilike: ilike.length > 0 ? ilike : undefined,
              order: { column: 'product_name', ascending: true },
              range: [0, maxPerProvider - 1],
            },
          );

          if (data.length === 0) return null;

          return {
            provider_code: code,
            offers: data.map((row) => catalogProductRowToLiveSearchOffer(row)),
          };
        }),
      );

      return groups.filter((g): g is LiveSearchProviderGroup => g != null);
    } catch (err) {
      logger.warn('Local catalog search failed for live search fallback', err as Error);
      return [];
    }
  }
}
