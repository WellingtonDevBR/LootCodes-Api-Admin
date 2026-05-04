import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { ClaimConfidenceResult } from './price-match.types.js';

@injectable()
export class GetPriceMatchClaimConfidenceUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(claimId: string): Promise<ClaimConfidenceResult | null> {
    return this.repo.getClaimConfidence(claimId);
  }
}
