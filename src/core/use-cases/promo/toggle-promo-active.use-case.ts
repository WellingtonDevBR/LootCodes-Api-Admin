import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminPromoRepository } from '../../ports/admin-promo-repository.port.js';
import type { TogglePromoActiveDto, TogglePromoActiveResult } from './promo.types.js';

@injectable()
export class TogglePromoActiveUseCase {
  constructor(
    @inject(TOKENS.AdminPromoRepository) private promoRepo: IAdminPromoRepository,
  ) {}

  async execute(dto: TogglePromoActiveDto): Promise<TogglePromoActiveResult> {
    return this.promoRepo.togglePromoActive(dto);
  }
}
