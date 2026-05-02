import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminReferralRepository } from '../../ports/admin-referral-repository.port.js';
import type { ListReferralsDto, ListReferralsResult } from './referral.types.js';

@injectable()
export class ListReferralsUseCase {
  constructor(
    @inject(TOKENS.AdminReferralRepository) private repo: IAdminReferralRepository,
  ) {}

  async execute(dto: ListReferralsDto): Promise<ListReferralsResult> {
    return this.repo.listReferrals(dto);
  }
}
