import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPromoRepository } from '../../ports/admin-promo-repository.port.js';
import type { UpdatePromoCodeDto, UpdatePromoCodeResult } from './promo.types.js';

@injectable()
export class UpdatePromoCodeUseCase {
  constructor(
    @inject(TOKENS.AdminPromoRepository) private promoRepo: IAdminPromoRepository,
  ) {}

  async execute(dto: UpdatePromoCodeDto): Promise<UpdatePromoCodeResult> {
    return this.promoRepo.updatePromoCode(dto);
  }
}
