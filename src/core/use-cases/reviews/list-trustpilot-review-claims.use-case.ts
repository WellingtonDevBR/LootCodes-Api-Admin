import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminReviewRepository } from '../../ports/admin-review-repository.port.js';
import type { ListTrustpilotReviewClaimsDto, ListTrustpilotReviewClaimsResult } from './review.types.js';

@injectable()
export class ListTrustpilotReviewClaimsUseCase {
  constructor(
    @inject(TOKENS.AdminReviewRepository) private repo: IAdminReviewRepository,
  ) {}

  async execute(dto: ListTrustpilotReviewClaimsDto): Promise<ListTrustpilotReviewClaimsResult> {
    return this.repo.listTrustpilotReviewClaims(dto);
  }
}
