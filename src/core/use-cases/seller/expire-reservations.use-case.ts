import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ExpireReservationsDto, ExpireReservationsResult } from './seller-listing.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('expire-reservations');

const DEFAULT_MAX_AGE_MINUTES = 60;

@injectable()
export class ExpireReservationsUseCase {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async execute(dto: ExpireReservationsDto): Promise<ExpireReservationsResult> {
    const maxAge = dto.max_age_minutes ?? DEFAULT_MAX_AGE_MINUTES;
    const cutoff = new Date(Date.now() - maxAge * 60 * 1000).toISOString();

    const stale = await this.db.query<{ id: string }>('seller_stock_reservations', {
      select: 'id',
      eq: [['status', 'pending']],
      lt: [['created_at', cutoff]],
    });

    if (stale.length === 0) {
      return { expired: 0 };
    }

    let expired = 0;
    for (const reservation of stale) {
      try {
        await this.db.update('seller_stock_reservations', { id: reservation.id }, {
          status: 'expired',
        });
        expired++;
      } catch (err) {
        logger.warn('Failed to expire reservation', {
          reservationId: reservation.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('Expired stale reservations', { expired, total: stale.length, maxAgeMinutes: maxAge });
    return { expired };
  }
}
