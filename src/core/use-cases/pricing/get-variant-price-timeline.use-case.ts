import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPricingRepository } from '../../ports/admin-pricing-repository.port.js';
import type { GetVariantPriceTimelineDto, GetVariantPriceTimelineResult } from './pricing.types.js';

@injectable()
export class GetVariantPriceTimelineUseCase {
  constructor(
    @inject(TOKENS.AdminPricingRepository) private repo: IAdminPricingRepository,
  ) {}

  async execute(dto: GetVariantPriceTimelineDto): Promise<GetVariantPriceTimelineResult> {
    return this.repo.getVariantPriceTimeline(dto);
  }
}
