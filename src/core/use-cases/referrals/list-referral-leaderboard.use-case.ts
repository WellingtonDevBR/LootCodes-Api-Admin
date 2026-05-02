import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminReferralRepository } from '../../ports/admin-referral-repository.port.js';
import type { ListReferralLeaderboardDto, ListReferralLeaderboardResult } from './referral.types.js';

@injectable()
export class ListReferralLeaderboardUseCase {
  constructor(
    @inject(TOKENS.AdminReferralRepository) private repo: IAdminReferralRepository,
  ) {}

  async execute(dto: ListReferralLeaderboardDto): Promise<ListReferralLeaderboardResult> {
    return this.repo.listReferralLeaderboard(dto);
  }
}
