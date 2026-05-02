import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPromoRepository } from '../../ports/admin-promo-repository.port.js';
import type { DeletePromoCodeDto, DeletePromoCodeResult } from './promo.types.js';

@injectable()
export class DeletePromoCodeUseCase {
  constructor(
    @inject(TOKENS.AdminPromoRepository) private promoRepo: IAdminPromoRepository,
  ) {}

  async execute(dto: DeletePromoCodeDto): Promise<DeletePromoCodeResult> {
    return this.promoRepo.deletePromoCode(dto);
  }
}
