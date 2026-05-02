import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPromoRepository } from '../../ports/admin-promo-repository.port.js';
import type { RejectPromoCodeDto, RejectPromoCodeResult } from './promo.types.js';

@injectable()
export class RejectPromoCodeUseCase {
  constructor(
    @inject(TOKENS.AdminPromoRepository) private promoRepo: IAdminPromoRepository,
  ) {}

  async execute(dto: RejectPromoCodeDto): Promise<RejectPromoCodeResult> {
    return this.promoRepo.rejectPromoCode(dto);
  }
}
