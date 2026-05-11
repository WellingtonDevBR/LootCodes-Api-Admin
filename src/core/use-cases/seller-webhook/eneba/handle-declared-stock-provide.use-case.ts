/**
 * PROVIDE handler for declared-stock marketplaces (Eneba).
 *
 * Flow:
 *   1. Find reservation by external_order_id (orderId or originalOrderId)
 *   2. Idempotent replay if already provisioned (re-decrypt delivered keys)
 *   3. Provision from pending keys (decrypt + update states)
 *   4. Health monitoring via IListingHealthPort
 *   5. Complete provision orchestration (sale recording, events, stock notify)
 *   6. Return decrypted keys for marketplace delivery
 */
import { injectable, inject } from 'tsyringe';
import * as Sentry from '@sentry/node';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../../ports/seller-key-operations.port.js';
import { buildOrderIdCandidates } from './eneba-helpers.js';
import type { IListingHealthPort } from '../../../ports/seller-listing-health.port.js';
import type {
  DeclaredStockProvideDto,
  DeclaredStockProvideResult,
  ReservationRow,
} from '../seller-webhook.types.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:provide');

@injectable()
export class HandleDeclaredStockProvideUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.ListingHealth) private readonly healthPort: IListingHealthPort,
  ) {}

  async execute(dto: DeclaredStockProvideDto): Promise<DeclaredStockProvideResult> {
    const { orderId, originalOrderId, providerCode } = dto;

    try {
      const candidates = buildOrderIdCandidates(orderId, originalOrderId);

      const rows = await this.db.query<ReservationRow>(
        'seller_stock_reservations',
        {
          select: 'id, seller_listing_id, status, quantity, provider_metadata, external_order_id, created_at',
          in: [['external_order_id', candidates]],
          order: { column: 'created_at', ascending: false },
          limit: 5,
        },
      );

      const reservation = this.pickReservation(rows, orderId);
      if (!reservation) {
        logger.error('Reservation not found for PROVIDE', { orderId, originalOrderId, candidates });
        return { success: false, orderId };
      }

      const meta = this.parseMetadata(reservation.provider_metadata);
      const auctionId = meta.auctionId ?? '';

      if (reservation.status === 'provisioned') {
        return this.handleIdempotentReplay(orderId, reservation);
      }

      if (reservation.status !== 'pending') {
        logger.warn('Reservation not in pending state for PROVIDE', {
          orderId, reservationId: reservation.id, status: reservation.status,
        });
        return { success: false, orderId };
      }

      let result;
      try {
        result = await this.keyOps.provisionFromPendingKeys(reservation.id);
      } catch (provisionErr) {
        logger.error('provisionFromPendingKeys failed', provisionErr as Error, {
          orderId, reservationId: reservation.id,
        });
        await this.persistProvisionError(reservation, provisionErr);
        await this.healthPort.updateHealthCounters(auctionId, 'provision', false);
        return { success: false, orderId };
      }

      await this.healthPort.updateHealthCounters(auctionId, 'provision', true);

      const keys = result.decryptedKeys.map((k) => ({ type: 'TEXT' as const, value: k.plaintext }));

      try {
        const listing = await this.db.queryOne<{
          variant_id: string;
          provider_account_id: string;
        }>('seller_listings', {
          select: 'variant_id, provider_account_id',
          eq: [['id', reservation.seller_listing_id]],
          single: true,
        });

        const providerAccount = listing?.provider_account_id
          ? await this.db.queryOne<{ provider_code: string }>('provider_accounts', {
              select: 'provider_code',
              eq: [['id', listing.provider_account_id]],
              single: true,
            })
          : null;

        const variantId = listing?.variant_id ?? '';
        let productId = '';
        if (variantId) {
          const variant = await this.db.queryOne<{ product_id: string }>('product_variants', {
            select: 'product_id',
            eq: [['id', variantId]],
            single: true,
          });
          productId = variant?.product_id ?? '';
        }

        const grossPerUnit = meta.marketplaceFinancials?.gross_cents_per_unit ?? meta.price?.amount ?? 0;
        const saleCurrency = meta.marketplaceFinancials?.currency ?? meta.price?.currency ?? 'EUR';

        await this.keyOps.completeProvisionOrchestration({
          reservationId: reservation.id,
          listingId: reservation.seller_listing_id,
          variantId,
          productId,
          providerCode: providerAccount?.provider_code ?? providerCode,
          externalOrderId: orderId,
          keyIds: result.keyIds,
          keysProvisionedCount: result.decryptedKeys.length,
          priceCents: grossPerUnit,
          currency: saleCurrency,
          marketplaceFinancialsSnapshot: meta.marketplaceFinancials,
          isReplacement: meta.isReplacement ?? false,
        });
      } catch (orchestrationErr) {
        // Keys were already decrypted and returned to Eneba — success:true will still be sent.
        // This is a critical data integrity issue: Eneba has the keys but our DB has not recorded
        // the sale, emitted stock_provisioned, or updated inventory. Needs immediate manual review.
        logger.error(
          'completeProvisionOrchestration failed AFTER successful provision — DB out of sync with Eneba',
          orchestrationErr as Error,
          { orderId, reservationId: reservation.id, keysProvisioned: result.decryptedKeys.length },
        );
        Sentry.captureException(orchestrationErr instanceof Error ? orchestrationErr : new Error(String(orchestrationErr)), {
          level: 'fatal',
          extra: {
            orderId,
            reservationId: reservation.id,
            keysProvisioned: result.decryptedKeys.length,
            note: 'Keys were delivered to Eneba but DB sale/event recording failed. Manual reconciliation required.',
          },
        });
      }

      logger.info('Provision completed', {
        orderId, reservationId: reservation.id, keysProvisioned: result.decryptedKeys.length,
      });

      return {
        success: true,
        orderId,
        auctions: [{ auctionId, keys }],
      };
    } catch (err) {
      logger.error('Unexpected error in provision handler', err as Error, { orderId, originalOrderId });
      return { success: false, orderId };
    }
  }

  private async handleIdempotentReplay(
    orderId: string,
    reservation: ReservationRow,
  ): Promise<DeclaredStockProvideResult> {
    const meta = this.parseMetadata(reservation.provider_metadata);
    try {
      const { decryptedKeys } = await this.keyOps.decryptDeliveredProvisionKeys(reservation.id);
      if (decryptedKeys.length === 0) {
        logger.error('Idempotent PROVIDE: no delivered provisions to replay', {
          orderId, reservationId: reservation.id,
        });
        return { success: false, orderId };
      }

      logger.info('Already provisioned — idempotent PROVIDE with key replay', {
        orderId, keyCount: decryptedKeys.length,
      });

      return {
        success: true,
        orderId,
        auctions: [{
          auctionId: meta.auctionId ?? '',
          keys: decryptedKeys.map((k) => ({ type: 'TEXT', value: k.plaintext })),
        }],
      };
    } catch (replayErr) {
      logger.error('Idempotent PROVIDE key replay failed', replayErr as Error, {
        orderId, reservationId: reservation.id,
      });
      return { success: false, orderId };
    }
  }

  private pickReservation(
    rows: ReservationRow[],
    preferredOrderId: string,
  ): ReservationRow | undefined {
    if (!rows.length) return undefined;
    // Prefer an exact match on the new orderId (direct PROVIDE or idempotent replay).
    const exact = rows.find((r) => r.external_order_id === preferredOrderId);
    if (exact) return exact;
    // Substitute-buyer PROVIDE: multiple rows share the originalOrderId (e.g. a
    // multi-item Eneba cart order each with its own RESERVE callback, some of which
    // may have been cancelled). Pick the pending row so we don't attempt to
    // provision against an already-cancelled reservation.
    return rows.find((r) => r.status === 'pending') ?? rows[0];
  }

  private parseMetadata(raw: Record<string, unknown>): {
    auctionId?: string;
    price?: { amount: number; currency: string };
    marketplaceFinancials?: { gross_cents_per_unit?: number; currency?: string; [key: string]: unknown };
    isReplacement?: boolean;
  } {
    return {
      auctionId: raw.auctionId as string | undefined,
      price: raw.price as { amount: number; currency: string } | undefined,
      marketplaceFinancials: raw.marketplaceFinancials as
        { gross_cents_per_unit?: number; currency?: string; [key: string]: unknown } | undefined,
      isReplacement: raw.isReplacement === true,
    };
  }

  private async persistProvisionError(reservation: ReservationRow, err: unknown): Promise<void> {
    try {
      const existingMeta = reservation.provider_metadata ?? {};
      await this.db.update('seller_stock_reservations', { id: reservation.id }, {
        provider_metadata: {
          ...existingMeta,
          lastProvisionError: {
            at: new Date().toISOString(),
            message: err instanceof Error ? err.message : String(err),
            name: err instanceof Error ? err.name : undefined,
          },
        },
      });
    } catch { /* never mask the primary error */ }
  }
}
