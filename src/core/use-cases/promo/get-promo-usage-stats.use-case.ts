import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPromoRepository } from '../../ports/admin-promo-repository.port.js';
import type { GetPromoUsageStatsDto, GetPromoUsageStatsResult } from './promo.types.js';

@injectable()
export class GetPromoUsageStatsUseCase {
  constructor(
    @inject(TOKENS.AdminPromoRepository) private promoRepo: IAdminPromoRepository,
  ) {}

  async execute(dto: GetPromoUsageStatsDto): Promise<GetPromoUsageStatsResult> {
    return this.promoRepo.getPromoUsageStats(dto);
  }
}
