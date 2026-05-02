import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPromoRepository } from '../../ports/admin-promo-repository.port.js';
import type { ApprovePromoCodeDto, ApprovePromoCodeResult } from './promo.types.js';

@injectable()
export class ApprovePromoCodeUseCase {
  constructor(
    @inject(TOKENS.AdminPromoRepository) private promoRepo: IAdminPromoRepository,
  ) {}

  async execute(dto: ApprovePromoCodeDto): Promise<ApprovePromoCodeResult> {
    return this.promoRepo.approvePromoCode(dto);
  }
}
