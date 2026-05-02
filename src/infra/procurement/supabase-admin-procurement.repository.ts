import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
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
} from '../../core/use-cases/procurement/procurement.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminProcurementRepository');

const DEFAULT_SEARCH_LIMIT = 20;

@injectable()
export class SupabaseAdminProcurementRepository implements IAdminProcurementRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
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
}
