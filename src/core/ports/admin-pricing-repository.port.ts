import type {
  GetVariantPriceTimelineDto,
  GetVariantPriceTimelineResult,
} from '../use-cases/pricing/pricing.types.js';

export interface IAdminPricingRepository {
  getVariantPriceTimeline(dto: GetVariantPriceTimelineDto): Promise<GetVariantPriceTimelineResult>;
}
