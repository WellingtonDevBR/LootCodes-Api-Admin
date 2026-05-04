import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { PriceMatchClaimRow } from './price-match.types.js';

@injectable()
export class GetPriceMatchClaimDetailUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(claimId: string): Promise<PriceMatchClaimRow | null> {
    return this.repo.getClaimDetail(claimId);
  }
}
