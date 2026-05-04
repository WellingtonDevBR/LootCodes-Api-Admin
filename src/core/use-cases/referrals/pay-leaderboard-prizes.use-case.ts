import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminReferralRepository } from '../../ports/admin-referral-repository.port.js';
import type { PayLeaderboardPrizesDto, PayLeaderboardPrizesResult } from './referral.types.js';

@injectable()
export class PayLeaderboardPrizesUseCase {
  constructor(
    @inject(TOKENS.AdminReferralRepository) private repo: IAdminReferralRepository,
  ) {}

  async execute(dto: PayLeaderboardPrizesDto): Promise<PayLeaderboardPrizesResult> {
    return this.repo.payPrizes(dto);
  }
}
