import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPricingRepository } from '../../ports/admin-pricing-repository.port.js';
import type { GetPricingSnapshotDto, GetPricingSnapshotResult } from './pricing.types.js';

@injectable()
export class GetPricingSnapshotUseCase {
  constructor(
    @inject(TOKENS.AdminPricingRepository) private pricingRepo: IAdminPricingRepository,
  ) {}

  async execute(dto: GetPricingSnapshotDto): Promise<GetPricingSnapshotResult> {
    return this.pricingRepo.getPricingSnapshot(dto);
  }
}
