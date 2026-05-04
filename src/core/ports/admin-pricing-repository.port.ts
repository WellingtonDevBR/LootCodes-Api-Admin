import type {
  GetVariantPriceTimelineDto,
  GetVariantPriceTimelineResult,
  GetPricingSnapshotDto,
  GetPricingSnapshotResult,
} from '../use-cases/pricing/pricing.types.js';

export interface IAdminPricingRepository {
  getVariantPriceTimeline(dto: GetVariantPriceTimelineDto): Promise<GetVariantPriceTimelineResult>;
  getPricingSnapshot(dto: GetPricingSnapshotDto): Promise<GetPricingSnapshotResult>;
}
