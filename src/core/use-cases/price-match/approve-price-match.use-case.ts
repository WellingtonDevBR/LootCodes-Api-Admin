import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { ApprovePriceMatchDto, ApprovePriceMatchResult } from './price-match.types.js';

@injectable()
export class ApprovePriceMatchUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(dto: ApprovePriceMatchDto): Promise<ApprovePriceMatchResult> {
    return this.repo.approvePriceMatch(dto);
  }
}
