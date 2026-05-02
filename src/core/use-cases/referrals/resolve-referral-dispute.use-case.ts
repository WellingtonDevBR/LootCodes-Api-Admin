import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminReferralRepository } from '../../ports/admin-referral-repository.port.js';
import type { ResolveReferralDisputeDto, ResolveReferralDisputeResult } from './referral.types.js';

@injectable()
export class ResolveReferralDisputeUseCase {
  constructor(
    @inject(TOKENS.AdminReferralRepository) private repo: IAdminReferralRepository,
  ) {}

  async execute(dto: ResolveReferralDisputeDto): Promise<ResolveReferralDisputeResult> {
    return this.repo.resolveReferralDispute(dto);
  }
}
