import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPromoRepository } from '../../ports/admin-promo-repository.port.js';
import type { CreatePromoCodeDto, CreatePromoCodeResult } from './promo.types.js';

@injectable()
export class CreatePromoCodeUseCase {
  constructor(
    @inject(TOKENS.AdminPromoRepository) private promoRepo: IAdminPromoRepository,
  ) {}

  async execute(dto: CreatePromoCodeDto): Promise<CreatePromoCodeResult> {
    return this.promoRepo.createPromoCode(dto);
  }
}
