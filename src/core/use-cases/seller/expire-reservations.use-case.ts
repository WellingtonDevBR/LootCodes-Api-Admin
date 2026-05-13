import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../ports/seller-key-operations.port.js';
import type { ExpireReservationsDto, ExpireReservationsResult } from './seller-listing.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('expire-reservations');

/**
 * Hard ceiling backstop: a pending reservation with no expires_at (legacy row),
 * or one whose expires_at is in the future but has been pending for an
 * implausibly long time (cron was down for days), is swept here.
 *
 * All new reservations set expires_at = now + 3 calendar days in the RESERVE
 * handler — those are handled by the primary expires_at sweep, not this.
 * If this backstop fires it means the housekeeping cron was broken for 5+ days
 * — logged at warn so it surfaces in Sentry.
 */
const BACKSTOP_AGE_HOURS = 120; // 5 days

@injectable()
export class ExpireReservationsUseCase {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private keyOps: ISellerKeyOperationsPort,
  ) {}

  async execute(dto: ExpireReservationsDto): Promise<ExpireReservationsResult> {
    // Primary sweep: respect the per-reservation expires_at set during RESERVE
    // (currently 3 calendar days). This is the authoritative expiry signal —
    // Eneba can send PROVIDE well after 24 hours so we must never expire sooner
    // than the marketplace's own payment window.
    const expired = await this.releaseByExpiresAt();

    // Backstop: catch legacy rows with no expires_at or any reservation that
    // somehow survived past BACKSTOP_AGE_HOURS (e.g. cron was down for days).
    await this.releaseBackstop();

    return { expired };
  }

  private async releaseByExpiresAt(): Promise<number> {
    const now = new Date().toISOString();

    const stale = await this.db.query<{ id: string; expires_at: string }>('seller_stock_reservations', {
      select: 'id, expires_at',
      eq: [['status', 'pending']],
      lt: [['expires_at', now]],
    });

    if (stale.length === 0) return 0;

    let released = 0;
    for (const reservation of stale) {
      try {
        await this.keyOps.releaseReservationKeys(reservation.id, 'expired');
        released++;
      } catch (err) {
        logger.warn('Failed to expire reservation', {
          reservationId: reservation.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('Expired stale reservations (expires_at sweep)', { expired: released, total: stale.length });
    return released;
  }

  private async releaseBackstop(): Promise<void> {
    const cutoff = new Date(Date.now() - BACKSTOP_AGE_HOURS * 60 * 60 * 1000).toISOString();

    // Catch rows with NULL expires_at (pre-dates the expires_at column) OR rows
    // that slipped through the primary sweep for any reason.
    const stuck = await this.db.query<{ id: string; created_at: string; expires_at: string | null }>(
      'seller_stock_reservations',
      {
        select: 'id, created_at, expires_at',
        eq: [['status', 'pending']],
        lt: [['created_at', cutoff]],
      },
    );

    if (stuck.length === 0) return;

    logger.warn('Stuck pending reservations found by hard-ceiling backstop — cron likely broken for 5+ days', {
      count: stuck.length,
      reservationIds: stuck.map((r) => r.id),
      oldestCreatedAt: stuck[0]?.created_at,
      backstopAgeHours: BACKSTOP_AGE_HOURS,
    });

    for (const reservation of stuck) {
      try {
        await this.keyOps.releaseReservationKeys(reservation.id, 'expired');
      } catch (err) {
        logger.warn('Backstop: failed to expire reservation', {
          reservationId: reservation.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.warn('Hard-ceiling backstop released stuck reservations', {
      total: stuck.length,
      backstopAgeHours: BACKSTOP_AGE_HOURS,
    });
  }
}
