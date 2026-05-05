import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type {
  IKinguinKeyUploadPort,
  KinguinKeyUploadResult,
  KinguinRestockResult,
} from '../../core/ports/kinguin-key-upload.port.js';
import type { IMarketplaceAdapterRegistry } from '../../core/ports/marketplace-adapter.port.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import { capKinguinDeclaredStock } from '../../core/shared/kinguin.constants.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('kinguin-key-upload-svc');

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

@injectable()
export class KinguinKeyUploadService implements IKinguinKeyUploadPort {
  constructor(
    @inject(TOKENS.MarketplaceAdapterRegistry) private readonly registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.Database) private readonly db: IDatabase,
  ) {}

  async uploadKeyWithRetry(
    offerId: string,
    key: string,
    reservationId: string,
    mimeType: string,
    _providerAccountId: string,
  ): Promise<KinguinKeyUploadResult> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.doUpload(offerId, key, reservationId, mimeType);
      } catch (err) {
        lastError = err;

        if (this.isNonRetriable(err)) {
          throw err;
        }

        const errMsg = err instanceof Error ? err.message : String(err);
        if (this.isReservationAlreadyProcessed(errMsg)) {
          logger.warn('Reservation already processed, falling back to pool upload', {
            offerId, reservationId,
          });
          try {
            await this.doUpload(offerId, key, '', mimeType);
            return { success: true, deliveryMode: 'pool' };
          } catch (poolErr) {
            logger.error('Pool fallback upload also failed', poolErr as Error, {
              offerId, reservationId,
            });
            throw poolErr;
          }
        }

        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          logger.info('Retrying key upload', { offerId, attempt: attempt + 1 });
        }
      }
    }

    throw lastError;
  }

  async reassertDeclaredStock(
    listingId: string,
    offerId: string,
    _providerAccountId: string,
    triggerReservationId?: string,
  ): Promise<KinguinRestockResult> {
    const listing = await this.db.queryOne<{
      variant_id: string;
      status: string;
    }>('seller_listings', {
      select: 'variant_id, status',
      eq: [['id', listingId]],
      single: true,
    });

    if (!listing || listing.status !== 'active') {
      return { attempted: false, reason: 'listing_not_active' };
    }

    const stockResult = await this.db.rpc<{ available_count: number }>(
      'count_available_seller_keys',
      { p_variant_id: listing.variant_id },
    );
    const rawCount = Array.isArray(stockResult)
      ? stockResult[0]?.available_count ?? 0
      : (stockResult as { available_count: number })?.available_count ?? 0;
    const declaredStock = capKinguinDeclaredStock(rawCount);

    if (declaredStock <= 0) {
      return { attempted: false, declaredStock: 0, reason: 'no_stock_to_declare' };
    }

    try {
      const adapter = this.registry.getDeclaredStockAdapter('kinguin');
      if (!adapter) {
        return { attempted: false, reason: 'adapter_not_found' };
      }

      await adapter.declareStock(offerId, declaredStock);

      logger.info('Kinguin post-sale restock completed', {
        offerId, declaredStock, listingId, triggerReservationId,
      });
      return { attempted: true, declaredStock };
    } catch (err) {
      logger.error('Kinguin post-sale restock failed', err as Error, {
        offerId, declaredStock, listingId,
      });
      return { attempted: false, declaredStock, reason: 'restock_api_error' };
    }
  }

  private async doUpload(
    offerId: string,
    key: string,
    reservationId: string,
    _mimeType: string,
  ): Promise<KinguinKeyUploadResult> {
    const adapter = this.registry.getDeclaredStockAdapter('kinguin');
    if (!adapter) {
      throw new Error('Kinguin declared stock adapter not found');
    }

    const result = await adapter.provisionKeys({
      reservationId,
      externalReservationId: offerId,
      keys: [{ value: key, type: 'TEXT' }],
    });

    if (!result.success) {
      throw new Error(result.error ?? 'Kinguin key upload failed');
    }

    return {
      success: true,
      deliveryMode: reservationId ? 'reservation' : 'pool',
    };
  }

  private isReservationAlreadyProcessed(errorMsg: string): boolean {
    const lower = errorMsg.toLowerCase();
    return lower.includes('already processed')
      || lower.includes('invalid reservation')
      || lower.includes('reservation not found');
  }

  private isNonRetriable(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return msg.includes('body too large')
      || msg.includes('unsupported mime')
      || msg.includes('invalid mime');
  }
}
