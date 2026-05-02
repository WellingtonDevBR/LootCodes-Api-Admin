import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPriceMatchRepository } from '../../ports/admin-price-match-repository.port.js';
import type { RejectPriceMatchDto, RejectPriceMatchResult } from './price-match.types.js';

@injectable()
export class RejectPriceMatchUseCase {
  constructor(
    @inject(TOKENS.AdminPriceMatchRepository) private repo: IAdminPriceMatchRepository,
  ) {}

  async execute(dto: RejectPriceMatchDto): Promise<RejectPriceMatchResult> {
    return this.repo.rejectPriceMatch(dto);
  }
}
