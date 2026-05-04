import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminPricingRepository } from '../../core/ports/admin-pricing-repository.port.js';
import type {
  GetVariantPriceTimelineDto,
  GetVariantPriceTimelineResult,
  GetPricingSnapshotDto,
  GetPricingSnapshotResult,
  PricingSnapshotRow,
} from '../../core/use-cases/pricing/pricing.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminPricingRepository');

const PERIOD_MAP: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

function periodToDays(period?: string): number {
  if (!period) return 7;
  if (PERIOD_MAP[period]) return PERIOD_MAP[period];
  const parsed = parseInt(period, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

@injectable()
export class SupabaseAdminPricingRepository implements IAdminPricingRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async getVariantPriceTimeline(dto: GetVariantPriceTimelineDto): Promise<GetVariantPriceTimelineResult> {
    const days = periodToDays(dto.period);
    logger.info('Fetching variant price timeline', { variantId: dto.variant_id, days });

    const timeline = await this.db.rpc<unknown[]>(
      'get_variant_price_timeline',
      {
        p_variant_id: dto.variant_id,
        p_days: days,
      },
    );

    return { timeline: timeline ?? [] };
  }

  async getPricingSnapshot(dto: GetPricingSnapshotDto): Promise<GetPricingSnapshotResult> {
    logger.info('Fetching pricing snapshot');

    const limit = dto.limit ?? 200;
    const offset = dto.offset ?? 0;

    const variants = await this.db.query<Record<string, unknown>>('product_variants', {
      select: 'id, price_usd, is_active',
      order: { column: 'created_at', ascending: false },
      limit: limit + offset,
    });

    const listings: PricingSnapshotRow[] = variants.slice(offset, offset + limit).map(v => ({
      variant_id: v.id as string,
      provider_code: null,
      provider_name: null,
      price_cents: (v.price_usd as number) ?? 0,
      currency: 'USD',
      min_price_cents: null,
      commission_rate: null,
      status: (v.is_active as boolean) ? 'active' : 'inactive',
    }));

    return { listings };
  }
}
