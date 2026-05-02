import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPromoRepository } from '../../ports/admin-promo-repository.port.js';
import type { ListPromoCodesDto, ListPromoCodesResult } from './promo.types.js';

@injectable()
export class ListPromoCodesUseCase {
  constructor(
    @inject(TOKENS.AdminPromoRepository) private promoRepo: IAdminPromoRepository,
  ) {}

  async execute(dto: ListPromoCodesDto): Promise<ListPromoCodesResult> {
    return this.promoRepo.listPromoCodes(dto);
  }
}
