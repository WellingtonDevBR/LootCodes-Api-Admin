import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../ports/seller-key-operations.port.js';
import type { ExpireReservationsDto, ExpireReservationsResult } from './seller-listing.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('expire-reservations');

const DEFAULT_MAX_AGE_MINUTES = 60;

/**
 * Hard ceiling: any pending reservation older than this is stuck by definition.
 * The normal 60-minute sweep should catch everything long before this triggers.
 * If this sweep finds anything it means the housekeeping cron was broken for 2+
 * days — logged at warn so it surfaces in Sentry.
 */
const HARD_MAX_AGE_HOURS = 48;

@injectable()
export class ExpireReservationsUseCase {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private keyOps: ISellerKeyOperationsPort,
  ) {}

  async execute(dto: ExpireReservationsDto): Promise<ExpireReservationsResult> {
    const maxAge = dto.max_age_minutes ?? DEFAULT_MAX_AGE_MINUTES;

    const expired = await this.releaseStale(maxAge, false);

    // Safety backstop: sweep everything older than HARD_MAX_AGE_HOURS that the
    // normal sweep somehow missed (e.g. cron was down for an extended period).
    // Excludes rows already released by the normal sweep above.
    const hardMaxMinutes = HARD_MAX_AGE_HOURS * 60;
    if (maxAge < hardMaxMinutes) {
      await this.releaseStale(hardMaxMinutes, true);
    }

    return { expired };
  }

  private async releaseStale(maxAgeMinutes: number, isBackstop: boolean): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

    const stale = await this.db.query<{ id: string; created_at: string }>('seller_stock_reservations', {
      select: 'id, created_at',
      eq: [['status', 'pending']],
      lt: [['created_at', cutoff]],
    });

    if (stale.length === 0) return 0;

    if (isBackstop) {
      // This should never fire in normal operation — escalate so it reaches Sentry.
      logger.warn('Stuck pending reservations found by hard-ceiling sweep — keys locked for 2+ days', {
        count: stale.length,
        reservationIds: stale.map((r) => r.id),
        oldestCreatedAt: stale[0]?.created_at,
        maxAgeHours: HARD_MAX_AGE_HOURS,
      });
    }

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

    if (isBackstop) {
      logger.warn('Hard-ceiling sweep released stuck reservations', {
        released,
        total: stale.length,
        maxAgeHours: HARD_MAX_AGE_HOURS,
      });
    } else {
      logger.info('Expired stale reservations', { expired: released, total: stale.length, maxAgeMinutes });
    }

    return released;
  }
}
