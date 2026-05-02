import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminReviewRepository } from '../../ports/admin-review-repository.port.js';
import type { ResolveTrustpilotReviewClaimDto, ResolveTrustpilotReviewClaimResult } from './review.types.js';

@injectable()
export class ResolveTrustpilotReviewClaimUseCase {
  constructor(
    @inject(TOKENS.AdminReviewRepository) private repo: IAdminReviewRepository,
  ) {}

  async execute(dto: ResolveTrustpilotReviewClaimDto): Promise<ResolveTrustpilotReviewClaimResult> {
    return this.repo.resolveTrustpilotReviewClaim(dto);
  }
}
