import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPromoRepository } from '../../ports/admin-promo-repository.port.js';
import type { SubmitPromoApprovalDto, SubmitPromoApprovalResult } from './promo.types.js';

@injectable()
export class SubmitPromoApprovalUseCase {
  constructor(
    @inject(TOKENS.AdminPromoRepository) private promoRepo: IAdminPromoRepository,
  ) {}

  async execute(dto: SubmitPromoApprovalDto): Promise<SubmitPromoApprovalResult> {
    return this.promoRepo.submitPromoApproval(dto);
  }
}
