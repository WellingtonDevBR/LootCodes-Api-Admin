/**
 * PROVIDE handler for declared-stock marketplaces (Eneba).
 *
 * Flow:
 *   1. Find reservation by external_order_id (orderId or originalOrderId)
 *   2. Idempotent replay if already provisioned (re-decrypt delivered keys)
 *   3. Provision from pending keys (decrypt + update states)
 *   4. Complete provision orchestration (sale recording, events, stock notify)
 *   5. Return decrypted keys for marketplace delivery
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../ports/seller-key-operations.port.js';
import type {
  DeclaredStockProvideDto,
  DeclaredStockProvideResult,
  ReservationRow,
} from './seller-webhook.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('webhook:provide');

@injectable()
export class HandleDeclaredStockProvideUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
  ) {}

  async execute(dto: DeclaredStockProvideDto): Promise<DeclaredStockProvideResult> {
    const { orderId, originalOrderId, providerCode } = dto;

    try {
      const candidates = this.buildOrderIdCandidates(orderId, originalOrderId);

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
        return { success: false, orderId };
      }

      const meta = this.parseMetadata(reservation.provider_metadata);
      const auctionId = meta.auctionId ?? '';
      const keys = result.decryptedKeys.map((k) => ({ type: 'TEXT' as const, value: k.plaintext }));

      try {
        const providerAccount = await this.db.queryOne<{ provider_code: string }>(
          'provider_accounts',
          {
            select: 'provider_code',
            eq: [['id', (await this.db.queryOne<{ provider_account_id: string }>('seller_listings', {
              select: 'provider_account_id',
              eq: [['id', reservation.seller_listing_id]],
              single: true,
            }))?.provider_account_id ?? '']],
            single: true,
          },
        );

        await this.keyOps.completeProvisionOrchestration({
          reservationId: reservation.id,
          listingId: reservation.seller_listing_id,
          providerCode: providerAccount?.provider_code ?? providerCode,
          externalOrderId: orderId,
          keyIds: result.keyIds,
          keysProvisionedCount: result.decryptedKeys.length,
          priceCents: meta.marketplaceFinancials?.gross_cents_per_unit ?? meta.price?.amount,
          currency: meta.marketplaceFinancials?.currency ?? meta.price?.currency,
          marketplaceFinancialsSnapshot: meta.marketplaceFinancials,
        });
      } catch (orchestrationErr) {
        logger.error(
          'completeProvisionOrchestration failed AFTER successful provision',
          orchestrationErr as Error,
          { orderId, reservationId: reservation.id, keysProvisioned: result.decryptedKeys.length },
        );
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
    return rows.find((r) => r.external_order_id === preferredOrderId) ?? rows[0];
  }

  private buildOrderIdCandidates(orderId: string, originalOrderId: string | null): string[] {
    const set = new Set([orderId]);
    if (originalOrderId && originalOrderId !== orderId) set.add(originalOrderId);
    return Array.from(set);
  }

  private parseMetadata(raw: Record<string, unknown>): {
    auctionId?: string;
    price?: { amount: number; currency: string };
    marketplaceFinancials?: { gross_cents_per_unit?: number; currency?: string; [key: string]: unknown };
  } {
    return {
      auctionId: raw.auctionId as string | undefined,
      price: raw.price as { amount: number; currency: string } | undefined,
      marketplaceFinancials: raw.marketplaceFinancials as
        { gross_cents_per_unit?: number; currency?: string; [key: string]: unknown } | undefined,
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
