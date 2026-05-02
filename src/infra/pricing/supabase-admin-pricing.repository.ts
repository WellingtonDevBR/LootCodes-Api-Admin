import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminPricingRepository } from '../../core/ports/admin-pricing-repository.port.js';
import type {
  GetVariantPriceTimelineDto,
  GetVariantPriceTimelineResult,
} from '../../core/use-cases/pricing/pricing.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminPricingRepository');

@injectable()
export class SupabaseAdminPricingRepository implements IAdminPricingRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async getVariantPriceTimeline(dto: GetVariantPriceTimelineDto): Promise<GetVariantPriceTimelineResult> {
    logger.info('Fetching variant price timeline', { variantId: dto.variant_id, period: dto.period });

    const timeline = await this.db.rpc<unknown[]>(
      'get_variant_price_timeline',
      {
        p_variant_id: dto.variant_id,
        p_period: dto.period ?? '30d',
      },
    );

    return { timeline: timeline ?? [] };
  }
}
