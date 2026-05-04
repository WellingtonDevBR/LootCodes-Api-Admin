import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminReferralRepository } from '../../ports/admin-referral-repository.port.js';
import type { InvalidateReferralDto, InvalidateReferralResult } from './referral.types.js';

@injectable()
export class InvalidateReferralUseCase {
  constructor(
    @inject(TOKENS.AdminReferralRepository) private repo: IAdminReferralRepository,
  ) {}

  async execute(dto: InvalidateReferralDto): Promise<InvalidateReferralResult> {
    return this.repo.invalidate(dto);
  }
}
